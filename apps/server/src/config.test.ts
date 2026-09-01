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
    expect(config.pushover).toEqual({
      apiToken: undefined,
      userKey: undefined,
      notifyOnCompleted: false,
    });
    expect(config.alertmanager).toEqual({
      baseUrl: "",
      reconcileIntervalMs: 5 * 60_000,
    });
    expect(config.logLevel).toBe("info");
    expect(config.staticWebDir).toBeNull();
    expect(config.publicUrl).toBe(config.webBaseUrl);
    expect(config.envLocks).toEqual({
      hermesAgentUrl: false,
      hermesAgentApiKey: false,
      hermesDispatchTimeoutMs: false,
      hermesPollIntervalMs: false,
      oidc: false,
      pushoverApiToken: false,
      pushoverUserKey: false,
      pushoverNotifyOnCompleted: false,
      publicUrl: false,
    });
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
      HERMANO_PUSHOVER_API_TOKEN: "app-token",
      HERMANO_PUSHOVER_USER_KEY: "user-key",
      HERMANO_PUSHOVER_NOTIFY_ON_COMPLETED: "true",
      HERMANO_ALERTMANAGER_URL: "http://alertmanager.internal:9093",
      HERMANO_ALERTMANAGER_RECONCILE_INTERVAL_MS: "120000",
      HERMANO_PUBLIC_URL: "https://hermano.example.com",
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
    expect(config.pushover).toEqual({
      apiToken: "app-token",
      userKey: "user-key",
      notifyOnCompleted: true,
    });
    expect(config.alertmanager).toEqual({
      baseUrl: "http://alertmanager.internal:9093",
      reconcileIntervalMs: 120_000,
    });
    expect(config.logLevel).toBe("debug");
    expect(config.publicUrl).toBe("https://hermano.example.com");
    expect(config.envLocks).toEqual({
      hermesAgentUrl: true,
      hermesAgentApiKey: true,
      hermesDispatchTimeoutMs: true,
      hermesPollIntervalMs: true,
      oidc: false,
      pushoverApiToken: true,
      pushoverUserKey: true,
      pushoverNotifyOnCompleted: true,
      publicUrl: true,
    });
  });

  it("derives webBaseUrl from the port", () => {
    const config = loadConfig({ ...BASE_ENV, HERMANO_PORT: "5050" });
    expect(config.webBaseUrl).toBe("http://127.0.0.1:5050");
  });

  it("falls back to webBaseUrl for publicUrl when HERMANO_PUBLIC_URL is unset", () => {
    const config = loadConfig({ ...BASE_ENV, HERMANO_PORT: "5050" });
    expect(config.publicUrl).toBe("http://127.0.0.1:5050");
  });

  it("honors HERMANO_PUBLIC_URL when set", () => {
    const config = loadConfig({ ...BASE_ENV, HERMANO_PUBLIC_URL: "https://hermano.example.com" });
    expect(config.publicUrl).toBe("https://hermano.example.com");
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
    expect(config.envLocks.oidc).toBe(true);
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

  it("defaults the OIDC redirect URL to HERMANO_PUBLIC_URL when set", () => {
    const config = loadConfig({
      ...BASE_ENV,
      OIDC_ISSUER_URL: "https://auth.example.com",
      OIDC_CLIENT_ID: "hermano",
      OIDC_CLIENT_SECRET: "secret",
      HERMANO_PUBLIC_URL: "https://hermano.example.com",
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
