import type { FastifyInstance } from "fastify";
import type { AlertDetail, AlertListItem, Paginated } from "@hermano/shared";
import { getAlertById, getAlertDetail, HISTORY_PAGE_SIZE, listActiveAlerts, listResolvedAlerts } from "../../alerts/queries.js";
import type { Config } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import { dispatch } from "../../delegate/delegate.js";
import { AlertNotFoundError, DelegationInFlightError, markManualDelegation } from "../../delegate/queries.js";
import type { HermesClientLike } from "../../hermes/client.js";

export function registerAlertRoutes(app: FastifyInstance, db: DbClient, config: Config, hermesClient: HermesClientLike): void {
  app.get<{ Querystring: { status?: string; page?: string } }>("/api/alerts", async (request): Promise<Paginated<AlertListItem>> => {
    const status = request.query.status === "resolved" ? "resolved" : "firing";

    if (status === "firing") {
      const data = listActiveAlerts(db);
      return { data, total: data.length, page: 1, pageSize: data.length || 1 };
    }

    const page = Math.max(1, Number.parseInt(request.query.page ?? "1", 10) || 1);
    const { data, total } = listResolvedAlerts(db, page);
    return { data, total, page, pageSize: HISTORY_PAGE_SIZE };
  });

  app.get<{ Params: { id: string } }>("/api/alerts/:id", async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const detail = getAlertDetail(db, id);
    if (!detail) {
      reply.code(404).send({ error: "alert not found" });
      return;
    }
    return detail satisfies AlertDetail;
  });

  app.post<{ Params: { id: string } }>("/api/alerts/:id/delegate", async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const alert = getAlertById(db, id);
    if (!alert) {
      reply.code(404).send({ error: "alert not found" });
      return;
    }
    if (alert.resolvedAt) {
      reply.code(400).send({ error: "cannot delegate a resolved alert" });
      return;
    }

    try {
      const delegatedAlert = markManualDelegation(db, id);
      dispatch(db, hermesClient, [delegatedAlert], {
        dispatchTimeoutMs: config.hermes.dispatchTimeoutMs,
        pollIntervalMs: config.hermes.pollIntervalMs,
      });
    } catch (err) {
      if (err instanceof AlertNotFoundError) {
        reply.code(404).send({ error: "alert not found" });
        return;
      }
      if (err instanceof DelegationInFlightError) {
        reply.code(409).send({ error: "delegation already in flight for this alert" });
        return;
      }
      throw err;
    }

    return getAlertDetail(db, id)! satisfies AlertDetail;
  });
}
