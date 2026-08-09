import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import type { DelegationStatus } from "@hermano/shared";
import { alerts, delegations, type AlertRow } from "../db/schema.js";
import type { HermesClientLike, HermesRun } from "../hermes/client.js";
import { HermesApiError } from "../hermes/client.js";
import { dispatch, startSweeper } from "./delegate.js";
import { getLatestDelegation } from "./queries.js";

type Db = ReturnType<typeof createTestDb>;

function createPendingAlert(db: Db, fingerprint: string): AlertRow {
  const now = new Date();
  const alert = db
    .insert(alerts)
    .values({
      fingerprint,
      alertName: "TestAlert",
      severity: "critical",
      labels: {},
      annotations: {},
      generatorUrl: "",
      startsAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  db.insert(delegations)
    .values({
      alertId: alert.id,
      ruleSnapshot: { name: "manual" },
      status: "pending",
      delegatedAt: now,
      createdAt: now,
    })
    .run();
  return alert;
}

async function waitForStatus(db: Db, alertId: number, want: DelegationStatus, timeoutMs = 2000) {
  await vi.waitFor(
    () => {
      const latest = getLatestDelegation(db, alertId);
      expect(latest?.status).toBe(want);
    },
    { timeout: timeoutMs, interval: 10 },
  );
  return getLatestDelegation(db, alertId)!;
}

function fakeClient(overrides: Partial<HermesClientLike>): HermesClientLike {
  return {
    enabled: () => true,
    createRun: vi.fn(async () => "run-1"),
    getRun: vi.fn(async (): Promise<HermesRun> => ({ runId: "run-1", status: "started", output: "", usage: null })),
    stopRun: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("dispatch", () => {
  it("resolves a successful run as completed", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({
      getRun: vi.fn(async () => ({ runId: "run-1", status: "completed", output: "fixed it\nSTATUS: completed", usage: null })),
    });

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10 });

    const latest = await waitForStatus(db, alert.id, "completed");
    expect(latest.runId).toBe("run-1");
  });

  it("marks failed when creating the run itself fails", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({
      createRun: vi.fn(async () => {
        throw new HermesApiError(500, "boom");
      }),
    });

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10 });

    const latest = await waitForStatus(db, alert.id, "failed");
    expect(latest.summary).toBeTruthy();
  });

  it("marks failed immediately when the client is not configured", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({ enabled: () => false });

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10 });

    await waitForStatus(db, alert.id, "failed");
  });

  it("marks timed_out and stops the run once the dispatch deadline passes", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const stopRun = vi.fn(async () => {});
    const client = fakeClient({
      getRun: vi.fn(async () => ({ runId: "run-1", status: "started", output: "", usage: null })),
      stopRun,
    });

    dispatch(db, client, [alert], { dispatchTimeoutMs: 60, pollIntervalMs: 10 });

    await waitForStatus(db, alert.id, "timed_out");
    expect(stopRun).toHaveBeenCalledWith("run-1");
  });
});

describe("startSweeper", () => {
  it("marks a stale dispatched delegation as timed_out on its next tick", async () => {
    const db = createTestDb();
    const now = new Date();
    const alert = db
      .insert(alerts)
      .values({
        fingerprint: "fp1",
        alertName: "TestAlert",
        severity: "critical",
        labels: {},
        annotations: {},
        generatorUrl: "",
        startsAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    db.insert(delegations)
      .values({
        alertId: alert.id,
        ruleSnapshot: { name: "manual" },
        status: "dispatched",
        runId: "run-1",
        delegatedAt: new Date(now.getTime() - 3_600_000),
        dispatchedAt: new Date(now.getTime() - 3_600_000),
        createdAt: now,
      })
      .run();

    const stop = startSweeper(db, { dispatchTimeoutMs: 60_000, pendingGraceMs: 60_000, intervalMs: 20 });
    try {
      await waitForStatus(db, alert.id, "timed_out");
    } finally {
      stop();
    }
  });
});
