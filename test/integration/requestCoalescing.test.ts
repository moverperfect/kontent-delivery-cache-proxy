import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("request coalescing", () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(join(tmpdir(), "kc-coal-"));
    process.env.PURGE_TOKEN = "test-secret";
    process.env.CACHE_DIR = dir;
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "silent";
    process.env.KONTENT_DELIVERY_BASE_URL = "https://deliver.kontent.ai";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 40));
        const body = JSON.stringify({
          items: [],
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

  it("dedupes concurrent misses for same URL", async () => {
    const url = "/delivery/prod/items?language=en-GB";
    const promises = Array.from({ length: 10 }, () =>
      app.inject({ method: "GET", url }),
    );
    const results = await Promise.all(promises);
    const fetchFn = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchFn.mock.calls.length).toBe(1);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const parsed = results.map((r) => JSON.parse(r.body) as unknown);
    const first = JSON.stringify(parsed[0]);
    expect(parsed.every((p) => JSON.stringify(p) === first)).toBe(true);
  });
});
