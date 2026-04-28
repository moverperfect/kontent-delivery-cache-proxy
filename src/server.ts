import { randomBytes } from "node:crypto";
import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createLogger } from "./observability/logger.js";
import { Metrics } from "./observability/metrics.js";
import { registerHealthRoutes } from "./routes/healthRoute.js";
import { registerDeliveryProxyRoutes } from "./routes/deliveryProxyRoute.js";
import { registerInternalPurgeRoute } from "./routes/internalPurgeRoute.js";
import { registerInternalInspectRoutes } from "./routes/internalInspectRoute.js";

export async function buildServer() {
  const config = loadConfig();
  const logger = createLogger(config);
  const metrics = new Metrics();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    trustProxy: true,
    genReqId: () => randomBytes(8).toString("hex"),
  });

  await registerHealthRoutes(app, config);

  app.get("/metrics", async (_request, reply) => {
    await reply.type("text/plain; charset=utf-8").send(metrics.prometheusText(config));
  });

  await registerDeliveryProxyRoutes(app, { config, metrics, logger });
  await registerInternalPurgeRoute(app, { config, metrics });
  await registerInternalInspectRoutes(app, { config });

  return { app, config };
}
