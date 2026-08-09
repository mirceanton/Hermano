import type { FastifyInstance } from "fastify";
import type { DelegationLogEntry, Paginated } from "@hermano/shared";
import { toDelegation } from "../../alerts/queries.js";
import type { DbClient } from "../../db/client.js";
import { DELEGATIONS_PAGE_SIZE, listDelegations } from "../../delegate/queries.js";

export function registerDelegationRoutes(app: FastifyInstance, db: DbClient): void {
  app.get<{ Querystring: { page?: string } }>("/api/delegations", async (request): Promise<Paginated<DelegationLogEntry>> => {
    const page = Math.max(1, Number.parseInt(request.query.page ?? "1", 10) || 1);
    const { data, total } = listDelegations(db, page);

    return {
      data: data.map((row) => ({
        ...toDelegation(row.delegation),
        alertName: row.alertName,
        fingerprint: row.fingerprint,
        alertActive: row.alertActive,
      })),
      total,
      page,
      pageSize: DELEGATIONS_PAGE_SIZE,
    };
  });
}
