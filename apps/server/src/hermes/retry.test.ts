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
});
