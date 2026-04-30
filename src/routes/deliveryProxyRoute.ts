import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { buildCacheKey, collectVaryHeaders } from "../cache/cacheKey.js";
import {
  isContentTypeSupported,
  isMethodCacheable,
  isStatusCacheable,
} from "../cache/cachePolicy.js";
import type { CacheMetadata } from "../cache/cacheMetadata.js";
import { readBodyBuffer, readMetadata, storeCacheObject } from "../cache/fileCacheStore.js";
import { extractDependencyKeys } from "../kontent/dependencyExtractor.js";
import { fetchUpstream } from "../kontent/upstreamClient.js";
import { canonicalQueryString, normaliseUpstreamPath } from "../utils/canonicalUrl.js";
import { safeJsonParse } from "../utils/json.js";
import type { Metrics } from "../observability/metrics.js";
import type { Logger } from "../observability/logger.js";
import { newRequestId } from "../observability/requestContext.js";
import { isInternalAuthorized } from "../security/auth.js";
import { redactHeaders } from "../security/redaction.js";
import { trackDependency, trackException } from "../observability/appInsights.js";

type ProxyMode = "delivery" | "preview";

type CacheHdr = "HIT" | "MISS" | "STALE" | "REFRESH" | "BYPASS";

type UpstreamResult = { status: number; headers: Record<string, string>; body: Buffer };

interface FetchAndStoreOutcome {
  response: UpstreamResult;
  upstreamDurationMs: number;
  stored: boolean;
}

const inflight = new Map<string, Promise<FetchAndStoreOutcome>>();

function coalescedUpstream(
  cacheKey: string,
  run: () => Promise<FetchAndStoreOutcome>,
): Promise<FetchAndStoreOutcome> {
  const existing = inflight.get(cacheKey);
  if (existing) return existing;
  const promise = new Promise<FetchAndStoreOutcome>((resolve, reject) => {
    queueMicrotask(() => {
      void run()
        .then(resolve)
        .catch(reject)
        .finally(() => inflight.delete(cacheKey));
    });
  });
  inflight.set(cacheKey, promise);
  return promise;
}

function baseUrlForMode(config: AppConfig, mode: ProxyMode): string {
  return mode === "preview" ? config.KONTENT_PREVIEW_BASE_URL : config.KONTENT_DELIVERY_BASE_URL;
}

function buildUpstreamUrl(
  config: AppConfig,
  mode: ProxyMode,
  environmentId: string,
  upstreamPath: string,
  query: URLSearchParams,
): string {
  const base = baseUrlForMode(config, mode).replace(/\/+$/, "");
  const path = normaliseUpstreamPath(upstreamPath);
  const qs = canonicalQueryString(query);
  const suffix = qs.length > 0 ? `?${qs}` : "";
  return `${base}/${environmentId}${path}${suffix}`;
}

function collectForwardHeaders(req: FastifyRequest): Record<string, string> {
  const names = [
    "authorization",
    "x-kc-secured-production-api-key",
    "x-kc-secured-preview-api-key",
    "accept",
    "accept-language",
  ];
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = req.headers[n];
    if (typeof v === "string" && v.length > 0) {
      out[n] = v;
    }
  }
  return out;
}

function isFresh(meta: CacheMetadata, now = Date.now()): boolean {
  return now < Date.parse(meta.expiresAt);
}

function withinStaleIfError(meta: CacheMetadata, config: AppConfig, now = Date.now()): boolean {
  const refreshed = Date.parse(meta.refreshedAt);
  return now <= refreshed + config.CACHE_STALE_IF_ERROR_SECONDS * 1000;
}

function copyResponseHeaders(reply: FastifyReply, headers: Record<string, string>): void {
  const skip = new Set([
    "content-encoding",
    "transfer-encoding",
    "connection",
    "keep-alive",
  ]);
  for (const [k, v] of Object.entries(headers)) {
    if (skip.has(k.toLowerCase())) continue;
    reply.header(k, v);
  }
}

export async function registerDeliveryProxyRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig;
    metrics: Metrics;
    logger: Logger;
  },
): Promise<void> {
  const { config, metrics, logger } = deps;

  async function handleProxy(
    request: FastifyRequest,
    reply: FastifyReply,
    mode: ProxyMode,
  ): Promise<void> {
    const requestId = newRequestId();
    const started = Date.now();
    let upstreamMs = 0;
    let cacheHdr: CacheHdr = "MISS";

    const environmentId = (request.params as Record<string, string>).environmentId;
    const splat = ((request.params as Record<string, string>)["*"] ?? "") as string;
    const upstreamPath = splat.length > 0 ? `/${splat.replace(/^\/+/, "")}` : "/";

    const query = new URLSearchParams(
      typeof request.query === "object" && request.query !== null
        ? Object.entries(request.query as Record<string, unknown>).flatMap(([k, v]) =>
            Array.isArray(v)
              ? v.map((x) => [k, String(x)] as [string, string])
              : v !== undefined
                ? ([[k, String(v)]] as [string, string][])
                : [],
          )
        : [],
    );

    const varyHeaders = collectVaryHeaders((n) => {
      const v = request.headers[n];
      return typeof v === "string" ? v : undefined;
    });

    const method = request.method.toUpperCase();
    const { canonicalInput, cacheKey } = buildCacheKey({
      schemaVersion: config.CACHE_SCHEMA_VERSION,
      method,
      environmentId,
      mode,
      path: upstreamPath,
      query,
      varyHeaders,
    });

    const bypass =
      request.headers["x-kontent-proxy-bypass"] === "true" && isInternalAuthorized(request, config);
    const refresh =
      request.headers["x-kontent-proxy-refresh"] === "true" && isInternalAuthorized(request, config);

    const upstreamUrl = buildUpstreamUrl(config, mode, environmentId, upstreamPath, query);

    reply.header("x-kontent-proxy-request-id", requestId);

    const setCacheHdr = (h: CacheHdr) => {
      cacheHdr = h;
      reply.header("x-kontent-proxy-cache", h);
      if (config.DEBUG_HEADERS) {
        reply.header("x-kontent-proxy-cache-key", cacheKey);
      }
    };

    const forward = collectForwardHeaders(request);
    if (request.telemetry) {
      forward.traceparent = `00-${request.telemetry.traceId}-${request.telemetry.spanId}-01`;
      const incomingState = request.headers.tracestate;
      if (typeof incomingState === "string") forward.tracestate = incomingState;
    }

    const logDone = (extra?: Record<string, unknown>) => {
      logger.info({
        traceId: request.telemetry?.traceId,
        spanId: request.telemetry?.spanId,
        parentSpanId: request.telemetry?.parentSpanId,
        requestId,
        method,
        path: request.url,
        statusCode: reply.statusCode,
        cacheStatus: cacheHdr,
        cacheKey: config.DEBUG_HEADERS ? cacheKey : undefined,
        durationMs: Date.now() - started,
        upstreamDurationMs: upstreamMs,
        ...extra,
      });
    };

    try {
      if (bypass) {
        setCacheHdr("BYPASS");
        const t0 = Date.now();
        const result = await fetchUpstream(config, {
          url: upstreamUrl,
          method,
          headers: forward,
          telemetry: {
            onAttempt: (m) => {
              trackDependency({
                target: new URL(upstreamUrl).host,
                name: `${method} ${new URL(upstreamUrl).pathname}`,
                data: upstreamUrl,
                duration: m.durationMs,
                resultCode: String(m.statusCode ?? 0),
                success: m.success,
                dependencyTypeName: "HTTP",
                properties: { attempt: String(m.attempt), maxAttempts: String(m.maxAttempts), timedOut: String(m.timedOut), mode, environmentId },
                tagOverrides: { "ai.operation.id": request.telemetry?.traceId, "ai.operation.parentId": request.telemetry?.spanId },
              }, config.APPINSIGHTS_REDACT_QUERY_VALUES);
            },
          },
        });
        upstreamMs = Date.now() - t0;
        metrics.upstreamRequestsTotal++;
        reply.header("x-kontent-proxy-upstream-duration-ms", String(upstreamMs));
        metrics.recordRequest("BYPASS");
        copyResponseHeaders(reply, result.headers);
        await reply.code(result.status).send(method === "HEAD" ? undefined : result.body);
        request.telemetry && (request.telemetry.properties = { ...(request.telemetry.properties ?? {}), cacheStatus: cacheHdr, environmentId, mode, proxyRequestId: requestId, upstreamDurationMs: String(upstreamMs) });
      logDone();
        return;
      }

      const metaExisting = refresh ? undefined : await readMetadata(config, cacheKey);
      const bufferExisting =
        metaExisting && method !== "HEAD"
          ? await readBodyBuffer(config, cacheKey)
          : metaExisting && method === "HEAD"
            ? Buffer.alloc(0)
            : undefined;

      if (metaExisting && bufferExisting !== undefined && isFresh(metaExisting) && !refresh) {
        setCacheHdr("HIT");
        metrics.recordRequest("HIT");
        reply.header("x-kontent-proxy-upstream-duration-ms", "0");
        copyResponseHeaders(reply, metaExisting.responseHeaders);
        await reply.code(metaExisting.status).send(method === "HEAD" ? undefined : bufferExisting);
        request.telemetry && (request.telemetry.properties = { ...(request.telemetry.properties ?? {}), cacheStatus: cacheHdr, environmentId, mode, proxyRequestId: requestId, upstreamDurationMs: String(upstreamMs) });
      logDone();
        return;
      }

      if (refresh) {
        setCacheHdr("REFRESH");
      }

      const outcome = await coalescedUpstream(cacheKey, async () => {
        const t0 = Date.now();
        const res = await fetchUpstream(config, {
          url: upstreamUrl,
          method,
          headers: forward,
          telemetry: {
            onAttempt: (m) => {
              trackDependency({
                target: new URL(upstreamUrl).host,
                name: `${method} ${new URL(upstreamUrl).pathname}`,
                data: upstreamUrl,
                duration: m.durationMs,
                resultCode: String(m.statusCode ?? 0),
                success: m.success,
                dependencyTypeName: "HTTP",
                properties: { attempt: String(m.attempt), maxAttempts: String(m.maxAttempts), timedOut: String(m.timedOut), mode, environmentId },
                tagOverrides: { "ai.operation.id": request.telemetry?.traceId, "ai.operation.parentId": request.telemetry?.spanId },
              }, config.APPINSIGHTS_REDACT_QUERY_VALUES);
            },
          },
        });
        const dur = Date.now() - t0;
        metrics.upstreamRequestsTotal++;

        const cacheable =
          isMethodCacheable(method) &&
          isStatusCacheable(res.status, config) &&
          isContentTypeSupported(res.headers["content-type"], method) &&
          res.body.byteLength <= config.CACHE_MAX_BODY_BYTES;

        let stored = false;
        if (cacheable) {
          const parsed =
            res.body.byteLength > 0 ? safeJsonParse(res.body.toString("utf8")) : {};
          const deps = extractDependencyKeys(parsed, {
            environmentId,
            mode,
            path: upstreamPath,
            query,
            language: query.get("language") ?? query.get("culture") ?? undefined,
          });

          await storeCacheObject({
            config,
            cacheKey,
            canonicalKeyInput: canonicalInput,
            method,
            environmentId,
            mode,
            upstreamUrl,
            requestHeadersForReplay: redactHeaders(collectForwardHeaders(request)),
            status: res.status,
            responseHeaders: res.headers,
            body: res.body,
            dependencyKeys: deps,
            ttlSeconds: config.CACHE_DEFAULT_TTL_SECONDS,
            staleWhileRevalidateSeconds: config.CACHE_STALE_WHILE_REVALIDATE_SECONDS,
          });
          stored = true;
        }

        return { response: res, upstreamDurationMs: dur, stored };
      });

      upstreamMs = outcome.upstreamDurationMs;
      const result = outcome.response;

      if (outcome.stored) {
        if (refresh) {
          setCacheHdr("REFRESH");
          metrics.recordRequest("REFRESH");
        } else {
          setCacheHdr("MISS");
          metrics.recordRequest("MISS");
        }
      } else if (
        metaExisting &&
        bufferExisting !== undefined &&
        withinStaleIfError(metaExisting, config) &&
        !isFresh(metaExisting)
      ) {
        setCacheHdr("STALE");
        metrics.recordRequest("STALE");
        reply.header("x-kontent-proxy-upstream-duration-ms", String(upstreamMs));
        copyResponseHeaders(reply, metaExisting.responseHeaders);
        await reply.code(metaExisting.status).send(method === "HEAD" ? undefined : bufferExisting);
        request.telemetry && (request.telemetry.properties = { ...(request.telemetry.properties ?? {}), cacheStatus: cacheHdr, environmentId, mode, proxyRequestId: requestId, upstreamDurationMs: String(upstreamMs) });
      logDone();
        return;
      } else {
        if (!refresh) {
          setCacheHdr("MISS");
          metrics.recordRequest("MISS");
        } else {
          metrics.recordRequest("REFRESH");
        }
      }

      reply.header("x-kontent-proxy-upstream-duration-ms", String(upstreamMs));
      copyResponseHeaders(reply, result.headers);
      await reply.code(result.status).send(method === "HEAD" ? undefined : result.body);
      request.telemetry && (request.telemetry.properties = { ...(request.telemetry.properties ?? {}), cacheStatus: cacheHdr, environmentId, mode, proxyRequestId: requestId, upstreamDurationMs: String(upstreamMs) });
      logDone();
    } catch (err) {
      metrics.upstreamErrorsTotal++;
      try {
        const metaExisting = await readMetadata(config, cacheKey);
        const bufferExisting =
          metaExisting && method !== "HEAD"
            ? await readBodyBuffer(config, cacheKey)
            : metaExisting && method === "HEAD"
              ? Buffer.alloc(0)
              : undefined;
        if (
          metaExisting &&
          bufferExisting !== undefined &&
          withinStaleIfError(metaExisting, config) &&
          !isFresh(metaExisting)
        ) {
          setCacheHdr("STALE");
          metrics.recordRequest("STALE");
          reply.header("x-kontent-proxy-upstream-duration-ms", String(Date.now() - started));
          copyResponseHeaders(reply, metaExisting.responseHeaders);
          await reply.code(metaExisting.status).send(method === "HEAD" ? undefined : bufferExisting);
          logDone({ errorCode: "upstream_fetch_failed_recovered_stale" });
          return;
        }
      } catch {
        /* fall through */
      }

      reply.header("x-kontent-proxy-cache", "MISS");
      if (config.NODE_ENV !== "production") {
        reply.header("x-kontent-proxy-error", "upstream_fetch_failed");
      }
      metrics.recordRequest("MISS");
      trackException({ exception: err instanceof Error ? err : new Error("upstream_fetch_failed"), properties: { mode, environmentId, proxyRequestId: requestId }, tagOverrides: { "ai.operation.id": request.telemetry?.traceId, "ai.operation.parentId": request.telemetry?.spanId } });
      await reply.code(502).send({ error: "upstream_fetch_failed", requestId });
      logDone({ errorCode: "upstream_fetch_failed" });
    }
  }

  app.route({
    method: ["GET", "HEAD"],
    url: "/delivery/:environmentId/*",
    handler: (req, reply) => handleProxy(req, reply, "delivery"),
  });

  app.route({
    method: ["GET", "HEAD"],
    url: "/preview/:environmentId/*",
    handler: (req, reply) => handleProxy(req, reply, "preview"),
  });
}
