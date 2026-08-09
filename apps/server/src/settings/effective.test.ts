import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { RUN_INSTRUCTIONS } from "../hermes/prompt.js";
import { createTestDb } from "../db/test-helpers.js";
import { getSettingsRow, updateSettingsRow } from "./queries.js";
import { effectiveHermesConfig, effectiveOidcConfig, effectiveSystemPrompt } from "./effective.js";

const BASE_ENV = { HERMANO_DATABASE_PATH: "/data/hermano.sqlite3" };

describe("effectiveHermesConfig", () => {
  it("uses the DB value when the env var is unset", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();
    updateSettingsRow(db, { hermesAgentUrl: "http://db-configured:8642", hermesPollIntervalMs: 500 });

    const effective = effectiveHermesConfig(config, getSettingsRow(db));
    expect(effective.baseUrl).toBe("http://db-configured:8642");
    expect(effective.pollIntervalMs).toBe(500);
  });

  it("prefers the env var over a DB value when both are set", () => {
    const config = loadConfig({ ...BASE_ENV, HERMANO_HERMES_AGENT_URL: "http://env-configured:8642" });
    const db = createTestDb();
    updateSettingsRow(db, { hermesAgentUrl: "http://db-configured:8642" });

    const effective = effectiveHermesConfig(config, getSettingsRow(db));
    expect(effective.baseUrl).toBe("http://env-configured:8642");
  });

  it("falls back to the built-in default when neither env nor DB is set", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();

    const effective = effectiveHermesConfig(config, getSettingsRow(db));
    expect(effective.baseUrl).toBe("");
    expect(effective.dispatchTimeoutMs).toBe(30 * 60_000);
    expect(effective.pollIntervalMs).toBe(3_000);
  });
});

describe("effectiveSystemPrompt", () => {
  it("returns the default when no override is set", () => {
    const db = createTestDb();
    expect(effectiveSystemPrompt(getSettingsRow(db))).toBe(RUN_INSTRUCTIONS);
  });

  it("returns the DB override when set", () => {
    const db = createTestDb();
    updateSettingsRow(db, { customSystemPrompt: "Investigate quietly." });
    expect(effectiveSystemPrompt(getSettingsRow(db))).toBe("Investigate quietly.");
  });

  it("treats a whitespace-only override as unset", () => {
    const db = createTestDb();
    updateSettingsRow(db, { customSystemPrompt: "   " });
    expect(effectiveSystemPrompt(getSettingsRow(db))).toBe(RUN_INSTRUCTIONS);
  });
});

describe("effectiveOidcConfig", () => {
  const SESSION_SECRET = "x".repeat(32);

  it("returns null in single-user mode with no DB config either", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();
    expect(effectiveOidcConfig(config, getSettingsRow(db))).toBeNull();
  });

  it("returns the env config when OIDC env vars are set", () => {
    const config = loadConfig({
      ...BASE_ENV,
      OIDC_ISSUER_URL: "https://auth.example.com",
      OIDC_CLIENT_ID: "hermano",
      OIDC_CLIENT_SECRET: "env-secret",
      SESSION_SECRET,
    });
    const db = createTestDb();
    updateSettingsRow(db, {
      oidcIssuerUrl: "https://should-be-ignored.example.com",
      oidcClientId: "ignored",
      oidcClientSecret: "ignored",
    });

    const effective = effectiveOidcConfig(config, getSettingsRow(db));
    expect(effective?.issuerUrl).toBe("https://auth.example.com");
    expect(effective?.clientSecret).toBe("env-secret");
  });

  it("builds an OidcConfig from DB settings once all three fields are present", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();
    updateSettingsRow(db, {
      oidcIssuerUrl: "https://db-auth.example.com",
      oidcClientId: "hermano-db",
      oidcClientSecret: "db-secret",
    });

    const effective = effectiveOidcConfig(config, getSettingsRow(db));
    expect(effective).toEqual({
      issuerUrl: "https://db-auth.example.com",
      clientId: "hermano-db",
      clientSecret: "db-secret",
      redirectUrl: `${config.webBaseUrl}/auth/callback`,
    });
  });

  it("returns null while the DB config is incomplete", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();
    updateSettingsRow(db, { oidcIssuerUrl: "https://db-auth.example.com", oidcClientId: "hermano-db" });

    expect(effectiveOidcConfig(config, getSettingsRow(db))).toBeNull();
  });

  it("honors an explicit DB redirect URL override", () => {
    const config = loadConfig(BASE_ENV);
    const db = createTestDb();
    updateSettingsRow(db, {
      oidcIssuerUrl: "https://db-auth.example.com",
      oidcClientId: "hermano-db",
      oidcClientSecret: "db-secret",
      oidcRedirectUrl: "https://hermano.example.com/auth/callback",
    });

    expect(effectiveOidcConfig(config, getSettingsRow(db))?.redirectUrl).toBe(
      "https://hermano.example.com/auth/callback",
    );
  });
});
