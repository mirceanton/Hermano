import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import type { DelegationStatus } from "@hermano/shared";
import { loadConfig } from "../config.js";
import { alerts, delegations, type AlertRow } from "../db/schema.js";
import type { HermesClientLike, HermesRun } from "../hermes/client.js";
import { HermesApiError } from "../hermes/client.js";
import { updateSettingsRow } from "../settings/queries.js";
import { cancelDelegation, cancelDelegationWithEffectiveConfig, dispatch, dispatchWithEffectiveConfig, startSweeper } from "./delegate.js";
import { getLatestDelegation, markDispatched, NoCancellableDelegationError } from "./queries.js";

const BASE_ENV = { HERMANO_DATABASE_PATH: "/data/hermano.sqlite3" };

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
  it("resolves a successful run as completed and invokes onOutcome", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({
      getRun: vi.fn(async () => ({ runId: "run-1", status: "completed", output: "fixed it\nSTATUS: completed", usage: null })),
    });
    const onOutcome = vi.fn();

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10, onOutcome });

    const latest = await waitForStatus(db, alert.id, "completed");
    expect(latest.runId).toBe("run-1");
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ id: alert.id }), "completed", "fixed it");
  });

  it("marks failed when creating the run itself fails, without invoking onOutcome", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({
      createRun: vi.fn(async () => {
        throw new HermesApiError(500, "boom");
      }),
    });
    const onOutcome = vi.fn();

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10, onOutcome });

    const latest = await waitForStatus(db, alert.id, "failed");
    expect(latest.summary).toBeTruthy();
    // createRun failing never reaches a "dispatched" row, so there's nothing
    // for the dispatch worker to resolve — onOutcome is scoped to that.
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("marks failed immediately when the client is not configured, without invoking onOutcome", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({ enabled: () => false });
    const onOutcome = vi.fn();

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10, onOutcome });

    await waitForStatus(db, alert.id, "failed");
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("marks timed_out, stops the run, and invokes onOutcome once the dispatch deadline passes", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const stopRun = vi.fn(async () => {});
    const client = fakeClient({
      getRun: vi.fn(async () => ({ runId: "run-1", status: "started", output: "", usage: null })),
      stopRun,
    });
    const onOutcome = vi.fn();

    dispatch(db, client, [alert], { dispatchTimeoutMs: 60, pollIntervalMs: 10, onOutcome });

    await waitForStatus(db, alert.id, "timed_out");
    expect(stopRun).toHaveBeenCalledWith("run-1");
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ id: alert.id }), "timed_out", expect.any(String));
  });

  it("marks failed and invokes onOutcome when polling itself hits a hard (non-timeout) error", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    const client = fakeClient({
      getRun: vi.fn(async () => {
        throw new HermesApiError(401, "unauthorized");
      }),
    });
    const onOutcome = vi.fn();

    dispatch(db, client, [alert], { dispatchTimeoutMs: 2000, pollIntervalMs: 10, onOutcome });

    await waitForStatus(db, alert.id, "failed");
    expect(onOutcome).toHaveBeenCalledWith(expect.objectContaining({ id: alert.id }), "failed", expect.any(String));
  });
});

describe("cancelDelegation", () => {
  async function createDispatchedAlert(db: Db, fingerprint: string, runId = "run-1"): Promise<AlertRow> {
    const alert = createPendingAlert(db, fingerprint);
    markDispatched(db, alert.id, runId);
    return alert;
  }

  it("stops the run and marks the delegation cancelled", async () => {
    const db = createTestDb();
    const alert = await createDispatchedAlert(db, "fp1");
    const stopRun = vi.fn(async () => {});
    const client = fakeClient({ stopRun });

    await cancelDelegation(db, client, alert.id);

    expect(stopRun).toHaveBeenCalledWith("run-1");
    const latest = getLatestDelegation(db, alert.id);
    expect(latest?.status).toBe("cancelled");
    expect(latest?.summary).toBe("cancelled by user");
    expect(latest?.completedAt).toBeInstanceOf(Date);
  });

  it("still marks the delegation cancelled when stopRun fails (best-effort)", async () => {
    const db = createTestDb();
    const alert = await createDispatchedAlert(db, "fp1");
    const client = fakeClient({
      stopRun: vi.fn(async () => {
        throw new Error("hermes unreachable");
      }),
    });

    await cancelDelegation(db, client, alert.id);

    const latest = getLatestDelegation(db, alert.id);
    expect(latest?.status).toBe("cancelled");
  });

  it("throws NoCancellableDelegationError and never calls stopRun when there's no dispatched delegation", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1"); // still "pending", never dispatched
    const stopRun = vi.fn(async () => {});
    const client = fakeClient({ stopRun });

    await expect(cancelDelegation(db, client, alert.id)).rejects.toBeInstanceOf(NoCancellableDelegationError);
    expect(stopRun).not.toHaveBeenCalled();
    expect(getLatestDelegation(db, alert.id)?.status).toBe("pending");
  });

  it("throws NoCancellableDelegationError for an alert that was never delegated at all", async () => {
    const db = createTestDb();
    const now = new Date();
    const alert = db
      .insert(alerts)
      .values({
        fingerprint: "fp2",
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

    await expect(cancelDelegation(db, fakeClient({}), alert.id)).rejects.toBeInstanceOf(NoCancellableDelegationError);
  });
});

describe("cancelDelegationWithEffectiveConfig", () => {
  it("cancels against the Settings-page-configured agent URL when no env var is set", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    markDispatched(db, alert.id, "run-1");
    updateSettingsRow(db, { hermesAgentUrl: "http://settings-configured.test" });

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const config = loadConfig(BASE_ENV);
      await cancelDelegationWithEffectiveConfig(db, config, alert.id);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://settings-configured.test/v1/runs/run-1/stop",
        expect.anything(),
      );
      expect(getLatestDelegation(db, alert.id)?.status).toBe("cancelled");
    } finally {
      vi.unstubAllGlobals();
    }
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

    const config = loadConfig({ ...BASE_ENV, HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS: "60000" });
    const stop = startSweeper(db, config, { pendingGraceMs: 60_000, intervalMs: 20 });
    try {
      await waitForStatus(db, alert.id, "timed_out");
    } finally {
      stop();
    }
  });
});

describe("dispatchWithEffectiveConfig", () => {
  it("dispatches against the Settings-page-configured agent URL when no env var is set", async () => {
    const db = createTestDb();
    const alert = createPendingAlert(db, "fp1");
    updateSettingsRow(db, { hermesAgentUrl: "http://settings-configured.test", hermesPollIntervalMs: 10 });

    const fetchSpy = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ run_id: "run-1", status: "completed", output: "done\nSTATUS: completed" }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const config = loadConfig(BASE_ENV);
      dispatchWithEffectiveConfig(db, config, [alert]);
      await waitForStatus(db, alert.id, "completed");
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://settings-configured.test/v1/runs",
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
