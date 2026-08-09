import type { LabelMap } from "@hermano/shared";
import type { AlertRow } from "../db/schema.js";

// Sent as the Runs API's "instructions" field on every dispatch — the
// static contract governing how the agent should behave and, critically,
// how it must signal completed vs. failed back to us. Hermes' Runs API has
// no client-supplied tool/function-calling and no structured output
// option: the model's own "output" text is the only channel, so we
// require a parseable marker as (usually, see outcome.ts) the last line
// of its response.
export const RUN_INSTRUCTIONS = `You are Hermes, investigating an alert delegated to you by
hermes-alertmanager. Investigate it and, if it is safe to do so, remediate
it using the tools available to you.

When you are done - whether you fixed it, could not, or need to bail - the
LAST LINE of your entire response MUST be exactly one of:

STATUS: completed
STATUS: failed

("completed" if you investigated and/or resolved it, "failed" if you could
not, e.g. it needs a human). Do not put anything after that line, and do
not omit it - if it's missing, hermes-alertmanager cannot tell whether you
succeeded and will report your run as failed regardless of what you did.

Everything you write before that line is treated as the postmortem summary
shown to a human who wasn't watching, so write a few sentences: what the
alert was, what you found (root cause if you identified one), what action
you took (or why you couldn't act), and the current state.`;

/** Renders the concrete, per-alert facts sent as the Runs API's "input" field. */
export function buildInput(alert: AlertRow, timesFired: number): string {
  const lines: string[] = [];
  lines.push(`Alert: ${alert.alertName}`);
  lines.push(`Severity: ${alert.severity}`);
  lines.push(`Fingerprint: ${alert.fingerprint}`);
  lines.push(`Times fired: ${timesFired}`);
  if (alert.startsAt) {
    lines.push(`First fired: ${alert.startsAt.toISOString()}`);
  }
  if (alert.generatorUrl) {
    lines.push(`Generator URL: ${alert.generatorUrl}`);
  }
  lines.push(`Labels: ${formatLabelMap(alert.labels)}`);
  lines.push(`Annotations: ${formatLabelMap(alert.annotations)}`);
  return lines.join("\n") + "\n";
}

function formatLabelMap(m: LabelMap): string {
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return "(none)";
  return keys.map((k) => `${k}=${m[k]}`).join(", ");
}
