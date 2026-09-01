import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertmanagerApiError, AlertmanagerClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AlertmanagerClient", () => {
  it("enabled() reflects whether a baseUrl was configured", () => {
    expect(new AlertmanagerClient({ baseUrl: "" }).enabled()).toBe(false);
    expect(new AlertmanagerClient({ baseUrl: "http://alertmanager.test:9093" }).enabled()).toBe(true);
  });

  it("listActiveFingerprints returns the fingerprint of every alert in the response", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ fingerprint: "fp1" }, { fingerprint: "fp2" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new AlertmanagerClient({ baseUrl: "http://alertmanager.test" });
    const fingerprints = await client.listActiveFingerprints();

    expect(fingerprints).toEqual(new Set(["fp1", "fp2"]));
    expect(fetchSpy).toHaveBeenCalledWith("http://alertmanager.test/api/v2/alerts", expect.objectContaining({ method: "GET" }));
  });

  it("strips a trailing slash from baseUrl before building the request URL", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new AlertmanagerClient({ baseUrl: "http://alertmanager.test/" });
    await client.listActiveFingerprints();

    expect(fetchSpy).toHaveBeenCalledWith("http://alertmanager.test/api/v2/alerts", expect.anything());
  });

  it("ignores entries with no fingerprint", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ fingerprint: "fp1" }, {}]));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new AlertmanagerClient({ baseUrl: "http://alertmanager.test" });
    const fingerprints = await client.listActiveFingerprints();

    expect(fingerprints).toEqual(new Set(["fp1"]));
  });

  it("throws AlertmanagerApiError on a non-2xx response", async () => {
    const fetchSpy = vi.fn(async () => new Response("service unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new AlertmanagerClient({ baseUrl: "http://alertmanager.test" });

    await expect(client.listActiveFingerprints()).rejects.toThrow(AlertmanagerApiError);
  });
});
