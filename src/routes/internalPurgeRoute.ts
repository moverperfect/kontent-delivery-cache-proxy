import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import {
  deleteCacheObject,
  readMetadata,
  storeCacheObject,
} from "../cache/fileCacheStore.js";
import { getCacheKeysForDependency } from "../cache/dependencyIndex.js";
import type { Metrics } from "../observability/metrics.js";
import { fetchUpstream } from "../kontent/upstreamClient.js";
import { extractDependencyKeys } from "../kontent/dependencyExtractor.js";
import { safeJsonParse } from "../utils/json.js";
import {
  isContentTypeSupported,
  isMethodCacheable,
  isStatusCacheable,
} from "../cache/cachePolicy.js";
import { isInternalAuthorized } from "../security/auth.js";

const purgeBodySchema = z.object({
  dependencies: z.array(z.string().min(1)),
  mode: z.enum(["delete", "soft-expire", "delete-and-warm"]).default("delete"),
  reason: z.string().optional(),
  requestId: z.string().optional(),
});

export async function registerInternalPurgeRoute(
  app: FastifyInstance,
  deps: { config: AppConfig; metrics: Metrics },
): Promise<void> {
  const { config, metrics } = deps;

  app.post("/internal/purge", async (request, reply) => {
    if (!isInternalAuthorized(request, config)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }

    const parsed = purgeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }

    const body = parsed.data;
    metrics.purgeRequestsTotal++;

    const matched = new Set<string>();
    for (const dep of body.dependencies) {
      const keys = await getCacheKeysForDependency(config, dep);
      for (const k of keys) matched.add(k);
    }

    const deleted: string[] = [];
    const errors: string[] = [];
    const warmed: string[] = [];

    const metaByKey = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof readMetadata>>>
    >();

    if (body.mode === "delete-and-warm") {
      if (!config.ENABLE_WARM_ENDPOINT) {
        await reply.code(400).send({ error: "warm_disabled" });
        return;
      }
      for (const cacheKey of matched) {
        const meta = await readMetadata(config, cacheKey);
        if (meta) metaByKey.set(cacheKey, meta);
      }
    }

    for (const cacheKey of matched) {
      try {
        const ok = await deleteCacheObject(config, cacheKey);
        if (ok) {
          deleted.push(cacheKey);
          metrics.purgedObjectsTotal++;
        }
      } catch (e) {
        errors.push(`${cacheKey}: ${String(e)}`);
      }
    }

    if (body.mode === "delete-and-warm" && config.ENABLE_WARM_ENDPOINT) {
      for (const cacheKey of matched) {
        const meta = metaByKey.get(cacheKey);
        if (!meta) continue;
        try {
          const headers = { ...meta.requestHeadersForReplay };
          const res = await fetchUpstream(config, {
            url: meta.upstreamUrl,
            method: meta.method,
            headers,
          });
          const cacheable =
            isMethodCacheable(meta.method) &&
            isStatusCacheable(res.status, config) &&
            isContentTypeSupported(res.headers["content-type"], meta.method) &&
            res.body.byteLength <= config.CACHE_MAX_BODY_BYTES;
          if (!cacheable) continue;
          const parsedBody =
            res.body.byteLength > 0 ? safeJsonParse(res.body.toString("utf8")) : {};
          const deps = extractDependencyKeys(parsedBody, {
            environmentId: meta.environmentId,
            mode: meta.mode,
            path: new URL(meta.upstreamUrl).pathname.replace(/^\/[^/]+/, "") || "/",
            query: new URL(meta.upstreamUrl).searchParams,
          });
          await storeCacheObject({
            config,
            cacheKey,
            canonicalKeyInput: meta.canonicalKeyInput,
            method: meta.method,
            environmentId: meta.environmentId,
            mode: meta.mode,
            upstreamUrl: meta.upstreamUrl,
            requestHeadersForReplay: meta.requestHeadersForReplay,
            status: res.status,
            responseHeaders: res.headers,
            body: res.body,
            dependencyKeys: deps,
            ttlSeconds: config.CACHE_DEFAULT_TTL_SECONDS,
            staleWhileRevalidateSeconds: config.CACHE_STALE_WHILE_REVALIDATE_SECONDS,
          });
          warmed.push(cacheKey);
        } catch (e) {
          console.error(`warm:${cacheKey}:${String(e)}`);
          errors.push(`warm:${cacheKey}:${String(e)}`);
        }
      }
    }

    await reply.send({
      requestId: body.requestId,
      dependencies: body.dependencies,
      matchedCacheKeys: [...matched].sort(),
      deleted,
      warmed,
      errors,
    });
  });
}
