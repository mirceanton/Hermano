import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import type { DelegationStatus } from "@hermano/shared";
import { loadConfig } from "../config.js";
import { alerts, delegations, type AlertRow } from "../db/schema.js";
import type { HermesClientLike, HermesRun } from "../hermes/client.js";
import { HermesApiError } from "../hermes/client.js";
import { createProfile, deleteProfile } from "../profiles/queries.js";
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

describe("profile-aware dispatch", () => {
  /** A pending delegation already routed to profileId (null = default), as ingest would have left it. */
  function createRoutedAlert(db: Db, fingerprint: string, profile: { id: number; name: string } | null): AlertRow {
    const alert = createPendingAlert(db, fingerprint);
    db.update(delegations)
      .set({ profileId: profile?.id ?? null, ruleSnapshot: { name: "rule", ...(profile && { profile: profile.name }) } })
      .where(eq(delegations.alertId, alert.id))
      .run();
    return alert;
  }

  function stubHermes() {
    const fetchSpy = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      if (url.toString().endsWith("/v1/runs")) {
        return new Response(JSON.stringify({ run_id: "run-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ run_id: "run-1", status: "completed", output: "done\nSTATUS: completed" }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  function authHeaderFor(fetchSpy: ReturnType<typeof stubHermes>, urlPrefix: string): string | null {
    const call = fetchSpy.mock.calls.find(([url]) => url.toString().startsWith(urlPrefix));
    return call ? new Headers(call[1]?.headers).get("Authorization") : null;
  }

  it("sends each alert in one batch to its own profile's URL and key, and the default's to the default", async () => {
    const db = createTestDb();
    const sre = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: "sre-key" });
    const dbBot = createProfile(db, { name: "db-bot", url: "http://db.test/p/db", apiKey: null });
    updateSettingsRow(db, { hermesAgentUrl: "http://default.test", hermesAgentApiKey: "default-key", hermesPollIntervalMs: 10 });
    const a = createRoutedAlert(db, "fp-sre", sre);
    const b = createRoutedAlert(db, "fp-db", dbBot);
    const c = createRoutedAlert(db, "fp-default", null);

    const fetchSpy = stubHermes();
    try {
      dispatchWithEffectiveConfig(db, loadConfig(BASE_ENV), [a, b, c]);
      await waitForStatus(db, a.id, "completed");
      await waitForStatus(db, b.id, "completed");
      await waitForStatus(db, c.id, "completed");

      const created = fetchSpy.mock.calls.map(([url]) => url.toString()).filter((u) => u.endsWith("/v1/runs"));
      expect(created.sort()).toEqual(["http://db.test/p/db/v1/runs", "http://default.test/v1/runs", "http://sre.test/v1/runs"]);

      // Each endpoint gets only its own credential — never another profile's, never the default's.
      expect(authHeaderFor(fetchSpy, "http://sre.test")).toBe("Bearer sre-key");
      expect(authHeaderFor(fetchSpy, "http://db.test")).toBeNull();
      expect(authHeaderFor(fetchSpy, "http://default.test")).toBe("Bearer default-key");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails the delegation — rather than falling back to the default endpoint — when its profile was deleted", async () => {
    const db = createTestDb();
    const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: "sre-key" });
    updateSettingsRow(db, { hermesAgentUrl: "http://default.test" });
    const alert = createRoutedAlert(db, "fp1", profile);
    deleteProfile(db, profile.id);

    const fetchSpy = stubHermes();
    try {
      dispatchWithEffectiveConfig(db, loadConfig(BASE_ENV), [alert]);
      const latest = await waitForStatus(db, alert.id, "failed");
      expect(latest.summary).toContain('"sre-bot" no longer exists');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("cancels on the profile the run was dispatched to, not the default endpoint", async () => {
    const db = createTestDb();
    const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: "sre-key" });
    updateSettingsRow(db, { hermesAgentUrl: "http://default.test" });
    const alert = createRoutedAlert(db, "fp1", profile);
    markDispatched(db, alert.id, "run-1");

    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await cancelDelegationWithEffectiveConfig(db, loadConfig(BASE_ENV), alert.id);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("http://sre.test/v1/runs/run-1/stop", expect.anything());
      expect(getLatestDelegation(db, alert.id)?.status).toBe("cancelled");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("still marks a run cancelled when its profile was deleted, without calling any Hermes", async () => {
      const db = createTestDb();
      const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: "sre-key" });
      updateSettingsRow(db, { hermesAgentUrl: "http://default.test" });
      const alert = createRoutedAlert(db, "fp1", profile);
      markDispatched(db, alert.id, "run-1");
      deleteProfile(db, profile.id);

      const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);
      try {
        await cancelDelegationWithEffectiveConfig(db, loadConfig(BASE_ENV), alert.id);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(getLatestDelegation(db, alert.id)?.status).toBe("cancelled");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("uses the global Hermes config for a profile with useSharedConnection: true, ignoring its own url", async () => {
      const db = createTestDb();
      // Create a profile that shares the global connection
      const sharedProfile = createProfile(db, { name: "shared-bot", url: null, apiKey: null, useSharedConnection: true });
      updateSettingsRow(db, { hermesAgentUrl: "http://default.test", hermesAgentApiKey: "default-key", hermesPollIntervalMs: 10 });
      const alert = createRoutedAlert(db, "fp-shared", sharedProfile);

      const fetchSpy = stubHermes();
      try {
        dispatchWithEffectiveConfig(db, loadConfig(BASE_ENV), [alert]);
        await waitForStatus(db, alert.id, "completed");

        // Must have dispatched to the default endpoint, not the profile's own (nonexistent) url
        const created = fetchSpy.mock.calls.map(([url]) => url.toString()).filter((u) => u.endsWith("/v1/runs"));
        expect(created).toEqual(["http://default.test/v1/runs"]);
        expect(authHeaderFor(fetchSpy, "http://default.test")).toBe("Bearer default-key");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("still uses its own URL/key for a profile with useSharedConnection: false (backward compat)", async () => {
      const db = createTestDb();
      const ownProfile = createProfile(db, { name: "own-bot", url: "http://own.test", apiKey: "own-key" });
      updateSettingsRow(db, { hermesAgentUrl: "http://default.test", hermesAgentApiKey: "default-key", hermesPollIntervalMs: 10 });
      const alert = createRoutedAlert(db, "fp-own", ownProfile);

      const fetchSpy = stubHermes();
      try {
        dispatchWithEffectiveConfig(db, loadConfig(BASE_ENV), [alert]);
        await waitForStatus(db, alert.id, "completed");

        const created = fetchSpy.mock.calls.map(([url]) => url.toString()).filter((u) => u.endsWith("/v1/runs"));
        expect(created).toEqual(["http://own.test/v1/runs"]);
        expect(authHeaderFor(fetchSpy, "http://own.test")).toBe("Bearer own-key");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
