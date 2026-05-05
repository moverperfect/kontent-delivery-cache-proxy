import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapIntegrationServer,
  disposeIntegrationServer,
  kontentListJson,
  type IntegrationHarness,
} from "./helpers/integrationSetup.js";

describe("preview proxy route", () => {
  let app: FastifyInstance;
  let cacheDir: string;
  let capturedUrls: string[] = [];
  let capturedTraceparents: string[] = [];
  let capturedTracestates: string[] = [];

  beforeEach(async () => {
    capturedUrls = [];
    capturedTraceparents = [];
    capturedTracestates = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      capturedUrls.push(url);
      const headers = init?.headers as Record<string, string> | undefined;
      capturedTraceparents.push(headers?.traceparent ?? "");
      capturedTracestates.push(headers?.tracestate ?? "");
      return new Response(
        kontentListJson([{ codename: "preview_item", type: "article" }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const h: IntegrationHarness = await bootstrapIntegrationServer({
      fetchMock,
      env: {
        KONTENT_PREVIEW_BASE_URL: "https://preview-deliver.kontent.ai",
      },
    });
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  it("GET /preview resolves against KONTENT_PREVIEW_BASE_URL host", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/preview/pe/items?language=en-US",
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["x-kontent-proxy-cache"]).toBe("MISS");
    expect(capturedUrls.some((u) => u.includes("preview-deliver.kontent.ai"))).toBe(true);
    expect(capturedUrls.some((u) => u.includes("/pe/items"))).toBe(true);
  });

  it("second identical preview request hits cache", async () => {
    const url = "/preview/pe/items?language=en-US";
    const a = await app.inject({ method: "GET", url });
    const b = await app.inject({ method: "GET", url });
    expect(a.headers["x-kontent-proxy-cache"]).toBe("MISS");
    expect(b.headers["x-kontent-proxy-cache"]).toBe("HIT");
  });

  it("preserves inbound unsampled trace flags when proxying upstream", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/preview/pe/items?language=en-US",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-00",
      },
    });

    expect(r.statusCode).toBe(200);
    expect(capturedTraceparents).toHaveLength(1);
    expect(capturedTraceparents[0]).toMatch(/^00-0123456789abcdef0123456789abcdef-[0-9a-f]{16}-00$/);
  });

  it("defaults proxied trace flags to 01 for locally generated traces", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/preview/pe/items?language=en-US",
    });

    expect(r.statusCode).toBe(200);
    expect(capturedTraceparents).toHaveLength(1);
    expect(capturedTraceparents[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("does not forward tracestate when inbound traceparent is invalid", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/preview/pe/items?language=en-US",
      headers: {
        traceparent: "00-00000000000000000000000000000000-0000000000000000-00",
        tracestate: "vendor=value",
      },
    });

    expect(r.statusCode).toBe(200);
    expect(capturedTraceparents).toHaveLength(1);
    expect(capturedTraceparents[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(capturedTracestates[0]).toBe("");
  });
});

describe("purge delete-and-warm", () => {
  let app: FastifyInstance;
  let cacheDir: string;

  beforeEach(async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(kontentListJson([{ codename: "warm_item", type: "article" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const h: IntegrationHarness = await bootstrapIntegrationServer({
      purgeToken: "warm-secret",
      fetchMock,
      env: {
        ENABLE_WARM_ENDPOINT: "true",
      },
    });
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  it("repopulates cache and returns warmed keys when mode is delete-and-warm", async () => {
    const url = "/delivery/warm-env/items?language=en-GB";
    const first = await app.inject({ method: "GET", url });
    expect(first.headers["x-kontent-proxy-cache"]).toBe("MISS");

    const purge = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer warm-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: ["item:warm_item"],
        mode: "delete-and-warm",
      }),
    });

    expect(purge.statusCode).toBe(200);
    const body = JSON.parse(purge.body) as {
      deleted: string[];
      warmed: string[];
      errors: string[];
    };
    expect(body.errors.length).toBe(0);
    expect(body.deleted.length).toBeGreaterThan(0);
    expect(body.warmed.length).toBe(body.deleted.length);

    const after = await app.inject({ method: "GET", url });
    expect(after.headers["x-kontent-proxy-cache"]).toBe("HIT");
  });
});
