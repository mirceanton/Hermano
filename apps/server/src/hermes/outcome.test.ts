import { describe, expect, it, vi } from "vitest";
import { HermesApiError, type HermesClientLike, type HermesRun } from "./client.js";
import { parseOutcome, pollRun, PollTimeoutError } from "./outcome.js";

describe("parseOutcome", () => {
  const cases: Array<{
    name: string;
    output: string;
    wantStatus: "completed" | "failed";
    wantSummary?: string;
  }> = [
    { name: "completed marker", output: "did the thing\nSTATUS: completed", wantStatus: "completed", wantSummary: "did the thing" },
    { name: "failed marker", output: "couldn't fix it\nSTATUS: failed", wantStatus: "failed", wantSummary: "couldn't fix it" },
    {
      name: "case insensitive and trailing whitespace",
      output: "done\nstatus:   Completed   ",
      wantStatus: "completed",
      wantSummary: "done",
    },
    {
      name: "trailing blank lines after marker are ignored",
      output: "done\nSTATUS: completed\n\n\n",
      wantStatus: "completed",
      wantSummary: "done",
    },
    {
      name: "marker mentioned mid-text but not on last line does not match",
      output: "I will report STATUS: completed once done\nstill working on it",
      wantStatus: "failed",
    },
    {
      name: "marker followed by trailing system commentary is still found",
      output:
        "root cause found, nothing to fix\nSTATUS: failed\n\n⚠️ File-mutation verifier: 1 file(s) were NOT modified.\n  • some/path — write denied",
      wantStatus: "failed",
      wantSummary: "root cause found, nothing to fix",
    },
    {
      name: "multiple marker-like lines: last one wins",
      output:
        "STATUS: completed\nwait, let me double check...\nactually I couldn't verify the fix\nSTATUS: failed",
      wantStatus: "failed",
      wantSummary: "STATUS: completed\nwait, let me double check...\nactually I couldn't verify the fix",
    },
    { name: "marker absent entirely", output: "just some prose with no marker", wantStatus: "failed" },
    { name: "empty output", output: "", wantStatus: "failed", wantSummary: "agent returned an empty response" },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      const { status, summary } = parseOutcome(tc.output);
      expect(status).toBe(tc.wantStatus);
      if (tc.wantSummary != null) {
        expect(summary).toBe(tc.wantSummary);
      }
    });
  }
});

function fakeClient(getRun: HermesClientLike["getRun"]): HermesClientLike {
  return {
    enabled: () => true,
    createRun: vi.fn(),
    getRun,
    stopRun: vi.fn(),
  };
}

function run(overrides: Partial<HermesRun>): HermesRun {
  return { runId: "run1", status: "started", output: "", usage: null, ...overrides };
}

describe("pollRun", () => {
  it("returns a completed outcome parsed from the STATUS marker", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls++;
      if (calls === 1) return run({ status: "started" });
      return run({
        status: "completed",
        output: "did X\nSTATUS: completed",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      });
    });

    const outcome = await pollRun(client, "run1", { pollIntervalMs: 5, deadlineAt: Date.now() + 5_000 });
    expect(outcome.status).toBe("completed");
    expect(outcome.summary).toBe("did X");
    expect(outcome.usage?.totalTokens).toBe(30);
  });

  it.each(["failed", "cancelled"] as const)("maps hermes status %s to a failed outcome", async (status) => {
    const client = fakeClient(async () => run({ status }));
    const outcome = await pollRun(client, "run1", { pollIntervalMs: 5, deadlineAt: Date.now() + 5_000 });
    expect(outcome.status).toBe("failed");
  });

  it("retries past transient (5xx) errors until success", async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls++;
      if (calls <= 2) throw new HermesApiError(500, "boom");
      return run({ status: "completed", output: "ok\nSTATUS: completed" });
    });

    const outcome = await pollRun(client, "run1", { pollIntervalMs: 5, deadlineAt: Date.now() + 5_000 });
    expect(outcome.status).toBe("completed");
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("aborts immediately on a hard (4xx) API error", async () => {
    const client = fakeClient(async () => {
      throw new HermesApiError(401, "unauthorized");
    });
    await expect(pollRun(client, "run1", { pollIntervalMs: 50, deadlineAt: Date.now() + 5_000 })).rejects.toThrow(
      HermesApiError,
    );
  });

  it("throws PollTimeoutError once the deadline passes while still running", async () => {
    const client = fakeClient(async () => run({ status: "started" }));
    await expect(
      pollRun(client, "run1", { pollIntervalMs: 10, deadlineAt: Date.now() + 30 }),
    ).rejects.toThrow(PollTimeoutError);
  });
});
