import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import { loadConfig } from "../config.js";
import { alerts, type AlertRow, type NewAlertRow } from "../db/schema.js";
import type { AlertmanagerClientLike } from "../alertmanager/client.js";
import { reconcileActiveAlerts, reconcileWithEffectiveConfig, startReconciler } from "./reconcile.js";

const BASE_ENV = { HERMANO_DATABASE_PATH: "/data/hermano.sqlite3" };

type Db = ReturnType<typeof createTestDb>;

function insertAlert(db: Db, fingerprint: string, overrides: Partial<NewAlertRow> = {}): AlertRow {
  const now = new Date();
  return db
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
      ...overrides,
    })
    .returning()
    .get();
}

function getAlert(db: Db, id: number): AlertRow {
  return db.select().from(alerts).where(eq(alerts.id, id)).get()!;
}

function fakeClient(overrides: Partial<AlertmanagerClientLike> = {}): AlertmanagerClientLike {
  return {
    enabled: () => true,
    listActiveFingerprints: vi.fn(async () => new Set<string>()),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reconcileActiveAlerts", () => {
  it("marks a locally-active alert resolved when its fingerprint is missing from alertmanager", async () => {
    const db = createTestDb();
    const alert = insertAlert(db, "fp-missing");
    const client = fakeClient({ listActiveFingerprints: vi.fn(async () => new Set(["some-other-fp"])) });

    const result = await reconcileActiveAlerts(db, client);

    expect(result.resolved.map((a) => a.id)).toEqual([alert.id]);
    const row = getAlert(db, alert.id);
    expect(row.resolvedAt).not.toBeNull();
    expect(row.endsAt).not.toBeNull();
  });

  it("leaves an alert alone when its fingerprint is still active in alertmanager", async () => {
    const db = createTestDb();
    const alert = insertAlert(db, "fp-active");
    const client = fakeClient({ listActiveFingerprints: vi.fn(async () => new Set(["fp-active"])) });

    const result = await reconcileActiveAlerts(db, client);

    expect(result.resolved).toHaveLength(0);
    expect(getAlert(db, alert.id).resolvedAt).toBeNull();
  });

  it("does not touch an alert that's already resolved", async () => {
    const db = createTestDb();
    const now = new Date();
    const alert = insertAlert(db, "fp-resolved-already", { resolvedAt: now, endsAt: now });
    const client = fakeClient({ listActiveFingerprints: vi.fn(async () => new Set<string>()) });

    const result = await reconcileActiveAlerts(db, client);

    expect(result.resolved).toHaveLength(0);
    expect(getAlert(db, alert.id).resolvedAt).toEqual(now);
  });

  it("is a no-op that never calls alertmanager when the client isn't enabled/configured", async () => {
    const db = createTestDb();
    insertAlert(db, "fp1");
    const listActiveFingerprints = vi.fn();
    const client = fakeClient({ enabled: () => false, listActiveFingerprints });

    const result = await reconcileActiveAlerts(db, client);

    expect(result.resolved).toHaveLength(0);
    expect(listActiveFingerprints).not.toHaveBeenCalled();
  });

  it("propagates an alertmanager failure instead of silently resolving nothing", async () => {
    const db = createTestDb();
    insertAlert(db, "fp1");
    const client = fakeClient({
      listActiveFingerprints: vi.fn(async () => {
        throw new Error("alertmanager unreachable");
      }),
    });

    await expect(reconcileActiveAlerts(db, client)).rejects.toThrow("alertmanager unreachable");
  });

  it("does not resolve an alert re-fired by a webhook after the alertmanager snapshot was taken, even though that snapshot missed it", async () => {
    // Regression guard for the race the asOf/updatedAt check in
    // reconcile/queries.ts's resolveMissingAlerts exists to close: a webhook
    // legitimately extending an alert mid-reconciliation must always win over
    // a reconciliation acting on now-stale information.
    const db = createTestDb();
    const alert = insertAlert(db, "fp-race");

    const client = fakeClient({
      listActiveFingerprints: vi.fn(async () => {
        db.update(alerts)
          .set({ updatedAt: new Date(Date.now() + 60_000) })
          .where(eq(alerts.id, alert.id))
          .run();
        return new Set<string>();
      }),
    });

    const result = await reconcileActiveAlerts(db, client);

    expect(result.resolved).toHaveLength(0);
    expect(getAlert(db, alert.id).resolvedAt).toBeNull();
  });
});

describe("reconcileWithEffectiveConfig", () => {
  it("never calls alertmanager when HERMANO_ALERTMANAGER_URL is unset", async () => {
    const db = createTestDb();
    insertAlert(db, "fp1");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await reconcileWithEffectiveConfig(db, loadConfig(BASE_ENV));

    expect(result.resolved).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves stale alerts using the response from HERMANO_ALERTMANAGER_URL", async () => {
    const db = createTestDb();
    const gone = insertAlert(db, "fp-gone");
    const stillFiring = insertAlert(db, "fp-still-firing");

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([{ fingerprint: "fp-still-firing" }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const config = loadConfig({ ...BASE_ENV, HERMANO_ALERTMANAGER_URL: "http://alertmanager.test:9093" });
    const result = await reconcileWithEffectiveConfig(db, config);

    expect(result.resolved.map((a) => a.id)).toEqual([gone.id]);
    expect(getAlert(db, stillFiring.id).resolvedAt).toBeNull();
  });
});

describe("startReconciler", () => {
  it("resolves a stale-active alert on its next tick", async () => {
    const db = createTestDb();
    const alert = insertAlert(db, "fp-gone");

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const config = loadConfig({ ...BASE_ENV, HERMANO_ALERTMANAGER_URL: "http://alertmanager.test:9093" });
    const stop = startReconciler(db, config, { intervalMs: 20 });
    try {
      await vi.waitFor(
        () => {
          expect(getAlert(db, alert.id).resolvedAt).not.toBeNull();
        },
        { timeout: 2000, interval: 10 },
      );
    } finally {
      stop();
    }
  });
});
