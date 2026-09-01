import { describe, expect, it } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries a retryable failure and returns once it succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("permanent");
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => false },
      ),
    ).rejects.toThrow("permanent");
    expect(calls).toBe(1);
  });

  it("gives up after exhausting the attempt budget", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("always transient");
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 5, isRetryable: () => true },
      ),
    ).rejects.toThrow("always transient");
    expect(calls).toBe(3);
  });

  it("stops retrying once deadlineAt has passed, even with attempt budget left", async () => {
    let calls = 0;
    const deadlineAt = Date.now() + 20;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("transient");
        },
        // Large backoff/attempts budget on paper, but deadlineAt is what should cut this short.
        { attempts: 10, baseDelayMs: 1_000, maxDelayMs: 5_000, isRetryable: () => true, deadlineAt },
      ),
    ).rejects.toThrow("transient");
    expect(calls).toBeLessThan(10);
    expect(Date.now()).toBeLessThan(deadlineAt + 50);
  });

  it("shortens a backoff delay so it doesn't itself overshoot deadlineAt", async () => {
    let calls = 0;
    const start = Date.now();
    const deadlineAt = start + 30;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("transient");
        },
        // baseDelayMs (5000) would blow way past a 30ms deadline if not capped.
        { attempts: 5, baseDelayMs: 5_000, maxDelayMs: 5_000, isRetryable: () => true, deadlineAt },
      ),
    ).rejects.toThrow("transient");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
