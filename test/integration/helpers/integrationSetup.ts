import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Mock } from "vitest";
import { vi } from "vitest";

export interface IntegrationHarness {
  app: FastifyInstance;
  cacheDir: string;
}

/** Default JSON body for cacheable Kontent list responses. */
export function kontentListJson(items: { codename: string; type: string }[]): string {
  return JSON.stringify({
    items: items.map((i) => ({
      system: { codename: i.codename, type: i.type },
      elements: {},
    })),
    modular_content: {},
  });
}

/**
 * Fresh module graph + temp cache dir + stubbed fetch. Caller must use dynamic import path from this file.
 */
export async function bootstrapIntegrationServer(options: {
  purgeToken?: string;
  fetchMock?: Mock;
  env?: Record<string, string | undefined>;
} = {}): Promise<IntegrationHarness> {
  vi.resetModules();
  const cacheDir = await mkdtemp(join(tmpdir(), "kc-integration-"));

  process.env.PURGE_TOKEN = options.purgeToken ?? "test-secret";
  process.env.CACHE_DIR = cacheDir;
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";
  process.env.KONTENT_DELIVERY_BASE_URL = "https://deliver.kontent.ai";
  process.env.KONTENT_PREVIEW_BASE_URL = "https://preview-deliver.kontent.ai";

  for (const [k, v] of Object.entries(options.env ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const fetchFn =
    options.fetchMock ??
    vi.fn(async () => {
      const body = kontentListJson([]);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  vi.stubGlobal("fetch", fetchFn);

  const { buildServer } = await import("../../../src/server.js");
  const built = await buildServer();
  return { app: built.app, cacheDir };
}

export async function disposeIntegrationServer(
  app: FastifyInstance,
  cacheDir: string,
): Promise<void> {
  vi.unstubAllGlobals();
  await app.close();
  await rm(cacheDir, { recursive: true, force: true });
}
