import { buildApp } from "./api/app.js";
import { initOidcClient } from "./auth/oidc.js";
import { loadConfig } from "./config.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { startSweeper } from "./delegate/delegate.js";
import { HermesClient } from "./hermes/client.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDbClient(config.databasePath);
  runMigrations(db);

  if (config.oidc) {
    await initOidcClient(config.oidc);
  }

  const hermesClient = new HermesClient({ baseUrl: config.hermes.baseUrl, apiKey: config.hermes.apiKey });

  const app = buildApp(db, config, hermesClient);
  app.log.info(config.oidc ? `OIDC auth enabled (issuer: ${config.oidc.issuerUrl})` : "single-user mode (no OIDC configured)");
  app.log.info(hermesClient.enabled() ? `Hermes dispatch enabled (${config.hermes.baseUrl})` : "Hermes dispatch is not configured");

  const stopSweeper = startSweeper(db, { dispatchTimeoutMs: config.hermes.dispatchTimeoutMs });
  app.addHook("onClose", async () => {
    stopSweeper();
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
