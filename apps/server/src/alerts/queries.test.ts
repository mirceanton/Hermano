import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import { processWebhook } from "../ingest/ingest.js";
import type { WebhookPayload } from "../ingest/payload.js";
import { getAlertDetail, listResolvedAlerts } from "./queries.js";

function firingPayload(fingerprint: string, alertname: string): WebhookPayload {
  return {
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: { alertname, severity: "critical" },
        annotations: { summary: "test alert" },
        startsAt: new Date().toISOString(),
        endsAt: "",
        generatorURL: "",
        fingerprint,
      },
    ],
  };
}

function resolvedPayload(fingerprint: string, alertname: string): WebhookPayload {
  return {
    status: "resolved",
    alerts: [
      {
        status: "resolved",
        labels: { alertname, severity: "critical" },
        annotations: { summary: "test alert" },
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date().toISOString(),
        generatorURL: "",
        fingerprint,
      },
    ],
  };
}

describe("episode grouping", () => {
  it("gives a never-recurred alert an episodeCount of 1 and no related episodes", () => {
    const db = createTestDb();

    processWebhook(db, firingPayload("fp1", "TestAlert"));
    processWebhook(db, resolvedPayload("fp1", "TestAlert"));

    const { data } = listResolvedAlerts(db, 1);
    expect(data).toHaveLength(1);
    expect(data[0]!.episodeCount).toBe(1);

    const detail = getAlertDetail(db, data[0]!.id);
    expect(detail?.relatedEpisodes).toEqual([]);
  });

  it("counts every fire/resolve cycle for the same fingerprint as a distinct, linked episode", () => {
    const db = createTestDb();

    // Fires, resolves, fires again, resolves again, fires a third time (still active).
    processWebhook(db, firingPayload("fp1", "OOMKilled"));
    processWebhook(db, resolvedPayload("fp1", "OOMKilled"));
    processWebhook(db, firingPayload("fp1", "OOMKilled"));
    processWebhook(db, resolvedPayload("fp1", "OOMKilled"));
    processWebhook(db, firingPayload("fp1", "OOMKilled"));

    const { data, total } = listResolvedAlerts(db, 1);
    expect(total).toBe(2);
    // Every resolved episode reports the true fingerprint-wide episode count, not just its own.
    expect(data.every((row) => row.episodeCount === 3)).toBe(true);

    const firstEpisode = data[data.length - 1]!;
    const detail = getAlertDetail(db, firstEpisode.id);
    expect(detail?.relatedEpisodes).toHaveLength(2);
    // The still-firing third episode is included among the related episodes too.
    expect(detail?.relatedEpisodes.some((ep) => ep.resolvedAt === null)).toBe(true);
  });

  it("does not link episodes of a different fingerprint even with the same alert name", () => {
    const db = createTestDb();

    processWebhook(db, firingPayload("fp1", "OOMKilled"));
    processWebhook(db, resolvedPayload("fp1", "OOMKilled"));
    processWebhook(db, firingPayload("fp2", "OOMKilled"));
    processWebhook(db, resolvedPayload("fp2", "OOMKilled"));

    const { data } = listResolvedAlerts(db, 1);
    expect(data.every((row) => row.episodeCount === 1)).toBe(true);
  });
});
