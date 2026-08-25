import { afterEach, describe, expect, it, vi } from "vitest";
import type { AlertRow } from "../db/schema.js";
import { HermesApiError, HermesClient } from "./client.js";

const alert: AlertRow = {
  id: 1,
  fingerprint: "fp1",
  alertName: "TestAlert",
  severity: "critical",
  labels: {},
  annotations: {},
  generatorUrl: "",
  startsAt: new Date(),
  endsAt: null,
  resolvedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A fetch stand-in that never resolves on its own — it only settles when
 * the caller's AbortSignal fires — so it faithfully simulates a hung/slow
 * network call bounded by whatever per-attempt timeout the client passed
 * via AbortSignal.timeout(...), the same way the real fetch() would.
 */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(signal.reason ?? new DOMException("aborted", "AbortError"));
      });
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HermesClient retry", () => {
  it("createRun retries a transient (5xx) failure and succeeds once it clears", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls < 3) return new Response("service unavailable", { status: 503 });
      return jsonResponse({ run_id: "run-1" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });
    const runId = await client.createRun(alert, 1, "instructions");

    expect(runId).toBe("run-1");
    expect(calls).toBe(3);
  });

  it("createRun does not retry a 4xx and fails on the first attempt", async () => {
    const fetchSpy = vi.fn(async () => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.createRun(alert, 1, "instructions")).rejects.toThrow(HermesApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("createRun exhausts its retry budget and rethrows on persistent transient failures", async () => {
    const fetchSpy = vi.fn(async () => new Response("service unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.createRun(alert, 1, "instructions")).rejects.toThrow(HermesApiError);
    // 3 total attempts (1 initial + 2 retries), never more.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("createRun keeps a chain of hung (timing-out) attempts inside its retry budget, not attempts * requestTimeoutMs", async () => {
    const fetchSpy = hangingFetch();
    vi.stubGlobal("fetch", fetchSpy);

    // requestTimeoutMs (40ms) * REQUEST_RETRY_ATTEMPTS (3) would be ~120ms
    // on its own, but a naive attempt-count-only retry (no deadline
    // awareness) is exactly the bug being guarded against here: with the
    // client's *real* defaults (requestTimeoutMs=10s), that arithmetic is
    // 3 * 10s = 30s against a 15s outer CREATE_RUN_TIMEOUT_MS. Scaled down
    // for a fast test: a 100ms budget must bound total wall-clock time to
    // ~100ms plus one attempt's worth of slop, never anywhere near 3 full
    // per-attempt timeouts.
    const requestTimeoutMs = 40;
    const createRunRetryBudgetMs = 100;
    const client = new HermesClient({ baseUrl: "http://hermes.test", requestTimeoutMs, createRunRetryBudgetMs });

    const start = Date.now();
    await expect(client.createRun(alert, 1, "instructions")).rejects.toThrow();
    const elapsed = Date.now() - start;

    // Generous slack for scheduler jitter, but nowhere near
    // REQUEST_RETRY_ATTEMPTS * requestTimeoutMs (120ms) plus backoff,
    // let alone what 3 full hangs at the *unshrunk* requestTimeoutMs would
    // have cost.
    expect(elapsed).toBeLessThan(createRunRetryBudgetMs + requestTimeoutMs + 100);
    // The deadline should have cut the chain short of the full attempt budget.
    expect(fetchSpy.mock.calls.length).toBeLessThan(3);
  });

  it("getRun makes a single attempt and does not retry internally, leaving retry/backoff to pollRun's own loop", async () => {
    const fetchSpy = vi.fn(async () => new Response("service unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.getRun("run-1")).rejects.toThrow(HermesApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("getRun does not retry a 4xx and fails on the first attempt", async () => {
    const fetchSpy = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.getRun("run-1")).rejects.toThrow(HermesApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stopRun retries a transient failure within its own (tighter) budget and still swallows the eventual failure", async () => {
    const fetchSpy = vi.fn(async () => new Response("service unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.stopRun("run-1")).resolves.toBeUndefined();
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("stopRun keeps a chain of hung attempts inside its own retry budget", async () => {
    const fetchSpy = hangingFetch();
    vi.stubGlobal("fetch", fetchSpy);

    const requestTimeoutMs = 30;
    const stopRunRetryBudgetMs = 70;
    const client = new HermesClient({ baseUrl: "http://hermes.test", requestTimeoutMs, stopRunRetryBudgetMs });

    const start = Date.now();
    await expect(client.stopRun("run-1")).resolves.toBeUndefined();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(stopRunRetryBudgetMs + requestTimeoutMs + 100);
  });
});
