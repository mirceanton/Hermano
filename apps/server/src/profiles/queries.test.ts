import { describe, expect, it } from "vitest";
import { alerts, delegations } from "../db/schema.js";
import { createTestDb } from "../db/test-helpers.js";
import { createRule } from "../rules/queries.js";
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  profileNameExists,
  ruleNamesUsingProfile,
  updateProfile,
} from "./queries.js";

describe("profile CRUD", () => {
  it("lists profiles alphabetically by name", () => {
    const db = createTestDb();
    createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: null });
    createProfile(db, { name: "db-bot", url: "http://db.test", apiKey: "k" });
    expect(listProfiles(db).map((p) => p.name)).toEqual(["db-bot", "sre-bot"]);
  });

  it("updates only the supplied fields, and can clear the api key", () => {
    const db = createTestDb();
    const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: "secret" });

    updateProfile(db, profile.id, { url: "http://sre-2.test" });
    expect(getProfile(db, profile.id)).toMatchObject({ name: "sre-bot", url: "http://sre-2.test", apiKey: "secret" });

    updateProfile(db, profile.id, { apiKey: null });
    expect(getProfile(db, profile.id)?.apiKey).toBeNull();
  });

  it("returns null when updating a profile that doesn't exist", () => {
    expect(updateProfile(createTestDb(), 999, { name: "x" })).toBeNull();
  });

  it("rejects a duplicate name at the database level", () => {
    const db = createTestDb();
    createProfile(db, { name: "sre-bot", url: "http://a.test", apiKey: null });
    expect(() => createProfile(db, { name: "sre-bot", url: "http://b.test", apiKey: null })).toThrow();
  });
});

describe("profileNameExists", () => {
  it("detects a taken name, but not against the profile being edited", () => {
    const db = createTestDb();
    const a = createProfile(db, { name: "a", url: "http://a.test", apiKey: null });
    const b = createProfile(db, { name: "b", url: "http://b.test", apiKey: null });

    expect(profileNameExists(db, "a")).toBe(true);
    expect(profileNameExists(db, "a", a.id)).toBe(false);
    expect(profileNameExists(db, "a", b.id)).toBe(true);
    expect(profileNameExists(db, "nope")).toBe(false);
  });
});

describe("deleting a profile", () => {
  it("is blocked at the database level while a rule still routes to it", () => {
    const db = createTestDb();
    const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: null });
    createRule(db, { name: "crashloops", matchers: { alertname: "Crash" }, enabled: true, profileId: profile.id });
    createRule(db, { name: "unrelated", matchers: { alertname: "Other" }, enabled: true, profileId: null });

    expect(ruleNamesUsingProfile(db, profile.id)).toEqual(["crashloops"]);
    expect(() => deleteProfile(db, profile.id)).toThrow();
    expect(getProfile(db, profile.id)).not.toBeNull();
  });

  it("succeeds once no rule uses it, nulling out (not deleting) delegations that were routed there", () => {
    const db = createTestDb();
    const profile = createProfile(db, { name: "sre-bot", url: "http://sre.test", apiKey: null });
    const now = new Date();
    const alert = db
      .insert(alerts)
      .values({ fingerprint: "fp1", alertName: "A", labels: {}, annotations: {}, startsAt: now, createdAt: now, updatedAt: now })
      .returning()
      .get();
    db.insert(delegations)
      .values({
        alertId: alert.id,
        profileId: profile.id,
        ruleSnapshot: { name: "r", profile: "sre-bot" },
        status: "completed",
        delegatedAt: now,
        createdAt: now,
      })
      .run();

    expect(deleteProfile(db, profile.id)).toBe(true);

    const row = db.select().from(delegations).get()!;
    expect(row.profileId).toBeNull();
    // The frozen name survives, which is what marks it "was routed somewhere, now gone" vs. "default".
    expect(row.ruleSnapshot.profile).toBe("sre-bot");
  });
});
