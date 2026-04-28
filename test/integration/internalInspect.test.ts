import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheMetadata } from "../../src/cache/cacheMetadata.js";
import {
  bootstrapIntegrationServer,
  disposeIntegrationServer,
  kontentListJson,
  type IntegrationHarness,
} from "./helpers/integrationSetup.js";

describe("internal inspect routes", () => {
  let app: FastifyInstance;
  let cacheDir: string;

  beforeEach(async () => {
    const h: IntegrationHarness = await bootstrapIntegrationServer({
      purgeToken: "inspect-token",
      fetchMock: vi.fn(async () => {
        return new Response(
          kontentListJson([
            { codename: "hero", type: "article" },
            { codename: "sidekick", type: "article" },
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    });
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  const authBrowse = {
    authorization: "Bearer inspect-token",
  };

  it("401 on GET /internal/deps/* without Bearer", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/internal/deps/${encodeURIComponent("item:hero")}`,
    });
    expect(r.statusCode).toBe(401);
  });

  it("401 on GET /internal/cache/:cacheKey/meta without Bearer", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/internal/cache/some-key/meta",
    });
    expect(r.statusCode).toBe(401);
  });

  it("404 on dependency record that was never indexed", async () => {
    const r = await app.inject({
      method: "GET",
      headers: authBrowse,
      url: `/internal/deps/${encodeURIComponent("item:never_seen")}`,
    });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body)).toMatchObject({ error: "not_found" });
  });

  it("404 on cache meta when key unknown", async () => {
    const r = await app.inject({
      method: "GET",
      headers: authBrowse,
      url: "/internal/cache/not-a-real-cache-key/meta",
    });
    expect(r.statusCode).toBe(404);
  });

  it("200 dependency record after delivery MISS, then 200 meta for listed cache key", async () => {
    const miss = await app.inject({
      method: "GET",
      url: "/delivery/live-env/items?language=en-GB",
    });
    expect(miss.statusCode).toBe(200);
    expect(miss.headers["x-kontent-proxy-cache"]).toBe("MISS");

    const depPath = `/internal/deps/${encodeURIComponent("item:hero")}`;
    const depRes = await app.inject({
      method: "GET",
      headers: authBrowse,
      url: depPath,
    });
    expect(depRes.statusCode).toBe(200);
    const depBody = JSON.parse(depRes.body) as { dependencyKey: string; cacheKeys: string[] };
    expect(depBody.dependencyKey).toBe("item:hero");
    expect(depBody.cacheKeys.length).toBeGreaterThan(0);

    const cacheKey = depBody.cacheKeys[0];
    const metaRes = await app.inject({
      method: "GET",
      headers: authBrowse,
      url: `/internal/cache/${encodeURIComponent(cacheKey)}/meta`,
    });
    expect(metaRes.statusCode).toBe(200);
    const meta = JSON.parse(metaRes.body) as CacheMetadata;
    expect(meta.cacheKey).toBe(cacheKey);
    expect(meta.environmentId).toBe("live-env");
    expect(meta.dependencyKeys).toContain("item:hero");

    const hit = await app.inject({
      method: "GET",
      url: "/delivery/live-env/items?language=en-GB",
    });
    expect(hit.headers["x-kontent-proxy-cache"]).toBe("HIT");
  });
});
