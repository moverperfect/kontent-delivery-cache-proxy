import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("purge by dependency", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(join(tmpdir(), "kc-purge-"));
    process.env.PURGE_TOKEN = "purge-secret";
    process.env.CACHE_DIR = dir;
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.KONTENT_DELIVERY_BASE_URL = "https://deliver.kontent.ai";

    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        const body =
          n === 1
            ? JSON.stringify({
                items: [
                  {
                    system: { codename: "foo", type: "article" },
                    elements: {},
                  },
                ],
                modular_content: {},
              })
            : JSON.stringify({
                items: [
                  {
                    system: { codename: "bar", type: "article" },
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

  it("deletes cache for item:foo but keeps item:bar entry", async () => {
    await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=1&language=en-GB",
    });
    await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=2&language=en-GB",
    });

    const purge = await app.inject({
      method: "POST",
      url: "/internal/purge",
      headers: {
        authorization: "Bearer purge-secret",
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        dependencies: ["item:foo"],
        mode: "delete",
      }),
    });

    expect(purge.statusCode).toBe(200);
    const body = JSON.parse(purge.body) as { deleted: string[] };
    expect(body.deleted.length).toBe(1);

    const rBar = await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=2&language=en-GB",
    });
    expect(rBar.headers["x-kontent-proxy-cache"]).toBe("HIT");

    const rFoo = await app.inject({
      method: "GET",
      url: "/delivery/prod/items?a=1&language=en-GB",
    });
    expect(rFoo.headers["x-kontent-proxy-cache"]).toBe("MISS");
  });
});
