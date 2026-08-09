import { count, eq, inArray, isNotNull, isNull, sum } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { OverviewStats } from "@hermano/shared";
import type { DbClient } from "../../db/client.js";
import { alerts, delegationRules, delegations } from "../../db/schema.js";
import { getLatestDelegation } from "../../delegate/queries.js";

function getOverviewStats(db: DbClient): OverviewStats {
  const openAlerts = db.select({ value: count() }).from(alerts).where(isNull(alerts.resolvedAt)).get()!.value;
  const totalResolved = db.select({ value: count() }).from(alerts).where(isNotNull(alerts.resolvedAt)).get()!.value;

  const dispatched = db
    .select({ value: count() })
    .from(delegations)
    .where(isNotNull(delegations.dispatchedAt))
    .get()!.value;
  const completed = db.select({ value: count() }).from(delegations).where(eq(delegations.status, "completed")).get()!.value;
  const failed = db
    .select({ value: count() })
    .from(delegations)
    .where(inArray(delegations.status, ["failed", "timed_out"]))
    .get()!.value;

  const totalTokens = Number(db.select({ value: sum(delegations.totalTokens) }).from(delegations).get()?.value ?? 0);

  const totalRules = db.select({ value: count() }).from(delegationRules).get()!.value;
  const activeRules = db
    .select({ value: count() })
    .from(delegationRules)
    .where(eq(delegationRules.enabled, true))
    .get()!.value;

  // undelegatedActive/failedActive need each active alert's most recent
  // delegation (if any), which isn't cached anywhere — computed by
  // iterating rather than a correlated subquery, since the active-alert
  // count is always small at this app's scale.
  const active = db.select().from(alerts).where(isNull(alerts.resolvedAt)).all();
  let undelegatedActive = 0;
  let failedActive = 0;
  for (const alert of active) {
    const latest = getLatestDelegation(db, alert.id);
    if (!latest) {
      undelegatedActive++;
    } else if (latest.status === "failed" || latest.status === "timed_out") {
      failedActive++;
    }
  }

  return {
    openAlerts,
    totalResolved,
    dispatched,
    completed,
    failed,
    activeRules,
    totalRules,
    totalTokens,
    undelegatedActive,
    failedActive,
  };
}

export function registerOverviewRoute(app: FastifyInstance, db: DbClient): void {
  app.get("/api/overview", async (): Promise<OverviewStats> => getOverviewStats(db));
}
