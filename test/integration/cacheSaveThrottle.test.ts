import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kontentListJson } from "./helpers/integrationSetup.js";

describe("cache save window throttle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("second distinct-key miss skips persist when window max is 1", async () => {
    vi.resetModules();
    const cacheDir = await mkdtemp(join(tmpdir(), "kc-thr-"));

    vi.stubEnv("PURGE_TOKEN", "test-secret");
    vi.stubEnv("CACHE_DIR", cacheDir);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("LOG_LEVEL", "silent");
    vi.stubEnv("KONTENT_DELIVERY_BASE_URL", "https://deliver.kontent.ai");
    vi.stubEnv("CACHE_SAVE_MAX_CONCURRENT", "0");
    vi.stubEnv("CACHE_SAVE_MAX_PER_WINDOW", "1");
    vi.stubEnv("CACHE_SAVE_WINDOW_MS", "60000");

    const fetchFn = vi.fn(async () => {
      return new Response(kontentListJson([{ codename: "a", type: "article" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchFn);

    const { buildServer } = await import("../../src/server.js");
    const { app } = await buildServer();

    try {
      const u1 = "/delivery/e/items?k=1&system.type=article&language=en-GB";
      const u2 = "/delivery/e/items?k=2&system.type=article&language=en-GB";

      await app.inject({ method: "GET", url: u1 });
      await app.inject({ method: "GET", url: u2 });
      await app.inject({ method: "GET", url: u2 });

      expect(fetchFn.mock.calls.length).toBe(3);
    } finally {
      await app.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
