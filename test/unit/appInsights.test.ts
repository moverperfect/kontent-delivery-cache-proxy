import { describe, expect, it } from "vitest";
import { initAppInsightsFromEnv, sanitizeUrl } from "../../src/observability/appInsights.js";

describe("sanitizeUrl", () => {
  it("redacts query values for absolute URLs", () => {
    expect(sanitizeUrl("https://example.com/items?token=secret&user=jack", true)).toBe(
      "https://example.com/items?token=REDACTED&user=REDACTED",
    );
  });

  it("redacts query values for relative URLs instead of leaking the original query", () => {
    expect(sanitizeUrl("/items?token=secret&user=jack#frag", true)).toBe(
      "/items?token=REDACTED&user=REDACTED#frag",
    );
  });
});

describe("initAppInsightsFromEnv", () => {
  it("is safe to call when no connection string is present", () => {
    expect(() => initAppInsightsFromEnv({} as NodeJS.ProcessEnv)).not.toThrow();
  });
});
