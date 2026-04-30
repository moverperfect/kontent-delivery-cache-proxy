import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { flushTelemetry, initAppInsights, initAppInsightsFromEnv, trackException } from "./observability/appInsights.js";

async function main() {
  const config = loadConfig();
  initAppInsights(config);
  const { app } = await buildServer(config);
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

main().catch(async (err) => {
  initAppInsightsFromEnv(process.env);
  trackException({ exception: err instanceof Error ? err : new Error(String(err)) });
  await flushTelemetry();
  console.error(err);
  process.exit(1);
});
