import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { createTestDb } from "../db/test-helpers.js";
import { alerts, type AlertRow } from "../db/schema.js";
import { updateSettingsRow } from "../settings/queries.js";
import { notifyDelegationOutcome, notifyRecurrence, notifyUnmanagedFiring, notifyUnmanagedResolved } from "./notify.js";

const BASE_ENV = { HERMANO_DATABASE_PATH: "/data/hermano.sqlite3" };

function insertAlert(db: ReturnType<typeof createTestDb>): AlertRow {
  const now = new Date();
  return db
    .insert(alerts)
    .values({
      fingerprint: "fp1",
      alertName: "TestAlert",
      severity: "critical",
      labels: {},
      annotations: { summary: "something is wrong" },
      generatorUrl: "",
      startsAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

function fetchCalls(fetchSpy: ReturnType<typeof vi.fn>): URLSearchParams[] {
  return fetchSpy.mock.calls.map((call) => call[1].body as URLSearchParams);
}

describe("pushover/notify", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when Pushover isn't configured", async () => {
    const db = createTestDb();
    const config = loadConfig(BASE_ENV);
    const alert = insertAlert(db);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyUnmanagedFiring(db, config, alert);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends an unmanaged-firing push at normal priority when configured via settings", async () => {
    const db = createTestDb();
    const config = loadConfig(BASE_ENV);
    updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key" });
    const alert = insertAlert(db);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await notifyUnmanagedFiring(db, config, alert);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = fetchCalls(fetchSpy)[0]!;
    expect(body.get("token")).toBe("app-token");
    expect(body.get("user")).toBe("user-key");
    expect(body.get("priority")).toBe("0");
    expect(body.get("title")).toContain("TestAlert");
    expect(body.get("url")).toBe(`${config.webBaseUrl}/alerts/${alert.id}`);
  });

  it("builds the 'View in Hermano' link from the configured public URL rather than the server's local bind address", async () => {
    const db = createTestDb();
    const config = loadConfig(BASE_ENV);
    updateSettingsRow(db, {
      pushoverApiToken: "app-token",
      pushoverUserKey: "user-key",
      publicUrl: "https://hermano.example.com",
    });
    const alert = insertAlert(db);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await notifyUnmanagedFiring(db, config, alert);

    expect(fetchCalls(fetchSpy)[0]?.get("url")).toBe(`https://hermano.example.com/alerts/${alert.id}`);
  });

  it("sends an unmanaged-resolved push at low priority", async () => {
    const db = createTestDb();
    const config = loadConfig(BASE_ENV);
    updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key" });
    const alert = insertAlert(db);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await notifyUnmanagedResolved(db, config, alert);

    expect(fetchCalls(fetchSpy)[0]?.get("priority")).toBe("-1");
  });

  it("sends a recurrence push at high priority", async () => {
    const db = createTestDb();
    const config = loadConfig(BASE_ENV);
    updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key" });
    const alert = insertAlert(db);
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await notifyRecurrence(db, config, alert);

    expect(fetchCalls(fetchSpy)[0]?.get("priority")).toBe("1");
  });

  describe("notifyDelegationOutcome", () => {
    it("skips a completed outcome by default (notifyOnCompleted off)", async () => {
      const db = createTestDb();
      const config = loadConfig(BASE_ENV);
      updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key" });
      const alert = insertAlert(db);
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      await notifyDelegationOutcome(db, config, alert, "completed", "fixed it");

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("sends a completed outcome (low priority) once notifyOnCompleted is on", async () => {
      const db = createTestDb();
      const config = loadConfig(BASE_ENV);
      updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key", pushoverNotifyOnCompleted: true });
      const alert = insertAlert(db);
      const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      await notifyDelegationOutcome(db, config, alert, "completed", "fixed it");

      const body = fetchCalls(fetchSpy)[0]!;
      expect(body.get("priority")).toBe("-1");
      expect(body.get("message")).toContain("fixed it");
    });

    it.each(["failed", "timed_out"] as const)("always sends a %s outcome at high priority", async (status) => {
      const db = createTestDb();
      const config = loadConfig(BASE_ENV);
      updateSettingsRow(db, { pushoverApiToken: "app-token", pushoverUserKey: "user-key" });
      const alert = insertAlert(db);
      const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchSpy);

      await notifyDelegationOutcome(db, config, alert, status, "could not fix it");

      const body = fetchCalls(fetchSpy)[0]!;
      expect(body.get("priority")).toBe("1");
      expect(body.get("message")).toContain("could not fix it");
    });
  });
});
