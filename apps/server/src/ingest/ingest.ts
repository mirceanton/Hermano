import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import {
  alertTriggers,
  alerts,
  delegationRules,
  delegations,
  type AlertRow,
  type DelegationRow,
} from "../db/schema.js";
import { matchRule } from "../rules/matcher.js";
import { isZeroTimestamp, type WebhookAlert, type WebhookPayload } from "./payload.js";

export interface IngestResult {
  created: number;
  updated: number;
  resolved: number;
  /**
   * Every alert that just matched a delegation rule for the first time (a
   * pending Delegation row was created). The caller is responsible for
   * actually dispatching these to Hermes (an HTTP call, which does not
   * belong inside this function's DB transactions) and recording the
   * outcome.
   */
  newlyPending: AlertRow[];
  /** New episodes that, on creation, matched no delegation rule — nobody is watching these. Worth a Pushover push. */
  newlyUnmanaged: AlertRow[];
  /** Resolved episodes that were never delegated at all (matches AlertManager's own resolved notification for anything not covered by a rule). */
  resolvedUnmanaged: AlertRow[];
  /** Alerts that fired again after previously being marked "completed" by Hermes — the fix likely didn't hold. */
  recurrences: AlertRow[];
}

// The transaction callback's own parameter type, derived structurally so
// this file doesn't need to know drizzle's internal transaction class name.
type IngestTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Applies every alert in payload to the store: firing alerts are
 * deduplicated by fingerprint among currently-active episodes (each
 * notification also logs an alert_triggers row instead of just
 * incrementing a counter), and resolved alerts are marked resolved in
 * place. Dispatching newly-pending alerts to Hermes, and pushing any
 * Pushover notifications, is deliberately not done here — see
 * IngestResult's newlyPending/newlyUnmanaged/resolvedUnmanaged/recurrences.
 */
export function processWebhook(db: DbClient, payload: WebhookPayload): IngestResult {
  const result: IngestResult = {
    created: 0,
    updated: 0,
    resolved: 0,
    newlyPending: [],
    newlyUnmanaged: [],
    resolvedUnmanaged: [],
    recurrences: [],
  };

  for (const wa of payload.alerts) {
    if (!wa.fingerprint) {
      console.warn("ingest: skipping alert with empty fingerprint", wa.labels);
      continue;
    }

    db.transaction((tx) => {
      if (wa.status === "firing") {
        const { alert, created, newlyPending, newlyUnmanaged, recurrence } = applyFiring(tx, wa);
        if (created) {
          result.created++;
        } else {
          result.updated++;
        }
        if (newlyPending) result.newlyPending.push(newlyPending);
        if (newlyUnmanaged) result.newlyUnmanaged.push(alert);
        if (recurrence) result.recurrences.push(alert);
      } else if (wa.status === "resolved") {
        const { resolvedUnmanaged } = applyResolved(tx, wa);
        result.resolved++;
        if (resolvedUnmanaged) result.resolvedUnmanaged.push(resolvedUnmanaged);
      } else {
        console.warn("ingest: unknown alert status", wa.status, wa.fingerprint);
      }
    });
  }

  return result;
}

function findActiveEpisode(tx: IngestTx, fingerprint: string): AlertRow | undefined {
  return tx
    .select()
    .from(alerts)
    .where(and(eq(alerts.fingerprint, fingerprint), isNull(alerts.resolvedAt)))
    .get();
}

/** The fingerprint's most recent episode, active or not — used to look at a resolved episode's history when a brand-new one is about to be created. */
function findMostRecentEpisode(tx: IngestTx, fingerprint: string): AlertRow | undefined {
  return tx.select().from(alerts).where(eq(alerts.fingerprint, fingerprint)).orderBy(desc(alerts.id)).limit(1).get();
}

function getLatestDelegationTx(tx: IngestTx, alertId: number): DelegationRow | undefined {
  return tx.select().from(delegations).where(eq(delegations.alertId, alertId)).orderBy(desc(delegations.delegatedAt)).limit(1).get();
}

function applyFiring(
  tx: IngestTx,
  wa: WebhookAlert,
): { alert: AlertRow; created: boolean; newlyPending: AlertRow | null; newlyUnmanaged: boolean; recurrence: boolean } {
  const now = new Date();
  const labels = wa.labels;
  const annotations = wa.annotations;

  const enabledRules = tx.select().from(delegationRules).where(eq(delegationRules.enabled, true)).all();

  const existing = findActiveEpisode(tx, wa.fingerprint);
  // Only looked up when !existing (a brand-new episode is about to be
  // created) — this is the fingerprint's last episode, which must already
  // be resolved since we just confirmed there's no active one.
  const priorEpisode = existing ? undefined : findMostRecentEpisode(tx, wa.fingerprint);

  let alert: AlertRow;
  let created: boolean;
  if (!existing) {
    alert = tx
      .insert(alerts)
      .values({
        fingerprint: wa.fingerprint,
        alertName: labels["alertname"] ?? "",
        severity: labels["severity"] ?? "",
        labels,
        annotations,
        generatorUrl: wa.generatorURL,
        startsAt: new Date(wa.startsAt),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    created = true;
  } else {
    alert = tx
      .update(alerts)
      .set({
        labels,
        annotations,
        severity: labels["severity"] ?? "",
        updatedAt: now,
      })
      .where(eq(alerts.id, existing.id))
      .returning()
      .get();
    created = false;
  }

  const trigger = tx
    .insert(alertTriggers)
    .values({ alertId: alert.id, firedAt: now, createdAt: now })
    .returning()
    .get();

  let newlyPending: AlertRow | null = null;
  const { value: delegationCount } = tx
    .select({ value: count() })
    .from(delegations)
    .where(eq(delegations.alertId, alert.id))
    .get()!;

  let matchedRule = false;
  if (delegationCount === 0) {
    const rule = matchRule(labels, enabledRules);
    if (rule) {
      matchedRule = true;
      tx.insert(delegations)
        .values({
          alertId: alert.id,
          triggerId: trigger.id,
          ruleId: rule.id,
          ruleSnapshot: { name: rule.name, matchers: rule.matchers },
          status: "pending",
          delegatedAt: now,
          createdAt: now,
        })
        .run();
      newlyPending = alert;
    }
  }

  const newlyUnmanaged = created && delegationCount === 0 && !matchedRule;

  // Recurrence: this firing notification arrives even though the most
  // relevant prior delegation (this episode's own, if it's still active
  // and already resolved by Hermes; otherwise the immediately-preceding
  // episode's, if this is a brand-new one) already reads "completed" —
  // the fix apparently didn't hold.
  const relevantPriorDelegation = created
    ? priorEpisode
      ? getLatestDelegationTx(tx, priorEpisode.id)
      : undefined
    : getLatestDelegationTx(tx, alert.id);
  const recurrence = relevantPriorDelegation?.status === "completed";

  return { alert, created, newlyPending, newlyUnmanaged, recurrence };
}

function applyResolved(tx: IngestTx, wa: WebhookAlert): { resolvedUnmanaged: AlertRow | null } {
  const now = new Date();
  const labels = wa.labels;
  const annotations = wa.annotations;
  const endsAt = isZeroTimestamp(wa.endsAt) ? now : new Date(wa.endsAt);

  const existing = findActiveEpisode(tx, wa.fingerprint);

  if (!existing) {
    // We never saw this alert firing (e.g. a restart in between): still
    // record it as an already-resolved episode on a best-effort basis
    // instead of dropping it. There's nothing left to delegate, and no
    // meaningful "was it managed?" story to tell, so no notification signal.
    tx.insert(alerts)
      .values({
        fingerprint: wa.fingerprint,
        alertName: labels["alertname"] ?? "",
        severity: labels["severity"] ?? "",
        labels,
        annotations,
        generatorUrl: wa.generatorURL,
        startsAt: new Date(wa.startsAt),
        endsAt,
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return { resolvedUnmanaged: null };
  }

  const { value: delegationCount } = tx
    .select({ value: count() })
    .from(delegations)
    .where(eq(delegations.alertId, existing.id))
    .get()!;

  // Resolving is a simple in-place update — alert_triggers/delegations
  // reference this row by id and need no copying.
  tx.update(alerts)
    .set({ endsAt, resolvedAt: now, updatedAt: now })
    .where(eq(alerts.id, existing.id))
    .run();

  return { resolvedUnmanaged: delegationCount === 0 ? existing : null };
}
