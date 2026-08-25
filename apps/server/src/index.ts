import { buildApp } from "./api/app.js";
import { initOidcClient } from "./auth/oidc.js";
import { loadConfig, type Config } from "./config.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { startSweeper } from "./delegate/delegate.js";
import { effectiveOidcConfig } from "./settings/effective.js";
import { ensureSessionSecret, getSettingsRow } from "./settings/queries.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDbClient(config.databasePath);
  runMigrations(db);

  // Merge the Settings page's DB-persisted OIDC config (if any) into the
  // env-only config loadConfig() returned — env still always wins (see
  // EnvLocks). This is a boot-time-only merge: OIDC config saved via the
  // Settings page takes effect on the *next* restart, same as editing an
  // env var would, since the cookie secret and OIDC discovery below are
  // themselves fixed for the life of this process.
  const settings = getSettingsRow(db);
  const runtimeConfig: Config = {
    ...config,
    oidc: effectiveOidcConfig(config, settings),
    sessionSecret: config.sessionSecret ?? ensureSessionSecret(db),
  };

  if (runtimeConfig.oidc) {
    await initOidcClient(runtimeConfig.oidc);
  }

  const app = buildApp(db, runtimeConfig);
  app.log.info(
    runtimeConfig.oidc ? `OIDC auth enabled (issuer: ${runtimeConfig.oidc.issuerUrl})` : "single-user mode (no OIDC configured)",
  );
  app.log.info(
    config.hermes.baseUrl !== ""
      ? `Hermes dispatch enabled (${config.hermes.baseUrl})`
      : "Hermes dispatch is not configured via environment — check the Settings page",
  );

  const stopSweeper = startSweeper(db, runtimeConfig);
  app.addHook("onClose", async () => {
    stopSweeper();
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });

  // Graceful shutdown: stop accepting new connections and run onClose hooks
  // (including the sweeper above) before exiting. In-flight dispatchOne
  // workers (see delegate.ts) are not awaited here — they poll a Hermes run
  // to completion with no cancellation hook, so waiting on them would need
  // its own bounded grace period; the sweeper's crash-recovery sweep on next
  // boot already resolves any delegation abandoned mid-flight. A repeated
  // signal while shutdown is already in progress is a no-op.
  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info(`received ${signal}, shutting down gracefully`);
      app.close().then(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
