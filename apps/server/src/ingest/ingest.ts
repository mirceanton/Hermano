import { and, count, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { alertTriggers, alerts, delegationRules, delegations, type AlertRow } from "../db/schema.js";
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
}

// The transaction callback's own parameter type, derived structurally so
// this file doesn't need to know drizzle's internal transaction class name.
type IngestTx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/**
 * Applies every alert in payload to the store: firing alerts are
 * deduplicated by fingerprint among currently-active episodes (each
 * notification also logs an alert_triggers row instead of just
 * incrementing a counter), and resolved alerts are marked resolved in
 * place. Dispatching newly-pending alerts to Hermes is deliberately not
 * done here — see IngestResult.newlyPending.
 */
export function processWebhook(db: DbClient, payload: WebhookPayload): IngestResult {
  const result: IngestResult = { created: 0, updated: 0, resolved: 0, newlyPending: [] };

  for (const wa of payload.alerts) {
    if (!wa.fingerprint) {
      console.warn("ingest: skipping alert with empty fingerprint", wa.labels);
      continue;
    }

    db.transaction((tx) => {
      if (wa.status === "firing") {
        const { created, newlyPending } = applyFiring(tx, wa);
        if (created) {
          result.created++;
        } else {
          result.updated++;
        }
        if (newlyPending) {
          result.newlyPending.push(newlyPending);
        }
      } else if (wa.status === "resolved") {
        applyResolved(tx, wa);
        result.resolved++;
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

function applyFiring(
  tx: IngestTx,
  wa: WebhookAlert,
): { alert: AlertRow; created: boolean; newlyPending: AlertRow | null } {
  const now = new Date();
  const labels = wa.labels;
  const annotations = wa.annotations;

  const enabledRules = tx.select().from(delegationRules).where(eq(delegationRules.enabled, true)).all();

  const existing = findActiveEpisode(tx, wa.fingerprint);

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

  if (delegationCount === 0) {
    const rule = matchRule(labels, enabledRules);
    if (rule) {
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

  return { alert, created, newlyPending };
}

function applyResolved(tx: IngestTx, wa: WebhookAlert): void {
  const now = new Date();
  const labels = wa.labels;
  const annotations = wa.annotations;
  const endsAt = isZeroTimestamp(wa.endsAt) ? now : new Date(wa.endsAt);

  const existing = findActiveEpisode(tx, wa.fingerprint);

  if (!existing) {
    // We never saw this alert firing (e.g. a restart in between): still
    // record it as an already-resolved episode on a best-effort basis
    // instead of dropping it. It's already over, so there's nothing left
    // to delegate.
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
    return;
  }

  // Resolving is a simple in-place update — alert_triggers/delegations
  // reference this row by id and need no copying.
  tx.update(alerts)
    .set({ endsAt, resolvedAt: now, updatedAt: now })
    .where(eq(alerts.id, existing.id))
    .run();
}
