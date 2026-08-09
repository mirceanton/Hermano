import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthGuard } from "../auth/guard.js";
import type { Config } from "../config.js";
import type { DbClient } from "../db/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerDelegationRoutes } from "./routes/delegations.js";
import { registerOverviewRoute } from "./routes/overview.js";
import { registerRuleRoutes } from "./routes/rules.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerWebhookRoute } from "./routes/webhook.js";
import { registerStaticSpa } from "./static.js";

export function buildApp(db: DbClient, config: Config): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
  });

  app.register(cookie, { secret: config.sessionSecret ?? undefined });

  registerHealthRoute(app);
  registerAuthGuard(app, db, config);
  registerAuthRoutes(app, db, config);
  registerWebhookRoute(app, db, config);
  registerOverviewRoute(app, db);
  registerAlertRoutes(app, db, config);
  registerDelegationRoutes(app, db);
  registerRuleRoutes(app, db);
  registerSettingsRoutes(app, db, config);

  if (config.staticWebDir) {
    registerStaticSpa(app, config.staticWebDir);
  }

  return app;
}
