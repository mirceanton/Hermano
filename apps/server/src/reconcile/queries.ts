import { and, inArray, isNull, lte } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { alerts, type AlertRow } from "../db/schema.js";

/** Every currently-active episode (resolvedAt IS NULL) — the set reconcile.ts diffs against Alertmanager's own active-alert list. */
export function getActiveAlertRows(db: DbClient): AlertRow[] {
  return db.select().from(alerts).where(isNull(alerts.resolvedAt)).all();
}

/**
 * Marks the given alerts resolved, using "now" for both endsAt and
 * resolvedAt — Alertmanager's active-alert list gives no better per-alert
 * timestamp to use instead (see issue #20). Guarded two ways against
 * racing the webhook path, so a legitimate concurrent webhook always wins:
 * resolvedAt IS NULL (skip anything a webhook already resolved) and
 * updatedAt <= asOf (skip anything a webhook touched — e.g. re-fired — after
 * the Alertmanager snapshot this call is acting on was taken; it'll be
 * reconsidered on the next reconciliation tick instead of being resolved on
 * stale information). Returns the rows this call actually resolved.
 */
export function resolveMissingAlerts(db: DbClient, alertIds: number[], asOf: Date): AlertRow[] {
  if (alertIds.length === 0) return [];
  const now = new Date();
  return db
    .update(alerts)
    .set({ endsAt: now, resolvedAt: now, updatedAt: now })
    .where(and(inArray(alerts.id, alertIds), isNull(alerts.resolvedAt), lte(alerts.updatedAt, asOf)))
    .returning()
    .all();
}
