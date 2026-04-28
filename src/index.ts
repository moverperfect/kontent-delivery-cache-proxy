import { buildServer } from "./server.js";

async function main() {
  const { app, config } = await buildServer();
  await app.listen({ host: "0.0.0.0", port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
