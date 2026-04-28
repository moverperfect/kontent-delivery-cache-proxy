import { describe, expect, it } from "vitest";
import { buildCacheKey } from "../../src/cache/cacheKey.js";

describe("buildCacheKey", () => {
  it("same query params different order produce same cache key", () => {
    const q1 = new URLSearchParams("language=en-GB&depth=3");
    const q2 = new URLSearchParams("depth=3&language=en-GB");
    const a = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: q1,
      varyHeaders: {},
    });
    const b = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: q2,
      varyHeaders: {},
    });
    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.canonicalInput).toBe(b.canonicalInput);
  });

  it("different environment IDs produce different keys", () => {
    const q = new URLSearchParams("");
    const a = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: q,
      varyHeaders: {},
    });
    const b = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "preview-env",
      mode: "delivery",
      path: "/items",
      query: q,
      varyHeaders: {},
    });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("delivery vs preview modes differ", () => {
    const q = new URLSearchParams("");
    const a = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: q,
      varyHeaders: {},
    });
    const b = buildCacheKey({
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "preview",
      path: "/items",
      query: q,
      varyHeaders: {},
    });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });

  it("vary headers affect key", () => {
    const q = new URLSearchParams("");
    const base = {
      schemaVersion: 1,
      method: "GET",
      environmentId: "prod",
      mode: "delivery" as const,
      path: "/items",
      query: q,
    };
    const a = buildCacheKey({
      ...base,
      varyHeaders: { authorization: "Bearer abc" },
    });
    const b = buildCacheKey({
      ...base,
      varyHeaders: { authorization: "Bearer xyz" },
    });
    expect(a.cacheKey).not.toBe(b.cacheKey);
  });
});
