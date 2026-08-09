import { describe, expect, it } from "vitest";
import { createTestDb } from "./test-helpers.js";
import { alerts } from "./schema.js";

function baseAlert(overrides: Partial<typeof alerts.$inferInsert> = {}) {
  const now = new Date();
  return {
    fingerprint: "fp-1",
    alertName: "KubePodCrashLooping",
    severity: "critical",
    labels: { alertname: "KubePodCrashLooping" },
    annotations: {},
    generatorUrl: "",
    startsAt: now,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("alerts.alerts_fingerprint_active_unique", () => {
  it("rejects a second active (unresolved) row sharing a fingerprint", () => {
    const db = createTestDb();
    db.insert(alerts).values(baseAlert()).run();
    expect(() => db.insert(alerts).values(baseAlert()).run()).toThrow(/UNIQUE constraint failed/);
  });

  it("allows multiple resolved rows sharing a fingerprint", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(alerts)
      .values(baseAlert({ resolvedAt: now }))
      .run();
    expect(() =>
      db
        .insert(alerts)
        .values(baseAlert({ resolvedAt: now }))
        .run(),
    ).not.toThrow();
  });

  it("allows a new active row once the prior episode for the same fingerprint is resolved", () => {
    const db = createTestDb();
    const now = new Date();
    db.insert(alerts)
      .values(baseAlert({ resolvedAt: now }))
      .run();
    expect(() => db.insert(alerts).values(baseAlert()).run()).not.toThrow();
  });
});
