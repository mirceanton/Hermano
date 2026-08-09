import { count, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type {
  AlertDetail,
  AlertListItem,
  AlertTrigger,
  Delegation,
  LatestDelegationSummary,
  TimelineEvent,
} from "@hermano/shared";
import type { DbClient } from "../db/client.js";
import { alerts, type AlertRow, type AlertTriggerRow, type DelegationRow } from "../db/schema.js";
import { getAlertTriggers, getDelegationsForAlert, getLatestDelegation } from "../delegate/queries.js";

export const HISTORY_PAGE_SIZE = 25;

export function toDelegation(d: DelegationRow): Delegation {
  return {
    id: d.id,
    alertId: d.alertId,
    triggerId: d.triggerId,
    ruleId: d.ruleId,
    rule: d.ruleSnapshot,
    status: d.status,
    runId: d.runId,
    delegatedAt: d.delegatedAt.getTime(),
    dispatchedAt: d.dispatchedAt ? d.dispatchedAt.getTime() : null,
    completedAt: d.completedAt ? d.completedAt.getTime() : null,
    summary: d.summary,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    totalTokens: d.totalTokens,
    createdAt: d.createdAt.getTime(),
  };
}

function toLatestDelegationSummary(d: DelegationRow): LatestDelegationSummary {
  return {
    id: d.id,
    status: d.status,
    ruleName: d.ruleSnapshot.name,
    summary: d.summary,
    runId: d.runId,
    delegatedAt: d.delegatedAt.getTime(),
    dispatchedAt: d.dispatchedAt ? d.dispatchedAt.getTime() : null,
    completedAt: d.completedAt ? d.completedAt.getTime() : null,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    totalTokens: d.totalTokens,
  };
}

function toAlertTrigger(t: AlertTriggerRow): AlertTrigger {
  return { id: t.id, alertId: t.alertId, firedAt: t.firedAt.getTime(), createdAt: t.createdAt.getTime() };
}

export function toAlertListItem(db: DbClient, alert: AlertRow): AlertListItem {
  const triggers = getAlertTriggers(db, alert.id);
  const latest = getLatestDelegation(db, alert.id);

  return {
    id: alert.id,
    fingerprint: alert.fingerprint,
    alertName: alert.alertName,
    severity: alert.severity,
    labels: alert.labels,
    annotations: alert.annotations,
    generatorUrl: alert.generatorUrl,
    startsAt: alert.startsAt.getTime(),
    endsAt: alert.endsAt ? alert.endsAt.getTime() : null,
    resolvedAt: alert.resolvedAt ? alert.resolvedAt.getTime() : null,
    createdAt: alert.createdAt.getTime(),
    updatedAt: alert.updatedAt.getTime(),
    timesFired: triggers.length,
    firstFiredAt: triggers.length > 0 ? triggers[0]!.firedAt.getTime() : null,
    lastFiredAt: triggers.length > 0 ? triggers[triggers.length - 1]!.firedAt.getTime() : null,
    latestDelegation: latest ? toLatestDelegationSummary(latest) : null,
  };
}

/** Every currently-firing alert, most recently updated first. Unpaginated — the active-alert count is always small at this app's scale. */
export function listActiveAlerts(db: DbClient): AlertListItem[] {
  const rows = db.select().from(alerts).where(isNull(alerts.resolvedAt)).orderBy(desc(alerts.updatedAt)).all();
  return rows.map((row) => toAlertListItem(db, row));
}

/** Resolved alerts (resolvedAt IS NOT NULL), most recently resolved first, paginated. */
export function listResolvedAlerts(db: DbClient, page: number): { data: AlertListItem[]; total: number } {
  const total = db.select({ value: count() }).from(alerts).where(isNotNull(alerts.resolvedAt)).get()!.value;
  const rows = db
    .select()
    .from(alerts)
    .where(isNotNull(alerts.resolvedAt))
    .orderBy(desc(alerts.resolvedAt))
    .limit(HISTORY_PAGE_SIZE)
    .offset((page - 1) * HISTORY_PAGE_SIZE)
    .all();
  return { data: rows.map((row) => toAlertListItem(db, row)), total };
}

/** Merges an alert's firing history with its delegation lifecycle events into one chronological list. */
function buildTimeline(triggers: AlertTriggerRow[], delegations: DelegationRow[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  triggers.forEach((t, i) => {
    events.push({ at: t.firedAt.getTime(), label: i === 0 ? "First fired" : "Fired again" });
  });

  for (const d of delegations) {
    const rule = d.ruleSnapshot.name === "manual" ? "a manual delegation" : d.ruleSnapshot.name;
    if (d.delegatedAt) events.push({ at: d.delegatedAt.getTime(), label: `Delegated to ${rule}` });
    if (d.dispatchedAt) events.push({ at: d.dispatchedAt.getTime(), label: "Dispatched to Hermes" });
    if (d.completedAt) events.push({ at: d.completedAt.getTime(), label: `Agent ${delegationLabel(d.status)}` });
  }

  return events.sort((a, b) => a.at - b.at);
}

function delegationLabel(status: DelegationRow["status"]): string {
  switch (status) {
    case "pending":
      return "pending";
    case "dispatched":
      return "dispatched";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "timed_out":
      return "timed out";
  }
}

export function getAlertById(db: DbClient, id: number): AlertRow | null {
  return db.select().from(alerts).where(eq(alerts.id, id)).get() ?? null;
}

export function getAlertDetail(db: DbClient, id: number): AlertDetail | null {
  const alert = getAlertById(db, id);
  if (!alert) return null;

  const triggers = getAlertTriggers(db, alert.id);
  const delegationRows = getDelegationsForAlert(db, alert.id);

  return {
    ...toAlertListItem(db, alert),
    triggers: triggers.map(toAlertTrigger),
    delegations: delegationRows.map(toDelegation),
    timeline: buildTimeline(triggers, delegationRows),
  };
}
