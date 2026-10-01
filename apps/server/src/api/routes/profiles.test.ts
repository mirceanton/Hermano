import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { DelegationRule, HermesProfile } from "@hermano/shared";
import { createTestDb } from "../../db/test-helpers.js";
import { registerProfileRoutes } from "./profiles.js";
import { registerRuleRoutes } from "./rules.js";

function buildTestApp() {
  const db = createTestDb();
  const app = Fastify();
  registerProfileRoutes(app, db);
  registerRuleRoutes(app, db);
  return { app, db };
}

async function createProfileVia(app: ReturnType<typeof buildTestApp>["app"], body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/profiles", payload: body });
}

describe("profile routes", () => {
  it("creates a profile and never echoes the api key back", async () => {
    const { app } = buildTestApp();
    const res = await createProfileVia(app, { name: " sre-bot ", url: " http://sre.test:8643 ", apiKey: "s3cret" });

    expect(res.statusCode).toBe(201);
    const profile = res.json<HermesProfile>();
    expect(profile).toMatchObject({ name: "sre-bot", url: "http://sre.test:8643", apiKeySet: true });
    expect(res.body).not.toContain("s3cret");

    const list = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(list.body).not.toContain("s3cret");
    expect(list.json<HermesProfile[]>()).toHaveLength(1);
  });

  it.each([
    ["missing name", { url: "http://a.test" }],
    ["blank name", { name: "  ", url: "http://a.test" }],
    ["missing url", { name: "a" }],
    ["not a url", { name: "a", url: "hermes-box" }],
    ["non-http scheme", { name: "a", url: "ftp://a.test" }],
  ])("rejects %s with a 400", async (_label, body) => {
    const { app } = buildTestApp();
    const res = await createProfileVia(app, body);
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBeTruthy();
  });

  it("rejects a duplicate name with a 409", async () => {
    const { app } = buildTestApp();
    await createProfileVia(app, { name: "sre-bot", url: "http://a.test" });
    const res = await createProfileVia(app, { name: "sre-bot", url: "http://b.test" });
    expect(res.statusCode).toBe(409);
  });

  it("treats a blank api key as no key", async () => {
    const { app } = buildTestApp();
    const res = await createProfileVia(app, { name: "a", url: "http://a.test", apiKey: "   " });
    expect(res.json<HermesProfile>().apiKeySet).toBe(false);
  });

  it("patches only what's sent: omitted api key is kept, null clears it", async () => {
    const { app } = buildTestApp();
    const { id } = (await createProfileVia(app, { name: "a", url: "http://a.test", apiKey: "k" })).json<HermesProfile>();

    const renamed = await app.inject({ method: "PATCH", url: `/api/profiles/${id}`, payload: { name: "b" } });
    expect(renamed.json<HermesProfile>()).toMatchObject({ name: "b", url: "http://a.test", apiKeySet: true });

    const cleared = await app.inject({ method: "PATCH", url: `/api/profiles/${id}`, payload: { apiKey: null } });
    expect(cleared.json<HermesProfile>().apiKeySet).toBe(false);
  });

  it("lets a profile be saved under its own name, but not another profile's", async () => {
    const { app } = buildTestApp();
    const a = (await createProfileVia(app, { name: "a", url: "http://a.test" })).json<HermesProfile>();
    await createProfileVia(app, { name: "b", url: "http://b.test" });

    const same = await app.inject({ method: "PATCH", url: `/api/profiles/${a.id}`, payload: { name: "a", url: "http://a2.test" } });
    expect(same.statusCode).toBe(200);
    const clash = await app.inject({ method: "PATCH", url: `/api/profiles/${a.id}`, payload: { name: "b" } });
    expect(clash.statusCode).toBe(409);
  });

  it("404s patching or deleting a profile that doesn't exist", async () => {
    const { app } = buildTestApp();
    expect((await app.inject({ method: "PATCH", url: "/api/profiles/99", payload: { name: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/profiles/99" })).statusCode).toBe(404);
  });

  it("refuses to delete a profile a rule still routes to, naming the rule, and deletes it once freed", async () => {
    const { app } = buildTestApp();
    const profile = (await createProfileVia(app, { name: "sre-bot", url: "http://a.test" })).json<HermesProfile>();
    const rule = (
      await app.inject({
        method: "POST",
        url: "/api/rules",
        payload: { name: "crashloops", matchers: { alertname: "Crash" }, profileId: profile.id },
      })
    ).json<DelegationRule>();

    const blocked = await app.inject({ method: "DELETE", url: `/api/profiles/${profile.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<{ error: string }>().error).toContain("crashloops");

    // Moving the rule back to the default endpoint frees the profile.
    await app.inject({ method: "PATCH", url: `/api/rules/${rule.id}`, payload: { profileId: null } });
    expect((await app.inject({ method: "DELETE", url: `/api/profiles/${profile.id}` })).statusCode).toBe(204);
  });
});

describe("rule routes with profiles", () => {
  it("defaults profileId to null (the default endpoint) when omitted", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/rules", payload: { name: "r", matchers: { a: "b" } } });
    expect(res.statusCode).toBe(201);
    expect(res.json<DelegationRule>().profileId).toBeNull();
  });

  it("rejects a profileId that doesn't exist, on create and on update", async () => {
    const { app } = buildTestApp();
    const create = await app.inject({ method: "POST", url: "/api/rules", payload: { name: "r", matchers: { a: "b" }, profileId: 42 } });
    expect(create.statusCode).toBe(400);

    const rule = (await app.inject({ method: "POST", url: "/api/rules", payload: { name: "r", matchers: { a: "b" } } })).json<DelegationRule>();
    const update = await app.inject({ method: "PATCH", url: `/api/rules/${rule.id}`, payload: { profileId: 42 } });
    expect(update.statusCode).toBe(400);
  });

  it("keeps the profile when an unrelated field is patched, and moves it when profileId is sent", async () => {
    const { app } = buildTestApp();
    const profile = (await createProfileVia(app, { name: "sre-bot", url: "http://a.test" })).json<HermesProfile>();
    const rule = (
      await app.inject({ method: "POST", url: "/api/rules", payload: { name: "r", matchers: { a: "b" }, profileId: profile.id } })
    ).json<DelegationRule>();
    expect(rule.profileId).toBe(profile.id);

    const toggled = await app.inject({ method: "PATCH", url: `/api/rules/${rule.id}`, payload: { enabled: false } });
    expect(toggled.json<DelegationRule>().profileId).toBe(profile.id);

    const moved = await app.inject({ method: "PATCH", url: `/api/rules/${rule.id}`, payload: { profileId: null } });
    expect(moved.json<DelegationRule>().profileId).toBeNull();
  });
});
