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
});
