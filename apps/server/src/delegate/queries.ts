import { and, count, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  alertTriggers,
  alerts,
  delegations,
  type AlertRow,
  type AlertTriggerRow,
  type DelegationRow,
} from "../db/schema.js";

export class AlertNotFoundError extends Error {
  constructor() {
    super("alert not found");
    this.name = "AlertNotFoundError";
  }
}

export class DelegationInFlightError extends Error {
  constructor() {
    super("delegation already in flight");
    this.name = "DelegationInFlightError";
  }
}

export function countAlertTriggers(db: DbClient, alertId: number): number {
  const row = db.select({ value: count() }).from(alertTriggers).where(eq(alertTriggers.alertId, alertId)).get();
  return row?.value ?? 0;
}

export function getAlertTriggers(db: DbClient, alertId: number): AlertTriggerRow[] {
  return db.select().from(alertTriggers).where(eq(alertTriggers.alertId, alertId)).orderBy(alertTriggers.firedAt).all();
}

export function getDelegationsForAlert(db: DbClient, alertId: number): DelegationRow[] {
  return db.select().from(delegations).where(eq(delegations.alertId, alertId)).orderBy(delegations.delegatedAt).all();
}

export function getLatestDelegation(db: DbClient, alertId: number): DelegationRow | null {
  return (
    db
      .select()
      .from(delegations)
      .where(eq(delegations.alertId, alertId))
      .orderBy(desc(delegations.delegatedAt))
      .limit(1)
      .get() ?? null
  );
}

function hasInFlightDelegation(db: DbClient, alertId: number): boolean {
  const row = db
    .select({ value: count() })
    .from(delegations)
    .where(and(eq(delegations.alertId, alertId), inArray(delegations.status, ["pending", "dispatched"])))
    .get();
  return (row?.value ?? 0) > 0;
}

/**
 * Creates a new pending Delegation for an operator-triggered dispatch (the
 * dashboard's "delegate now"/"retry" action), bypassing rule matching
 * entirely. Unlike an automatic rule-match delegation, this isn't caused
 * by any particular trigger, so triggerId/ruleId stay null (ruleSnapshot
 * is stamped {name: "manual"}). A retry after a failure/timeout creates a
 * fresh row rather than touching the previous one, so history survives.
 * The caller is responsible for actually dispatching the returned alert.
 */
export function markManualDelegation(db: DbClient, alertId: number): AlertRow {
  const alert = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), isNull(alerts.resolvedAt)))
    .get();
  if (!alert) throw new AlertNotFoundError();
  if (hasInFlightDelegation(db, alertId)) throw new DelegationInFlightError();

  const now = new Date();
  db.insert(delegations)
    .values({
      alertId,
      ruleSnapshot: { name: "manual" },
      status: "pending",
      delegatedAt: now,
      createdAt: now,
    })
    .run();

  return alert;
}

export function markDispatched(db: DbClient, alertId: number, runId: string): void {
  db.update(delegations)
    .set({ status: "dispatched", runId, dispatchedAt: new Date() })
    .where(and(eq(delegations.alertId, alertId), eq(delegations.status, "pending")))
    .run();
}

/** Records that creating the Hermes run itself failed — a terminal outcome reached immediately, no dispatch ever happening. */
export function markDispatchFailed(db: DbClient, alertId: number, reason: string): void {
  db.update(delegations)
    .set({ status: "failed", summary: reason, completedAt: new Date() })
    .where(and(eq(delegations.alertId, alertId), eq(delegations.status, "pending")))
    .run();
}

export interface DelegationUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Resolves a dispatched delegation to a terminal status once the dispatch
 * worker's poll loop for it finishes. Returns false if no row was still
 * "dispatched" for this alert — most likely because the stale-delegation
 * sweeper already resolved it first (a benign race).
 */
export function recordDelegationOutcome(
  db: DbClient,
  alertId: number,
  status: "completed" | "failed" | "timed_out",
  summary: string,
  usage: DelegationUsage | null,
): boolean {
  const rows = db
    .update(delegations)
    .set({
      status,
      summary,
      completedAt: new Date(),
      ...(usage
        ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens }
        : {}),
    })
    .where(and(eq(delegations.alertId, alertId), eq(delegations.status, "dispatched")))
    .returning()
    .all();
  return rows.length > 0;
}

export const DELEGATIONS_PAGE_SIZE = 25;

export interface DelegationLogRow {
  delegation: DelegationRow;
  alertName: string;
  fingerprint: string;
  alertActive: boolean;
}

/** Every delegation ever created — possibly several per alert, since a retry creates a new row rather than replacing the old one — most recent first, paginated, joined against its parent alert. */
export function listDelegations(db: DbClient, page: number): { data: DelegationLogRow[]; total: number } {
  const total = db.select({ value: count() }).from(delegations).get()!.value;
  const rows = db
    .select({ delegation: delegations, alert: alerts })
    .from(delegations)
    .innerJoin(alerts, eq(delegations.alertId, alerts.id))
    .orderBy(desc(delegations.delegatedAt))
    .limit(DELEGATIONS_PAGE_SIZE)
    .offset((page - 1) * DELEGATIONS_PAGE_SIZE)
    .all();

  return {
    data: rows.map((row) => ({
      delegation: row.delegation,
      alertName: row.alert.alertName,
      fingerprint: row.alert.fingerprint,
      alertActive: row.alert.resolvedAt == null,
    })),
    total,
  };
}

/**
 * Marks delegations stuck "pending" for longer than pendingGraceMs as
 * failed (the process likely crashed between deciding to delegate and
 * ever creating a run), and delegations stuck "dispatched" for longer
 * than dispatchTimeoutMs as timed out — a restart-recovery net: in normal
 * operation the dispatch worker resolves its own row directly once its
 * run finishes.
 */
export function sweepStaleDelegations(
  db: DbClient,
  pendingGraceMs: number,
  dispatchTimeoutMs: number,
): { failed: number; timedOut: number } {
  const now = new Date();

  const failedRows = db
    .update(delegations)
    .set({ status: "failed", summary: "dispatch never completed (server restart?)", completedAt: now })
    .where(and(eq(delegations.status, "pending"), lt(delegations.delegatedAt, new Date(now.getTime() - pendingGraceMs))))
    .returning()
    .all();

  const timedOutRows = db
    .update(delegations)
    .set({ status: "timed_out", completedAt: now })
    .where(
      and(
        eq(delegations.status, "dispatched"),
        lt(delegations.dispatchedAt, new Date(now.getTime() - dispatchTimeoutMs)),
      ),
    )
    .returning()
    .all();

  return { failed: failedRows.length, timedOut: timedOutRows.length };
}
