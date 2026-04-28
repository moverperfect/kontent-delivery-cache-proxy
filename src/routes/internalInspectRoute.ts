import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { readMetadata } from "../cache/fileCacheStore.js";
import { readDependencyRecord } from "../cache/dependencyIndex.js";
import { isInternalAuthorized } from "../security/auth.js";

export async function registerInternalInspectRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig },
): Promise<void> {
  const { config } = deps;

  app.get("/internal/cache/:cacheKey/meta", async (request, reply) => {
    if (!isInternalAuthorized(request, config)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    const cacheKey = (request.params as { cacheKey: string }).cacheKey;
    const meta = await readMetadata(config, cacheKey);
    if (!meta) {
      await reply.code(404).send({ error: "not_found" });
      return;
    }
    await reply.send(meta);
  });

  app.get("/internal/deps/*", async (request, reply) => {
    if (!isInternalAuthorized(request, config)) {
      await reply.code(401).send({ error: "unauthorized" });
      return;
    }
    const raw = ((request.params as Record<string, string>)["*"] ?? "") as string;
    const dependencyKey = decodeURIComponent(raw.replace(/^\/+/, ""));
    const rec = await readDependencyRecord(config, dependencyKey);
    if (!rec) {
      await reply.code(404).send({ error: "not_found" });
      return;
    }
    await reply.send(rec);
  });
}
