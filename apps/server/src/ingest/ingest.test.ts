import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import { alerts, delegationRules, type AlertRow } from "../db/schema.js";
import {
  countAlertTriggers,
  getDelegationsForAlert,
  getLatestDelegation,
  markDispatchFailed,
  markDispatched,
  markManualDelegation,
  recordDelegationOutcome,
} from "../delegate/queries.js";
import { processWebhook } from "./ingest.js";
import type { WebhookPayload } from "./payload.js";

function getActiveAlert(db: ReturnType<typeof createTestDb>, fingerprint: string): AlertRow {
  const alert = db
    .select()
    .from(alerts)
    .where(and(eq(alerts.fingerprint, fingerprint), isNull(alerts.resolvedAt)))
    .get();
  if (!alert) throw new Error(`expected an active alert for ${fingerprint}`);
  return alert;
}

function firingPayload(fingerprint: string, alertname: string, extraLabels: Record<string, string> = {}): WebhookPayload {
  return {
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: { alertname, severity: "critical", ...extraLabels },
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

describe("processWebhook", () => {
  it("creates a row for a new firing alert", () => {
    const db = createTestDb();

    const res = processWebhook(db, firingPayload("fp1", "TestAlert"));
    expect(res.created).toBe(1);
    expect(res.updated).toBe(0);

    const alert = getActiveAlert(db, "fp1");
    expect(alert.alertName).toBe("TestAlert");
    expect(alert.resolvedAt).toBeNull();
    expect(countAlertTriggers(db, alert.id)).toBe(1);
    expect(getLatestDelegation(db, alert.id)).toBeNull();
  });

  it("logs another trigger instead of duplicating the alert on repeat firing", () => {
    const db = createTestDb();

    processWebhook(db, firingPayload("fp1", "TestAlert"));
    const res = processWebhook(db, firingPayload("fp1", "TestAlert"));
    expect(res.updated).toBe(1);
    expect(res.created).toBe(0);

    const rows = db.select().from(alerts).where(eq(alerts.fingerprint, "fp1")).all();
    expect(rows).toHaveLength(1);

    const alert = getActiveAlert(db, "fp1");
    expect(countAlertTriggers(db, alert.id)).toBe(2);
  });

  it("marks the existing row resolved in place", () => {
    const db = createTestDb();

    processWebhook(db, firingPayload("fp1", "TestAlert"));
    processWebhook(db, firingPayload("fp1", "TestAlert"));
    const alert = getActiveAlert(db, "fp1");

    const res = processWebhook(db, resolvedPayload("fp1", "TestAlert"));
    expect(res.resolved).toBe(1);

    const active = db
      .select()
      .from(alerts)
      .where(and(eq(alerts.fingerprint, "fp1"), isNull(alerts.resolvedAt)))
      .all();
    expect(active).toHaveLength(0);

    const reloaded = db.select().from(alerts).where(eq(alerts.id, alert.id)).get();
    expect(reloaded?.resolvedAt).not.toBeNull();
    expect(reloaded?.endsAt).not.toBeNull();

    // alert_triggers references alertId, unchanged by resolving in place.
    expect(countAlertTriggers(db, alert.id)).toBe(2);
  });

  it("still records history for a resolve with no prior firing", () => {
    const db = createTestDb();

    const res = processWebhook(db, resolvedPayload("fp-orphan", "TestAlert"));
    expect(res.resolved).toBe(1);

    const rows = db
      .select()
      .from(alerts)
      .where(eq(alerts.fingerprint, "fp-orphan"))
      .all()
      .filter((a) => a.resolvedAt != null);
    expect(rows).toHaveLength(1);
  });

  it("applies a delegation rule to new and already-firing alerts, but never to an unrelated alert", () => {
    const db = createTestDb();

    // An unrelated alert fires first; it should not be delegated.
    processWebhook(db, firingPayload("fp-other", "OtherAlert"));

    // The target alert starts firing before any rule exists for it.
    processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const alert = getActiveAlert(db, "fp1");
    expect(getLatestDelegation(db, alert.id)).toBeNull();

    // User decides, from alert history, that TargetAlert should now be forwarded.
    const now = new Date();
    const rule = db
      .insert(delegationRules)
      .values({
        name: "forward TargetAlert",
        matchers: { alertname: "TargetAlert" },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    // The next re-notification of the already-firing alert becomes pending.
    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const latest = getLatestDelegation(db, alert.id);
    expect(latest?.status).toBe("pending");
    expect(latest?.ruleSnapshot.name).toBe(rule.name);
    expect(latest?.ruleId).toBe(rule.id);
    expect(latest?.delegatedAt).toBeTruthy();
    expect(latest?.triggerId).not.toBeNull();
    expect(res.newlyPending.map((a) => a.fingerprint)).toEqual(["fp1"]);

    // The unrelated alert must remain undelegated.
    const otherAlert = getActiveAlert(db, "fp-other");
    expect(getLatestDelegation(db, otherAlert.id)).toBeNull();

    // A brand new alert of the matching kind is marked pending immediately on creation.
    const res2 = processWebhook(db, firingPayload("fp2", "TargetAlert"));
    const alert2 = getActiveAlert(db, "fp2");
    const latest2 = getLatestDelegation(db, alert2.id);
    expect(latest2?.status).toBe("pending");
    expect(res2.newlyPending.map((a) => a.fingerprint)).toEqual(["fp2"]);

    const delegationsForAlert2 = getDelegationsForAlert(db, alert2.id);
    expect(delegationsForAlert2).toHaveLength(1);
    expect(delegationsForAlert2[0]?.ruleSnapshot.name).toBe(rule.name);
    expect(delegationsForAlert2[0]?.status).toBe("pending");
  });

  it("requires a manual retry, never an automatic re-match, once an alert has any delegation history", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(delegationRules)
      .values({
        name: "forward TargetAlert",
        matchers: { alertname: "TargetAlert" },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // First fire: matches and auto-delegates.
    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res.newlyPending).toHaveLength(1);
    const alert = getActiveAlert(db, "fp1");

    // Simulate that delegation failing.
    markDispatchFailed(db, alert.id, "boom");

    // A further re-notification must NOT auto-delegate again.
    const res2 = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res2.newlyPending).toHaveLength(0);
    expect(getDelegationsForAlert(db, alert.id)).toHaveLength(1);
  });

  it("does not delegate via a disabled rule", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(delegationRules)
      .values({
        name: "disabled rule",
        matchers: { alertname: "TargetAlert" },
        enabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res.newlyPending).toHaveLength(0);

    const alert = getActiveAlert(db, "fp1");
    expect(getLatestDelegation(db, alert.id)).toBeNull();
  });

  it("keeps a completed delegation's outcome intact once the alert resolves", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(delegationRules)
      .values({
        name: "forward TargetAlert",
        matchers: { alertname: "TargetAlert" },
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const alert = getActiveAlert(db, "fp1");

    // Simulate a completed dispatch, the way the delegate module would.
    markDispatched(db, alert.id, "fp1-123");
    const matched = recordDelegationOutcome(db, alert.id, "completed", "fixed it", null);
    expect(matched).toBe(true);

    processWebhook(db, resolvedPayload("fp1", "TargetAlert"));

    const reloaded = db.select().from(alerts).where(eq(alerts.id, alert.id)).get();
    expect(reloaded?.resolvedAt).not.toBeNull();

    const latest = getLatestDelegation(db, alert.id);
    expect(latest?.status).toBe("completed");
    expect(latest?.summary).toBe("fixed it");
  });

  it("flags a brand-new alert as unmanaged when it matches no rule, but not once one is manually delegated", () => {
    const db = createTestDb();

    const res = processWebhook(db, firingPayload("fp1", "TestAlert"));
    expect(res.newlyUnmanaged.map((a) => a.fingerprint)).toEqual(["fp1"]);

    // A repeat notification while still unmanaged must not re-flag it (would be spammy).
    const res2 = processWebhook(db, firingPayload("fp1", "TestAlert"));
    expect(res2.newlyUnmanaged).toHaveLength(0);
  });

  it("flags a resolved alert as unmanaged only when it was never delegated", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(delegationRules)
      .values({ name: "forward TargetAlert", matchers: { alertname: "TargetAlert" }, enabled: true, createdAt: now, updatedAt: now })
      .run();

    processWebhook(db, firingPayload("fp1", "UnmanagedAlert"));
    processWebhook(db, firingPayload("fp2", "TargetAlert"));

    const res = processWebhook(db, resolvedPayload("fp1", "UnmanagedAlert"));
    expect(res.resolvedUnmanaged.map((a) => a.fingerprint)).toEqual(["fp1"]);

    const res2 = processWebhook(db, resolvedPayload("fp2", "TargetAlert"));
    expect(res2.resolvedUnmanaged).toHaveLength(0);
  });

  it("does not flag a resolve as unmanaged when we never saw the alert firing", () => {
    const db = createTestDb();
    const res = processWebhook(db, resolvedPayload("fp-orphan", "TestAlert"));
    expect(res.resolvedUnmanaged).toHaveLength(0);
  });

  it("flags a recurrence when an already-completed episode fires again while still active", () => {
    const db = createTestDb();
    processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const alert = getActiveAlert(db, "fp1");
    markManualDelegation(db, alert.id);
    markDispatched(db, alert.id, "run-1");
    recordDelegationOutcome(db, alert.id, "completed", "fixed it", null);

    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res.recurrences.map((a) => a.fingerprint)).toEqual(["fp1"]);
  });

  it("does not flag a recurrence when the episode's latest delegation is not completed", () => {
    const db = createTestDb();
    processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const alert = getActiveAlert(db, "fp1");
    markManualDelegation(db, alert.id);
    markDispatchFailed(db, alert.id, "boom");

    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res.recurrences).toHaveLength(0);
  });

  it("flags a recurrence when a brand-new episode fires after the prior episode (same fingerprint) was completed and resolved", () => {
    const db = createTestDb();
    processWebhook(db, firingPayload("fp1", "TargetAlert"));
    const alert = getActiveAlert(db, "fp1");
    markManualDelegation(db, alert.id);
    markDispatched(db, alert.id, "run-1");
    recordDelegationOutcome(db, alert.id, "completed", "fixed it", null);
    processWebhook(db, resolvedPayload("fp1", "TargetAlert"));

    // Same fingerprint (AlertManager fingerprints are deterministic per label set), new episode.
    const res = processWebhook(db, firingPayload("fp1", "TargetAlert"));
    expect(res.created).toBe(1);
    expect(res.recurrences.map((a) => a.fingerprint)).toEqual(["fp1"]);
  });

  it("does not flag a recurrence for a fingerprint with no prior history at all", () => {
    const db = createTestDb();
    const res = processWebhook(db, firingPayload("fp-new", "BrandNewAlert"));
    expect(res.recurrences).toHaveLength(0);
  });
});
