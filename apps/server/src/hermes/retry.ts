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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs fn, retrying on failure per opts: up to opts.attempts total tries,
 * waiting opts.baseDelayMs * 2^n (capped at opts.maxDelayMs) between them.
 * Gives up immediately — no further attempts — the moment
 * opts.isRetryable(err) returns false, or once the attempt budget is
 * exhausted; either way the last error is what escapes to the caller.
 * Deliberately dumb (no jitter, no per-error backoff tuning): callers that
 * need this are wrapping a single HTTP call inside an already-bounded
 * timeout, so the backoff here is kept short by construction rather than
 * configurable per call.
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
      const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
}
