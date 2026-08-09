import { HermesApiError, type HermesClientLike, type HermesUsage } from "./client.js";

export interface ParsedOutcome {
  status: "completed" | "failed";
  summary: string;
}

const STATUS_MARKER_RE = /^STATUS:\s*(completed|failed)\s*$/i;

/**
 * Derives {status, summary} from a completed run's raw output, per the
 * STATUS-marker contract in prompt.ts's RUN_INSTRUCTIONS. Scans for the
 * LAST line that's an exact "STATUS: completed"/"STATUS: failed" match,
 * not requiring it to be the literal last line — Hermes sometimes appends
 * trailing system commentary after the agent's actual response, so the
 * marker often isn't the final line even when the agent complied
 * correctly. Everything before the matched line becomes the summary;
 * anything after it (trailing system noise) is dropped. If no line
 * matches anywhere, this conservatively reports "failed" with the full
 * raw output as the summary, rather than silently guessing "completed" —
 * a prompt-compliance failure should be visible, not hidden.
 */
export function parseOutcome(output: string): ParsedOutcome {
  const lines = output.replace(/[\n\r\t ]+$/, "").split("\n");

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]!.trim();
    if (trimmed === "") continue;
    const m = STATUS_MARKER_RE.exec(trimmed);
    if (!m) continue;

    let summary = lines.slice(0, i).join("\n").trim();
    if (summary === "") {
      summary = "(agent gave no summary before its STATUS marker)";
    }
    const status: ParsedOutcome["status"] = m[1]!.toLowerCase() === "completed" ? "completed" : "failed";
    return { status, summary };
  }

  if (output.trim() === "") {
    return { status: "failed", summary: "agent returned an empty response" };
  }
  return {
    status: "failed",
    summary:
      "agent finished without a STATUS marker anywhere in its response (prompt-compliance issue) - full output:\n" +
      output.trim(),
  };
}

/** Reports whether a poll error is worth waiting out and retrying: 5xx/network errors might be Hermes restarting, but 4xx won't resolve by waiting. */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof HermesApiError) {
    return err.statusCode >= 500;
  }
  return true;
}

export class PollTimeoutError extends Error {
  constructor(message = "gave up waiting for the hermes run to finish") {
    super(message);
    this.name = "PollTimeoutError";
  }
}

export interface PollOutcome extends ParsedOutcome {
  usage: HermesUsage | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks, calling GET /v1/runs/{id} every pollIntervalMs, until the run
 * reaches a Hermes-terminal status ("completed"/"failed"/"cancelled") or
 * deadlineAt passes (PollTimeoutError). An unrecognized status value is
 * treated the same as "still running" — forward-compatible: fail open
 * toward waiting, not misclassifying an unknown future status.
 */
export async function pollRun(
  client: HermesClientLike,
  runId: string,
  opts: { pollIntervalMs: number; deadlineAt: number },
): Promise<PollOutcome> {
  for (;;) {
    if (Date.now() > opts.deadlineAt) {
      throw new PollTimeoutError();
    }

    let run;
    try {
      run = await client.getRun(runId);
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      await sleep(opts.pollIntervalMs);
      continue;
    }

    if (run.status === "completed") {
      return { ...parseOutcome(run.output), usage: run.usage };
    }
    if (run.status === "failed" || run.status === "cancelled") {
      const summary = run.output || `hermes run ${run.status} (no output)`;
      return { status: "failed", summary, usage: run.usage };
    }

    await sleep(opts.pollIntervalMs);
  }
}
