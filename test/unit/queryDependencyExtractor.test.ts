import { describe, expect, it } from "vitest";
import { deriveSyntheticQueryDeps } from "../../src/kontent/queryDependencyExtractor.js";

describe("deriveSyntheticQueryDeps", () => {
  it("adds query:path and query:items:type when system.type present", () => {
    const deps = deriveSyntheticQueryDeps({
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: new URLSearchParams("system.type=article"),
    });
    expect(deps).toContain("query:path:/items");
    expect(deps).toContain("query:items:type:article");
  });

  it("uses language query param", () => {
    const deps = deriveSyntheticQueryDeps({
      environmentId: "prod",
      mode: "delivery",
      path: "/items",
      query: new URLSearchParams("language=de-DE"),
      language: "de-DE",
    });
    expect(deps.some((d) => d.startsWith("language:"))).toBe(true);
  });
});
