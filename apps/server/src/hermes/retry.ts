/** Generic retry policy: exponential backoff between attempts, gated by a caller-supplied "is this worth retrying" predicate. */
export interface RetryOptions {
  /** Total attempts, including the first try — not the retry count (attempts: 3 means up to 2 retries). */
  attempts: number;
  /** Delay before the first retry; each subsequent retry doubles it, up to maxDelayMs. */
  baseDelayMs: number;
  /** Upper bound on any single retry delay. */
  maxDelayMs: number;
  /** Only errors this accepts are retried; anything else rethrows immediately without waiting out a delay. */
  isRetryable: (err: unknown) => boolean;
  /**
   * Wall-clock deadline (a Date.now()-style timestamp) the combined
   * attempts-plus-backoff-delays must not cross. Checked before starting
   * each retry: once it's passed, no further attempt is made — even if
   * opts.attempts hasn't been exhausted — and the last error is rethrown
   * immediately. Any backoff delay is also shortened so it never itself
   * pushes past the deadline. This bounds the *delay* side of the budget;
   * bounding each individual attempt's own duration (e.g. shrinking a
   * per-request timeout to whatever's left of the budget) is the caller's
   * job, since fn is opaque here. Optional — omit for an attempt-count-only
   * policy with no wall-clock ceiling.
   */
  deadlineAt?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs fn, retrying on failure per opts: up to opts.attempts total tries,
 * waiting opts.baseDelayMs * 2^n (capped at opts.maxDelayMs, and at
 * whatever's left until opts.deadlineAt) between them. Gives up
 * immediately — no further attempts — the moment opts.isRetryable(err)
 * returns false, the attempt budget is exhausted, or opts.deadlineAt has
 * already passed; either way the last error is what escapes to the
 * caller. Deliberately dumb (no jitter, no per-error backoff tuning):
 * callers that need this are wrapping a single HTTP call inside an
 * already-bounded timeout, so the backoff here is kept short by
 * construction rather than configurable per call.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= opts.attempts || !opts.isRetryable(err)) {
        throw err;
      }
      if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
        throw err;
      }
      let delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      if (opts.deadlineAt !== undefined) {
        delay = Math.min(delay, Math.max(0, opts.deadlineAt - Date.now()));
      }
      await sleep(delay);
    }
  }
}
