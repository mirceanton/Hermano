import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import type { Configuration } from "openid-client";
import type { OidcConfig } from "../config.js";

const { discoveryMock } = vi.hoisted(() => ({ discoveryMock: vi.fn() }));

vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return { ...actual, discovery: discoveryMock };
});

const oidcConfig: OidcConfig = {
  issuerUrl: "https://keycloak.test/realms/Homelab",
  clientId: "hermano",
  clientSecret: "secret",
  redirectUrl: "https://hermano.test/auth/callback",
};

function fakeLog(): FastifyBaseLogger {
  return { error: vi.fn() } as unknown as FastifyBaseLogger;
}

beforeEach(() => {
  // A fresh module instance per test gives each one a pristine
  // (uninitialized) discoveredConfig, since that state is a module-level
  // singleton by design (see oidc.ts) — discoveryMock itself lives outside
  // the module graph vi.resetModules() clears, so it stays the one the
  // freshly re-imported oidc.ts resolves "openid-client" to.
  vi.resetModules();
  discoveryMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("initOidcClient", () => {
  it("resolves immediately without retrying when discovery succeeds on the first attempt", async () => {
    const { initOidcClient, getOidcClient } = await import("./oidc.js");
    const config = {} as Configuration;
    discoveryMock.mockResolvedValue(config);
    const log = fakeLog();

    const ready = await initOidcClient(oidcConfig, log);

    expect(ready).toBe(true);
    expect(discoveryMock).toHaveBeenCalledTimes(1);
    expect(getOidcClient()).toBe(config);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("retries a transient discovery failure with backoff and succeeds once it clears", async () => {
    vi.useFakeTimers();
    const { initOidcClient, getOidcClient } = await import("./oidc.js");
    const config = {} as Configuration;
    let calls = 0;
    discoveryMock.mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("503 from Keycloak");
      return config;
    });
    const log = fakeLog();

    const initPromise = initOidcClient(oidcConfig, log);
    await vi.runAllTimersAsync();
    const ready = await initPromise;

    expect(ready).toBe(true);
    expect(calls).toBe(3);
    expect(getOidcClient()).toBe(config);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives up after exhausting the retry budget, logs once, and leaves getOidcClient throwing", async () => {
    vi.useFakeTimers();
    const { initOidcClient, getOidcClient } = await import("./oidc.js");
    discoveryMock.mockRejectedValue(new Error("404 from /.well-known/openid-configuration"));
    const log = fakeLog();

    const initPromise = initOidcClient(oidcConfig, log);
    await vi.runAllTimersAsync();
    const ready = await initPromise;

    expect(ready).toBe(false);
    expect(discoveryMock).toHaveBeenCalledTimes(5);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(() => getOidcClient()).toThrow(/OIDC is not available/);
  });
});
