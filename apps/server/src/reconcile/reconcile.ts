import { AlertmanagerClient, type AlertmanagerClientLike } from "../alertmanager/client.js";
import type { Config } from "../config.js";
import type { DbClient } from "../db/client.js";
import type { AlertRow } from "../db/schema.js";
import { getActiveAlertRows, resolveMissingAlerts } from "./queries.js";

export interface ReconcileResult {
  /** Alerts marked resolved this run because Alertmanager no longer lists them as active — the whole point of this job, see issue #20. */
  resolved: AlertRow[];
}

/**
 * Reconciles locally-active alerts (resolvedAt IS NULL) against
 * Alertmanager's own live alert list, independent of webhook delivery. A
 * locally-active alert whose fingerprint is missing from Alertmanager's
 * /api/v2/alerts response gets marked resolved here — this is what recovers
 * an alert stuck "firing" forever because its one resolved-webhook delivery
 * was lost (crash/restart/network blip — see issue #20). The webhook path in
 * ingest.ts stays the fast path; this is the backstop that caps how stale
 * the active list can get to one reconciliation interval. No-ops (without
 * touching the DB at all) when client isn't configured.
 */
export async function reconcileActiveAlerts(db: DbClient, client: AlertmanagerClientLike): Promise<ReconcileResult> {
  if (!client.enabled()) return { resolved: [] };

  const asOf = new Date();
  const stillActive = await client.listActiveFingerprints();

  const locallyActive = getActiveAlertRows(db);
  const staleIds = locallyActive.filter((alert) => !stillActive.has(alert.fingerprint)).map((alert) => alert.id);

  const resolved = resolveMissingAlerts(db, staleIds, asOf);
  return { resolved };
}

/**
 * The entry point the periodic job (startReconciler, below) actually calls:
 * builds an AlertmanagerClient from the current config and hands off to
 * reconcileActiveAlerts (kept separately injectable-client for direct unit
 * testing with a fake, same split as delegate.ts's dispatchWithEffectiveConfig).
 */
export function reconcileWithEffectiveConfig(db: DbClient, config: Config): Promise<ReconcileResult> {
  const client = new AlertmanagerClient({ baseUrl: config.alertmanager.baseUrl });
  return reconcileActiveAlerts(db, client);
}

export interface ReconcilerOptions {
  intervalMs?: number;
}

/**
 * Periodically runs reconcileActiveAlerts on an interval independent of
 * webhook delivery (see issue #20). Overlap-safe: a tick that's still
 * in-flight when the next one is due is skipped rather than piling up
 * concurrent reconciliations against Alertmanager. A single failed tick
 * (Alertmanager unreachable, etc.) is logged and never crashes the process —
 * it's simply retried on the next tick. Returns a stop function.
 */
export function startReconciler(db: DbClient, config: Config, opts: ReconcilerOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? config.alertmanager.reconcileIntervalMs;

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    reconcileWithEffectiveConfig(db, config)
      .then(({ resolved }) => {
        if (resolved.length > 0) {
          console.info(`reconcile: marked ${resolved.length} alert(s) resolved (no longer active in alertmanager)`);
        }
      })
      .catch((err) => {
        console.error("reconcile: alertmanager reconciliation failed", err);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
