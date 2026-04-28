import { describe, expect, it } from "vitest";
import { extractDependencyKeys } from "../../src/kontent/dependencyExtractor.js";

describe("extractDependencyKeys", () => {
  const ctx = {
    environmentId: "prod",
    mode: "delivery" as const,
    path: "/items",
    query: new URLSearchParams("system.type=article&language=en-GB"),
    language: "en-GB",
  };

  it("extracts items[*].system.codename and type", () => {
    const body = {
      items: [
        {
          system: { codename: "foo", type: "article" },
          elements: {},
        },
      ],
      modular_content: {},
    };
    const deps = extractDependencyKeys(body, ctx);
    expect(deps).toContain("item:foo");
    expect(deps).toContain("type:article");
    expect(deps).toContain("environment:prod");
    expect(deps).toContain("language:en-GB");
    expect(deps).toContain("query:path:/items");
    expect(deps).toContain("query:items:type:article");
  });

  it("extracts modular_content codenames", () => {
    const body = {
      items: [],
      modular_content: {
        m1: { system: { codename: "nested", type: "snippet" }, elements: {} },
      },
    };
    const deps = extractDependencyKeys(body, ctx);
    expect(deps).toContain("item:nested");
    expect(deps).toContain("type:snippet");
  });

  it("deduplicates dependencies", () => {
    const body = {
      items: [{ system: { codename: "x", type: "article" }, elements: {} }],
      modular_content: {},
    };
    const deps = extractDependencyKeys(body, ctx);
    expect(deps.filter((d) => d === "type:article").length).toBe(1);
  });

  it("handles malformed JSON-ish input safely", () => {
    const deps = extractDependencyKeys({ items: null }, ctx);
    expect(Array.isArray(deps)).toBe(true);
    expect(deps.length).toBeGreaterThan(0);
  });
});
