import { describe, expect, it } from "vitest";
import { initAppInsightsFromEnv, sanitizeUrl } from "../../src/observability/appInsights.js";

const TEST_CONNECTION_STRING =
  "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=http://127.0.0.1:4319/";

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

describe("applicationinsights ESM interop", () => {
  it("initializes a client through the package default export", async () => {
    const moduleNs = await import("applicationinsights");
    const appInsights =
      (moduleNs as typeof moduleNs & { default?: typeof moduleNs }).default ?? moduleNs;

    appInsights.setup(TEST_CONNECTION_STRING).start();

    expect(typeof appInsights.setup).toBe("function");
    expect(appInsights.defaultClient).toBeDefined();
  });
});
