import { buildServer } from "./server.js";
import { flushTelemetry, trackException } from "./observability/appInsights.js";

async function main() {
  const { app, config } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

main().catch(async (err) => {
  trackException({ exception: err instanceof Error ? err : new Error(String(err)) });
  await flushTelemetry();
  console.error(err);
  process.exit(1);
});