import type { Config, PushoverConfig } from "../config.js";
import type { DbClient } from "../db/client.js";
import type { AlertRow } from "../db/schema.js";
import { effectivePushoverConfig } from "../settings/effective.js";
import { getSettingsRow } from "../settings/queries.js";
import { PushoverClient } from "./client.js";

function truncate(s: string, max: number): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + "…" : trimmed;
}

function alertUrl(config: Config, alert: AlertRow): string {
  return `${config.webBaseUrl}/alerts/${alert.id}`;
}

function resolvePushover(db: DbClient, config: Config): { pushover: PushoverConfig; client: PushoverClient } {
  const pushover = effectivePushoverConfig(config, getSettingsRow(db));
  return { pushover, client: new PushoverClient({ apiToken: pushover.apiToken, userKey: pushover.userKey }) };
}

/** An alert just started firing and matches no delegation rule — nobody (human or agent) is on it. */
export async function notifyUnmanagedFiring(db: DbClient, config: Config, alert: AlertRow): Promise<void> {
  const { client } = resolvePushover(db, config);
  if (!client.enabled()) return;

  const summary = alert.annotations.summary;
  await client.send({
    title: `🔥 ${alert.alertName}`,
    message: [
      `Severity: ${alert.severity || "unknown"}`,
      summary ? truncate(summary, 400) : null,
      "No delegation rule matches this alert — nobody's watching it.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    priority: 0,
    url: alertUrl(config, alert),
    urlTitle: "View in Hermano",
  });
}

/** An unmanaged alert (see above) has resolved — mirrors AlertManager's own resolved notification. */
export async function notifyUnmanagedResolved(db: DbClient, config: Config, alert: AlertRow): Promise<void> {
  const { client } = resolvePushover(db, config);
  if (!client.enabled()) return;

  await client.send({
    title: `✅ ${alert.alertName} resolved`,
    message: `Severity: ${alert.severity || "unknown"}`,
    priority: -1,
    url: alertUrl(config, alert),
    urlTitle: "View in Hermano",
  });
}

/**
 * An alert fired again after previously being marked "completed" by Hermes
 * — either the same episode never actually stopped firing, or it resolved
 * and a brand-new episode started later. Either way, the fix didn't hold.
 */
export async function notifyRecurrence(db: DbClient, config: Config, alert: AlertRow): Promise<void> {
  const { client } = resolvePushover(db, config);
  if (!client.enabled()) return;

  await client.send({
    title: `⚠️ ${alert.alertName} fired again`,
    message: "This alert was previously marked fixed by Hermes and has started firing again. See Hermano for the full history.",
    priority: 1,
    url: alertUrl(config, alert),
    urlTitle: "View in Hermano",
  });
}

/** A delegation reached a terminal outcome. "completed" is skipped unless notifyOnCompleted is on (default off). */
export async function notifyDelegationOutcome(
  db: DbClient,
  config: Config,
  alert: AlertRow,
  status: "completed" | "failed" | "timed_out",
  summary: string,
): Promise<void> {
  const { pushover, client } = resolvePushover(db, config);
  if (status === "completed" && !pushover.notifyOnCompleted) return;
  if (!client.enabled()) return;

  if (status === "completed") {
    await client.send({
      title: `🤖 ${alert.alertName} fixed`,
      message: truncate(summary, 800),
      priority: -1,
      url: alertUrl(config, alert),
      urlTitle: "View in Hermano",
    });
    return;
  }

  const label = status === "timed_out" ? "timed out trying" : "failed";
  await client.send({
    title: `🚨 ${alert.alertName} needs you`,
    message: `Hermes ${label} to fix this alert.\n\n${truncate(summary, 800)}`,
    priority: 1,
    url: alertUrl(config, alert),
    urlTitle: "View in Hermano",
  });
}
