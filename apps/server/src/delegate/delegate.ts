import type { Config } from "../config.js";
import type { DbClient } from "../db/client.js";
import type { AlertRow, DelegationRow, SettingsRow } from "../db/schema.js";
import { HermesClient, type HermesClientLike } from "../hermes/client.js";
import { pollRun, PollTimeoutError } from "../hermes/outcome.js";
import { getProfile } from "../profiles/queries.js";
import { notifyDelegationOutcome } from "../pushover/notify.js";
import { effectiveHermesConfig, effectiveSystemPrompt } from "../settings/effective.js";
import { getSettingsRow } from "../settings/queries.js";
import {
  cancelDispatchedDelegation,
  countAlertTriggers,
  getLatestDelegation,
  markDispatchFailed,
  markDispatched,
  NoCancellableDelegationError,
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
  /** Defaults to hermes/prompt.ts's RUN_INSTRUCTIONS inside HermesClient.createRun when omitted. */
  instructions?: string;
  /** Called once a terminal outcome is actually persisted (i.e. recordDelegationOutcome matched a row) — e.g. to fire a Pushover notification. Never awaited; errors are the caller's responsibility. */
  onOutcome?: (alert: AlertRow, status: "completed" | "failed" | "timed_out", summary: string) => void;
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

/**
 * Builds the HermesClient for wherever a delegation was routed: its
 * recorded profile's own URL and key, or — when it has none — the default
 * endpoint (env override, else the Settings page, see settings/effective.ts).
 * Returns null when the delegation names a profile that has since been
 * deleted; callers must treat that as "unreachable" rather than falling
 * back to the default endpoint, which would hand the alert to a different
 * bot than the rule asked for. Timeouts, poll interval and the system
 * prompt are deliberately not per-profile: they stay the global settings.
 */
function clientForDelegation(
  db: DbClient,
  config: Config,
  settings: SettingsRow,
  delegation: DelegationRow | null,
): HermesClient | null {
  if (delegation?.profileId != null) {
    const profile = getProfile(db, delegation.profileId);
    return profile ? new HermesClient({ baseUrl: profile.url, apiKey: profile.apiKey ?? undefined }) : null;
  }
  // profileId is nulled out when its profile is deleted, but the name frozen
  // in the snapshot survives — that's how "deleted" differs from "default".
  if (delegation?.ruleSnapshot.profile) return null;

  const hermes = effectiveHermesConfig(config, settings);
  return new HermesClient({ baseUrl: hermes.baseUrl, apiKey: hermes.apiKey });
}

/**
 * The entry point route handlers actually call: resolves the current
 * effective Hermes config + system prompt (env override, else whatever's
 * saved on the Settings page, else the built-in default — see
 * settings/effective.ts) fresh for this dispatch, builds a HermesClient
 * for each alert's own routing (clientForDelegation — different alerts in
 * one webhook batch can go to different Hermes profiles), and hands off to
 * dispatch() above. Keeping dispatch() itself taking an injectable client
 * is what keeps it directly unit-testable with a fake client, unrelated to
 * this settings-resolution concern.
 */
export function dispatchWithEffectiveConfig(db: DbClient, config: Config, alertsToDispatch: AlertRow[]): void {
  const settings = getSettingsRow(db);
  const hermes = effectiveHermesConfig(config, settings);
  const opts: DispatchOptions = {
    dispatchTimeoutMs: hermes.dispatchTimeoutMs,
    pollIntervalMs: hermes.pollIntervalMs,
    instructions: effectiveSystemPrompt(settings),
    onOutcome: (alert, status, summary) => {
      void notifyDelegationOutcome(db, config, alert, status, summary).catch((err) => {
        console.error(`pushover: notifying delegation outcome failed for ${alert.fingerprint}`, err);
      });
    },
  };

  for (const alert of alertsToDispatch) {
    const delegation = getLatestDelegation(db, alert.id);
    const client = clientForDelegation(db, config, settings, delegation);
    if (!client) {
      markDispatchFailed(db, alert.id, `Hermes profile "${delegation?.ruleSnapshot.profile}" no longer exists`);
      continue;
    }
    dispatch(db, client, [alert], opts);
  }
}

/**
 * Cancels an alert's currently-dispatched delegation: best-effort stops the
 * underlying Hermes run, then unconditionally marks the delegation
 * "cancelled" regardless of whether that stop actually succeeded — mirrors
 * dispatchOne's own handling of the dispatch-timeout path, where stopRun is
 * likewise best-effort and never blocks recording the outcome. The operator
 * clicking Cancel means "stop tracking/paging for this run," which a failed
 * remote stop shouldn't get in the way of. Throws NoCancellableDelegationError
 * if the alert's latest delegation isn't currently "dispatched" (nothing to
 * cancel) — callers map that to a 409.
 */
export async function cancelDelegation(db: DbClient, client: HermesClientLike | null, alertId: number): Promise<void> {
  const delegation = getLatestDelegation(db, alertId);
  if (!delegation || delegation.status !== "dispatched" || !delegation.runId) {
    throw new NoCancellableDelegationError();
  }

  const runId = delegation.runId;
  if (client) {
    await withTimeout(client.stopRun(runId), STOP_RUN_TIMEOUT_MS, "hermes: stop-run timed out").catch((err) => {
      console.warn(`delegate: failed to stop hermes run ${runId} while cancelling`, err);
    });
  } else {
    // A null client means the run's Hermes profile has been deleted, so
    // there's nowhere left to send the stop to — same best-effort stance as
    // a failed stop above: the operator's Cancel still takes effect locally.
    console.warn(`delegate: hermes profile for run ${runId} no longer exists; marking it cancelled without stopping it`);
  }

  cancelDispatchedDelegation(db, alertId, "cancelled by user");
}

/**
 * The entry point route handlers actually call for cancellation — builds
 * the HermesClient for the endpoint the delegation was actually dispatched
 * to (its profile, not whatever the default is today: a stop request sent
 * to the wrong Hermes would silently leave the real run going), and hands
 * off to cancelDelegation() above (kept separately injectable-client for
 * direct unit testing with a fake client).
 */
export function cancelDelegationWithEffectiveConfig(db: DbClient, config: Config, alertId: number): Promise<void> {
  const settings = getSettingsRow(db);
  const client = clientForDelegation(db, config, settings, getLatestDelegation(db, alertId));
  return cancelDelegation(db, client, alertId);
}

async function dispatchOne(db: DbClient, client: HermesClientLike, alert: AlertRow, opts: DispatchOptions): Promise<void> {
  if (!client.enabled()) {
    markDispatchFailed(db, alert.id, "Hermes dispatch is not configured (HERMANO_HERMES_AGENT_URL unset)");
    return;
  }

  const timesFired = countAlertTriggers(db, alert.id);

  let runId: string;
  try {
    runId = await withTimeout(
      client.createRun(alert, timesFired, opts.instructions),
      CREATE_RUN_TIMEOUT_MS,
      "hermes: create-run timed out",
    );
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
    recordOrWarn(db, alert, runId, outcome.status, outcome.summary, outcome.usage, opts.onOutcome);
  } catch (err) {
    if (err instanceof PollTimeoutError) {
      console.warn(`delegate: giving up on hermes run ${runId} for ${alert.fingerprint} after ${opts.dispatchTimeoutMs}ms`);
      await withTimeout(client.stopRun(runId), STOP_RUN_TIMEOUT_MS, "hermes: stop-run timed out").catch((stopErr) => {
        console.warn(`delegate: failed to stop abandoned hermes run ${runId}`, stopErr);
      });
      recordOrWarn(db, alert, runId, "timed_out", "gave up waiting for the hermes run to finish", null, opts.onOutcome);
      return;
    }
    console.error(`delegate: polling hermes run ${runId} failed for ${alert.fingerprint}`, err);
    recordOrWarn(db, alert, runId, "failed", err instanceof Error ? err.message : String(err), null, opts.onOutcome);
  }
}

function recordOrWarn(
  db: DbClient,
  alert: AlertRow,
  runId: string,
  status: "completed" | "failed" | "timed_out",
  summary: string,
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null,
  onOutcome: DispatchOptions["onOutcome"],
): void {
  const matched = recordDelegationOutcome(db, alert.id, status, summary, usage);
  if (!matched) {
    console.warn(`delegate: no dispatched row found to resolve for ${alert.fingerprint} (run_id=${runId}, likely already swept)`);
    return;
  }
  onOutcome?.(alert, status, summary);
}

export interface SweeperOptions {
  pendingGraceMs?: number;
  intervalMs?: number;
}

/**
 * Periodically marks alerts stuck "pending" (past pendingGrace) as failed,
 * and alerts stuck "dispatched" (past dispatchTimeout) as timed out. In
 * normal operation the dispatch worker resolves its own row directly once
 * its run finishes; this only matters as a restart-recovery net if the
 * server itself crashes/restarts mid-poll. dispatchTimeoutMs is resolved
 * fresh (env override, else Settings-page value, else default) on every
 * tick, so a Settings-page change is picked up within one interval, not
 * just at boot. Returns a stop function.
 */
export function startSweeper(db: DbClient, config: Config, opts: SweeperOptions = {}): () => void {
  const pendingGraceMs = opts.pendingGraceMs ?? PENDING_GRACE_MS;
  const intervalMs = opts.intervalMs ?? SWEEP_INTERVAL_MS;

  const timer = setInterval(() => {
    const dispatchTimeoutMs = effectiveHermesConfig(config, getSettingsRow(db)).dispatchTimeoutMs;
    const { failed, timedOut } = sweepStaleDelegations(db, pendingGraceMs, dispatchTimeoutMs);
    if (failed > 0 || timedOut > 0) {
      console.info(`delegate: swept stale delegations (failed=${failed}, timed_out=${timedOut})`);
    }
  }, intervalMs);
  timer.unref();

  return () => clearInterval(timer);
}
