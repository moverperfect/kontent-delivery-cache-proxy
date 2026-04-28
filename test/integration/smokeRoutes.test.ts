import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrapIntegrationServer,
  disposeIntegrationServer,
  type IntegrationHarness,
} from "./helpers/integrationSetup.js";

describe("smoke routes", () => {
  let app: FastifyInstance;
  let cacheDir: string;

  beforeEach(async () => {
    const h: IntegrationHarness = await bootstrapIntegrationServer();
    app = h.app;
    cacheDir = h.cacheDir;
  });

  afterEach(async () => {
    await disposeIntegrationServer(app, cacheDir);
  });

  it("GET /healthz returns service metadata", async () => {
    const r = await app.inject({ method: "GET", url: "/healthz" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({
      status: "ok",
      service: "kontent-cache-proxy",
      version: "0.1.0",
    });
  });

  it("GET /readyz reports ready when cache dir is writable", async () => {
    const r = await app.inject({ method: "GET", url: "/readyz" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({
      status: "ready",
      checks: {
        cacheDirReadable: true,
        cacheDirWritable: true,
        configValid: true,
      },
    });
  });

  it("GET /metrics exposes Prometheus counters", async () => {
    const r = await app.inject({ method: "GET", url: "/metrics" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.body).toContain("kontent_proxy_requests_total");
    expect(r.body).toContain("kontent_proxy_cache_hits_total");
    expect(r.body).toContain("kontent_proxy_purge_requests_total");
    expect(r.body).toContain("kontent_proxy_purged_objects_total");
  });
});
