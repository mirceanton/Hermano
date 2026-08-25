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

  it("getRun retries a network error and succeeds once it clears", async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new TypeError("fetch failed");
      return jsonResponse({ run_id: "run-1", status: "completed", output: "done\nSTATUS: completed" });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });
    const run = await client.getRun("run-1");

    expect(run.status).toBe("completed");
    expect(calls).toBe(2);
  });

  it("getRun does not retry a 4xx and fails on the first attempt", async () => {
    const fetchSpy = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);

    const client = new HermesClient({ baseUrl: "http://hermes.test" });

    await expect(client.getRun("run-1")).rejects.toThrow(HermesApiError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
