import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const BASE_ENV = {
  HERMANO_DATABASE_PATH: "/data/hermano.sqlite3",
};

describe("loadConfig", () => {
  it("applies defaults for optional settings", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.port).toBe(8080);
    expect(config.webhookSharedSecret).toBeNull();
    expect(config.hermes).toEqual({
      baseUrl: "",
      apiKey: undefined,
      dispatchTimeoutMs: 30 * 60_000,
      pollIntervalMs: 3_000,
    });
    expect(config.logLevel).toBe("info");
    expect(config.staticWebDir).toBeNull();
  });

  it("honors STATIC_WEB_DIR when set", () => {
    const config = loadConfig({ ...BASE_ENV, STATIC_WEB_DIR: "/app/web-dist" });
    expect(config.staticWebDir).toBe("/app/web-dist");
  });

  it("coerces and honors overrides", () => {
    const config = loadConfig({
      ...BASE_ENV,
      HERMANO_PORT: "5050",
      HERMANO_WEBHOOK_SHARED_SECRET: "shh",
      HERMANO_HERMES_AGENT_URL: "http://hermes.internal:8642",
      HERMANO_HERMES_AGENT_API_KEY: "key123",
      HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS: "60000",
      HERMANO_HERMES_POLL_INTERVAL_MS: "1000",
      LOG_LEVEL: "debug",
    });
    expect(config.port).toBe(5050);
    expect(config.webhookSharedSecret).toBe("shh");
    expect(config.hermes).toEqual({
      baseUrl: "http://hermes.internal:8642",
      apiKey: "key123",
      dispatchTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
    });
    expect(config.logLevel).toBe("debug");
  });

  it("derives webBaseUrl from the port", () => {
    const config = loadConfig({ ...BASE_ENV, HERMANO_PORT: "5050" });
    expect(config.webBaseUrl).toBe("http://127.0.0.1:5050");
  });

  it("fails fast with a clear error when HERMANO_DATABASE_PATH is missing", () => {
    expect(() => loadConfig({})).toThrow(/HERMANO_DATABASE_PATH/);
  });

  it("defaults to single-user mode (oidc: null) when no OIDC_* vars are set", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.oidc).toBeNull();
  });

  const SESSION_SECRET = "x".repeat(32);

  it("enables OIDC when all three required vars plus SESSION_SECRET are set", () => {
    const config = loadConfig({
      ...BASE_ENV,
      OIDC_ISSUER_URL: "https://auth.example.com",
      OIDC_CLIENT_ID: "hermano",
      OIDC_CLIENT_SECRET: "secret",
      SESSION_SECRET,
    });
    expect(config.oidc).toEqual({
      issuerUrl: "https://auth.example.com",
      clientId: "hermano",
      clientSecret: "secret",
      redirectUrl: `${config.webBaseUrl}/auth/callback`,
    });
  });

  it("honors an explicit OIDC_REDIRECT_URL override", () => {
    const config = loadConfig({
      ...BASE_ENV,
      OIDC_ISSUER_URL: "https://auth.example.com",
      OIDC_CLIENT_ID: "hermano",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URL: "https://hermano.example.com/auth/callback",
      SESSION_SECRET,
    });
    expect(config.oidc?.redirectUrl).toBe("https://hermano.example.com/auth/callback");
  });

  it("fails fast when only some OIDC_* vars are set", () => {
    expect(() =>
      loadConfig({
        ...BASE_ENV,
        OIDC_ISSUER_URL: "https://auth.example.com",
        OIDC_CLIENT_ID: "hermano",
        SESSION_SECRET,
      }),
    ).toThrow(/OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET must all be set together/);
  });

  it("fails fast when OIDC is configured but SESSION_SECRET is missing", () => {
    expect(() =>
      loadConfig({
        ...BASE_ENV,
        OIDC_ISSUER_URL: "https://auth.example.com",
        OIDC_CLIENT_ID: "hermano",
        OIDC_CLIENT_SECRET: "secret",
      }),
    ).toThrow(/SESSION_SECRET is required/);
  });
});
