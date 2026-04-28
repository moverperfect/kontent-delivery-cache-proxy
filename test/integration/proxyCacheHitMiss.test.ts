import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("proxy cache hit/miss", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(join(tmpdir(), "kc-int-"));
    process.env.PURGE_TOKEN = "test-secret";
    process.env.CACHE_DIR = dir;
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.KONTENT_DELIVERY_BASE_URL = "https://deliver.kontent.ai";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = JSON.stringify({
          items: [
            {
              system: { codename: "chelsea_flower_show", type: "article" },
              elements: {},
            },
          ],
          modular_content: {},
        });
        return new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const { buildServer } = await import("../../src/server.js");
    const built = await buildServer();
    app = built.app;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("first request miss then hit without second upstream call", async () => {
    const url =
      "/delivery/prod/items?system.type=article&language=en-GB&depth=3";
    const r1 = await app.inject({ method: "GET", url });
    expect(r1.headers["x-kontent-proxy-cache"]).toBe("MISS");
    const r2 = await app.inject({ method: "GET", url });
    expect(r2.headers["x-kontent-proxy-cache"]).toBe("HIT");
    const fetchFn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  it("upstream receives wait-for-new-content header", async () => {
    const url = "/delivery/prod/items?language=en-GB";
    await app.inject({ method: "GET", url });
    const fetchFn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("x-kc-wait-for-loading-new-content")).toBe("true");
  });
});
