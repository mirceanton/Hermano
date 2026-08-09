import type { DbClient } from "../db/client.js";
import type { AlertRow } from "../db/schema.js";
import type { HermesClientLike } from "../hermes/client.js";
import { pollRun, PollTimeoutError } from "../hermes/outcome.js";
import {
  countAlertTriggers,
  markDispatchFailed,
  markDispatched,
  recordDelegationOutcome,
  sweepStaleDelegations,
} from "./queries.js";

/** Bounds only the initial POST /v1/runs accept, not the run itself. */
const CREATE_RUN_TIMEOUT_MS = 15_000;
/** Bounds the best-effort stop request issued when a run is abandoned past its dispatch timeout. */
const STOP_RUN_TIMEOUT_MS = 5_000;
/** How long a rule-matched alert may sit "pending" before the sweeper gives up on it (crash-recovery net). */
const PENDING_GRACE_MS = 2 * 60_000;
/** How often the stale-delegation sweeper runs. */
const SWEEP_INTERVAL_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface DispatchOptions {
  dispatchTimeoutMs: number;
  pollIntervalMs: number;
}

/**
 * Spawns one fire-and-forget async worker per newly-pending alert: each
 * creates a Hermes run, then polls it to completion (or its own deadline)
 * entirely on its own, persisting every transition. Returns immediately —
 * Node's equivalent of Go's `go dispatchOne(alert)`.
 */
export function dispatch(db: DbClient, client: HermesClientLike, alertsToDispatch: AlertRow[], opts: DispatchOptions): void {
  for (const alert of alertsToDispatch) {
    void dispatchOne(db, client, alert, opts).catch((err) => {
      console.error(`delegate: unexpected error dispatching alert ${alert.fingerprint}`, err);
    });
  }
}

async function dispatchOne(db: DbClient, client: HermesClientLike, alert: AlertRow, opts: DispatchOptions): Promise<void> {
  if (!client.enabled()) {
    markDispatchFailed(db, alert.id, "Hermes dispatch is not configured (HERMANO_HERMES_AGENT_URL unset)");
    return;
  }

  const timesFired = countAlertTriggers(db, alert.id);

  let runId: string;
  try {
    runId = await withTimeout(client.createRun(alert, timesFired), CREATE_RUN_TIMEOUT_MS, "hermes: create-run timed out");
  } catch (err) {
    console.error(`delegate: creating hermes run failed for ${alert.fingerprint}`, err);
    markDispatchFailed(db, alert.id, err instanceof Error ? err.message : String(err));
    return;
  }

  console.info(`delegate: created hermes run for ${alert.fingerprint} (run_id=${runId})`);
  markDispatched(db, alert.id, runId);

  try {
    const outcome = await pollRun(client, runId, {
      pollIntervalMs: opts.pollIntervalMs,
      deadlineAt: Date.now() + opts.dispatchTimeoutMs,
    });
    console.info(`delegate: hermes run ${runId} finished for ${alert.fingerprint} (status=${outcome.status})`);
    recordOrWarn(db, alert, runId, outcome.status, outcome.summary, outcome.usage);
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      console.warn(`delegate: giving up on hermes run ${runId} for ${alert.fingerprint} after ${opts.dispatchTimeoutMs}ms`);
      await withTimeout(client.stopRun(runId), STOP_RUN_TIMEOUT_MS, "hermes: stop-run timed out").catch((stopErr) => {
        console.warn(`delegate: failed to stop abandoned hermes run ${runId}`, stopErr);
      });
      recordOrWarn(db, alert, runId, "timed_out", "gave up waiting for the hermes run to finish", null);
      return;
    }
    console.error(`delegate: polling hermes run ${runId} failed for ${alert.fingerprint}`, err);
    recordOrWarn(db, alert, runId, "failed", err instanceof Error ? err.message : String(err), null);
  }
}

function recordOrWarn(
  db: DbClient,
  alert: AlertRow,
  runId: string,
  status: "completed" | "failed" | "timed_out",
  summary: string,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null,
): void {
  const matched = recordDelegationOutcome(db, alert.id, status, summary, usage);
  if (!matched) {
    console.warn(`delegate: no dispatched row found to resolve for ${alert.fingerprint} (run_id=${runId}, likely already swept)`);
  }
}

export interface SweeperOptions {
  dispatchTimeoutMs: number;
  pendingGraceMs?: number;
  intervalMs?: number;
}

/**
 * Periodically marks alerts stuck "pending" (past pendingGrace) as failed,
 * and alerts stuck "dispatched" (past dispatchTimeout) as timed out. In
 * normal operation the dispatch worker resolves its own row directly once
 * its run finishes; this only matters as a restart-recovery net if the
 * server itself crashes/restarts mid-poll. Returns a stop function.
 */
export function startSweeper(db: DbClient, opts: SweeperOptions): () => void {
  const pendingGraceMs = opts.pendingGraceMs ?? PENDING_GRACE_MS;
  const intervalMs = opts.intervalMs ?? SWEEP_INTERVAL_MS;

  const timer = setInterval(() => {
    const { failed, timedOut } = sweepStaleDelegations(db, pendingGraceMs, opts.dispatchTimeoutMs);
    if (failed > 0 || timedOut > 0) {
      console.info(`delegate: swept stale delegations (failed=${failed}, timed_out=${timedOut})`);
    }
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
