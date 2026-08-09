import type { FastifyInstance } from "fastify";
import type { WebhookIngestResult } from "@hermano/shared";
import type { Config } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import { dispatchWithEffectiveConfig } from "../../delegate/delegate.js";
import { processWebhook } from "../../ingest/ingest.js";
import { webhookPayloadSchema } from "../../ingest/payload.js";

export function registerWebhookRoute(app: FastifyInstance, db: DbClient, config: Config): void {
  app.post("/api/webhook", async (request, reply): Promise<WebhookIngestResult | undefined> => {
    if (config.webhookSharedSecret) {
      const header = request.headers.authorization;
      if (header !== `Bearer ${config.webhookSharedSecret}`) {
        reply.code(401).send({ error: "invalid or missing webhook token" });
        return;
      }
    }

    const parsed = webhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: `invalid webhook payload: ${parsed.error.message}` });
      return;
    }

    const result = processWebhook(db, parsed.data);

    if (result.newlyPending.length > 0) {
      // Fire-and-forget: dispatching to Hermes is an HTTP call that
      // doesn't belong in the request/response cycle — Alertmanager just
      // needs a prompt 200 for its own delivery bookkeeping.
      dispatchWithEffectiveConfig(db, config, result.newlyPending);
    }

    return { created: result.created, updated: result.updated, resolved: result.resolved };
  });
}
