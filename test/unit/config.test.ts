import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig PURGE_TOKEN requirements", () => {
  it("throws when PURGE_TOKEN is missing", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toThrow();
  });

  it("accepts explicit PURGE_TOKEN", () => {
    const cfg = loadConfig({
      NODE_ENV: "development",
      PURGE_TOKEN: "test-secret",
    } as NodeJS.ProcessEnv);

    expect(cfg.PURGE_TOKEN).toBe("test-secret");
  });

  it("defaults cache save throttle settings", () => {
    const cfg = loadConfig({
      NODE_ENV: "development",
      PURGE_TOKEN: "test-secret",
    } as NodeJS.ProcessEnv);

    expect(cfg.CACHE_SAVE_MAX_CONCURRENT).toBe(4);
    expect(cfg.CACHE_SAVE_WINDOW_MS).toBe(1000);
    expect(cfg.CACHE_SAVE_MAX_PER_WINDOW).toBe(4);
  });
});
