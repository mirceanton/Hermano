import type { AlertRow } from "../db/schema.js";
import { RUN_INSTRUCTIONS, buildInput } from "./prompt.js";
import { withRetry } from "./retry.js";

/** Thrown for any non-2xx HTTP response. statusCode lets callers distinguish "will never succeed by retrying" (4xx) from transient (5xx). */
export class HermesApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`hermes: unexpected status ${statusCode}: ${body}`);
    this.name = "HermesApiError";
  }
}

/** Reports whether a failed Hermes call is worth retrying: 5xx/network/timeout errors might be transient, but 4xx (HermesApiError with statusCode < 500) won't resolve by retrying. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof HermesApiError) {
    return err.statusCode >= 500;
  }
  return true;
}

/**
 * Attempts (including the first) for a retried Hermes HTTP call before
 * giving up — only likely-transient failures are retried at all (see
 * isRetryableError); a 4xx never reaches a second attempt. Backoff between
 * attempts is deliberately short (low hundreds of ms, capped at a couple
 * seconds) — but attempt count and backoff alone don't bound wall-clock
 * time, since each individual attempt can itself take up to the
 * per-request timeout. requestWithRetry() below additionally takes a
 * budgetMs and shrinks each attempt's own timeout to whatever's left of
 * it, so callers wrapping this in their own outer timeout (createRun's
 * CREATE_RUN_TIMEOUT_MS, stopRun's STOP_RUN_TIMEOUT_MS, both in
 * delegate.ts) can rely on attempts-plus-backoff-plus-hung-attempts
 * together staying inside that budget with margin, not just the backoff
 * delays.
 */
const REQUEST_RETRY_ATTEMPTS = 3;
const REQUEST_RETRY_BASE_DELAY_MS = 200;
const REQUEST_RETRY_MAX_DELAY_MS = 2_000;
/** Default total wall-clock budget (all attempts + backoff + any hung-attempt timeouts) for createRun's retries. Kept meaningfully below delegate.ts's CREATE_RUN_TIMEOUT_MS (15s) so a caller that gives up at 15s never has a retry chain still running against Hermes in the background afterward. */
const DEFAULT_CREATE_RUN_RETRY_BUDGET_MS = 12_000;
/** Default total wall-clock budget for stopRun's retries. Kept meaningfully below delegate.ts's STOP_RUN_TIMEOUT_MS (5s) — the tighter of the two outer budgets. */
const DEFAULT_STOP_RUN_RETRY_BUDGET_MS = 4_000;

export interface HermesUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HermesRun {
  runId: string;
  status: string;
  output: string;
  usage: HermesUsage | null;
}

export interface HermesClientConfig {
  /** Hermes' api-server root, e.g. "http://hermes-api.ai.svc.cluster.local:8642" — no trailing slash or path. */
  baseUrl: string;
  /** Bearer token — Hermes' configured API_SERVER_KEY. */
  apiKey?: string | undefined;
  /** Bounds a single HTTP attempt (shrunk further per-attempt when retrying against a budget — see requestWithRetry), not a run's overall wall-clock budget (the caller controls that separately). */
  requestTimeoutMs?: number;
  /** Total wall-clock budget (all retry attempts + backoff combined) for createRun. Override only for tests that need this on a tight clock; production callers should rely on the default, which is already sized against delegate.ts's CREATE_RUN_TIMEOUT_MS. */
  createRunRetryBudgetMs?: number;
  /** Total wall-clock budget for stopRun's retries. Override only for tests; production callers should rely on the default, sized against delegate.ts's STOP_RUN_TIMEOUT_MS. */
  stopRunRetryBudgetMs?: number;
}

/**
 * HTTP client for Hermes' OpenAI-compatible Runs API (POST /v1/runs, GET
 * /v1/runs/{id}, POST /v1/runs/{id}/stop). There is no asynchronous
 * callback: createRun starts a run and returns as soon as Hermes has
 * accepted it; the caller (delegate/delegate.ts) polls getRun until the
 * run reaches a terminal state.
 */
export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly requestTimeoutMs: number;
  private readonly createRunRetryBudgetMs: number;
  private readonly stopRunRetryBudgetMs: number;

  constructor(config: HermesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
    this.createRunRetryBudgetMs = config.createRunRetryBudgetMs ?? DEFAULT_CREATE_RUN_RETRY_BUDGET_MS;
    this.stopRunRetryBudgetMs = config.stopRunRetryBudgetMs ?? DEFAULT_STOP_RUN_RETRY_BUDGET_MS;
  }

  enabled(): boolean {
    return this.baseUrl !== "";
  }

  /** A single HTTP attempt, no retry. timeoutMs defaults to the configured requestTimeoutMs but can be shrunk by a caller (requestWithRetry) that's spending down a shared wall-clock budget across multiple attempts. */
  private async request(path: string, init: RequestInit, timeoutMs: number = this.requestTimeoutMs): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 2048);
      throw new HermesApiError(res.status, body);
    }
    return res;
  }

  /**
   * Retries transient failures (network errors, timeouts, 5xx — see
   * isRetryableError) with a short exponential backoff, but bounds *total*
   * wall-clock time — every attempt plus every backoff delay — to
   * budgetMs. Each attempt's own per-request timeout is shrunk to
   * whatever's left of the budget (never more than the configured
   * requestTimeoutMs), so even a run of attempts that each hang for their
   * full timeout can't push this past budgetMs with more than rounding
   * error. That's what keeps a caller's own outer timeout (createRun's
   * CREATE_RUN_TIMEOUT_MS, stopRun's STOP_RUN_TIMEOUT_MS in delegate.ts)
   * safe from a retry chain still running against Hermes in the background
   * after the caller has already timed out and moved on. A 4xx
   * (HermesApiError, statusCode < 500) is rethrown from the first attempt
   * without retrying.
   */
  private async requestWithRetry(path: string, init: RequestInit, budgetMs: number): Promise<Response> {
    const deadlineAt = Date.now() + budgetMs;
    return withRetry(
      async () => {
        const attemptTimeoutMs = Math.min(this.requestTimeoutMs, deadlineAt - Date.now());
        return this.request(path, init, attemptTimeoutMs);
      },
      {
        attempts: REQUEST_RETRY_ATTEMPTS,
        baseDelayMs: REQUEST_RETRY_BASE_DELAY_MS,
        maxDelayMs: REQUEST_RETRY_MAX_DELAY_MS,
        isRetryable: isRetryableError,
        deadlineAt,
      },
    );
  }

  /**
   * Starts a Hermes run investigating alert and returns Hermes' run_id as
   * soon as it's accepted. Every call is a wholly fresh, stateless run: no
   * session/previous-response id is sent, so a delegation never inherits
   * context from a prior investigation of the same alert. timesFired is
   * looked up by the caller since this client stays database-agnostic.
   * instructions defaults to the built-in RUN_INSTRUCTIONS but can be
   * overridden per-call with the Settings page's custom system prompt.
   * Retries transient failures (requestWithRetry) within createRunRetryBudgetMs.
   */
  async createRun(alert: AlertRow, timesFired: number, instructions: string = RUN_INSTRUCTIONS): Promise<string> {
    const res = await this.requestWithRetry(
      "/v1/runs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: buildInput(alert, timesFired),
          instructions,
        }),
      },
      this.createRunRetryBudgetMs,
    );
    const decoded = (await res.json()) as { run_id?: string };
    if (!decoded.run_id) {
      throw new Error("hermes: create-run response had an empty run_id");
    }
    return decoded.run_id;
  }

  /**
   * Deliberately a single attempt, not retried here: pollRun (outcome.ts)
   * already wraps its calls to this in its own wait-and-retry loop, gated
   * by the same isRetryableError predicate and re-checking its overall
   * deadline every pollIntervalMs. Layering requestWithRetry's own
   * multi-attempt-plus-backoff on top would let one getRun() call
   * internally burn several times pollIntervalMs before pollRun ever got a
   * chance to re-check its deadline, overshooting dispatchTimeoutMs by an
   * uncoordinated amount. One retry layer is enough; pollRun's is the one
   * that stays coordinated with the poll cadence and its own deadline.
   */
  async getRun(runId: string): Promise<HermesRun> {
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" });
    const decoded = (await res.json()) as {
      run_id: string;
      status: string;
      output: string;
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
    };
    return {
      runId: decoded.run_id,
      status: decoded.status,
      output: decoded.output,
      usage: decoded.usage
        ? {
            inputTokens: decoded.usage.input_tokens,
            outputTokens: decoded.usage.output_tokens,
            totalTokens: decoded.usage.total_tokens,
          }
        : null,
    };
  }

  /** Best-effort interrupt of an in-progress run. Retries transient failures (requestWithRetry) within stopRunRetryBudgetMs; errors are non-fatal to the caller either way. */
  async stopRun(runId: string): Promise<void> {
    try {
      await this.requestWithRetry(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" }, this.stopRunRetryBudgetMs);
    } catch {
      // Best-effort: the caller has already given up on this run either way.
    }
  }
}

/** The subset of HermesClient's public API that outcome/delegate logic depends on — lets tests substitute a fake without instantiating the real class. */
export type HermesClientLike = Pick<HermesClient, "enabled" | "createRun" | "getRun" | "stopRun">;
