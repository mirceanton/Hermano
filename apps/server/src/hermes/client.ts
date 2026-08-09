import type { AlertRow } from "../db/schema.js";
import { RUN_INSTRUCTIONS, buildInput } from "./prompt.js";

/** Thrown for any non-2xx HTTP response. statusCode lets callers distinguish "will never succeed by retrying" (4xx) from transient (5xx). */
export class HermesApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`hermes: unexpected status ${statusCode}: ${body}`);
    this.name = "HermesApiError";
  }
}

export interface HermesUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface HermesRun {
  runId: string;
  status: string;
  output: string;
  usage: HermesUsage | null;
}

export interface HermesClientConfig {
  /** Hermes' api-server root, e.g. "http://hermes-api.ai.svc.cluster.local:8642" — no trailing slash or path. */
  baseUrl: string;
  /** Bearer token — Hermes' configured API_SERVER_KEY. */
  apiKey?: string | undefined;
  /** Bounds each individual HTTP call, not a run's overall wall-clock budget (the caller controls that separately). */
  requestTimeoutMs?: number;
}

/**
 * HTTP client for Hermes' OpenAI-compatible Runs API (POST /v1/runs, GET
 * /v1/runs/{id}, POST /v1/runs/{id}/stop). There is no asynchronous
 * callback: createRun starts a run and returns as soon as Hermes has
 * accepted it; the caller (delegate/delegate.ts) polls getRun until the
 * run reaches a terminal state.
 */
export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly requestTimeoutMs: number;

  constructor(config: HermesClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  enabled(): boolean {
    return this.baseUrl !== "";
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 2048);
      throw new HermesApiError(res.status, body);
    }
    return res;
  }

  /**
   * Starts a Hermes run investigating alert and returns Hermes' run_id as
   * soon as it's accepted. Every call is a wholly fresh, stateless run: no
   * session/previous-response id is sent, so a delegation never inherits
   * context from a prior investigation of the same alert. timesFired is
   * looked up by the caller since this client stays database-agnostic.
   * instructions defaults to the built-in RUN_INSTRUCTIONS but can be
   * overridden per-call with the Settings page's custom system prompt.
   */
  async createRun(alert: AlertRow, timesFired: number, instructions: string = RUN_INSTRUCTIONS): Promise<string> {
    const res = await this.request("/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: buildInput(alert, timesFired),
        instructions,
      }),
    });
    const decoded = (await res.json()) as { run_id?: string };
    if (!decoded.run_id) {
      throw new Error("hermes: create-run response had an empty run_id");
    }
    return decoded.run_id;
  }

  async getRun(runId: string): Promise<HermesRun> {
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" });
    const decoded = (await res.json()) as {
      run_id: string;
      status: string;
      output: string;
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
    };
    return {
      runId: decoded.run_id,
      status: decoded.status,
      output: decoded.output,
      usage: decoded.usage
        ? {
            inputTokens: decoded.usage.input_tokens,
            outputTokens: decoded.usage.output_tokens,
            totalTokens: decoded.usage.total_tokens,
          }
        : null,
    };
  }

  /** Best-effort interrupt of an in-progress run. Errors are non-fatal to the caller. */
  async stopRun(runId: string): Promise<void> {
    try {
      await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
    } catch {
      // Best-effort: the caller has already given up on this run either way.
    }
  }
}

/** The subset of HermesClient's public API that outcome/delegate logic depends on — lets tests substitute a fake without instantiating the real class. */
export type HermesClientLike = Pick<HermesClient, "enabled" | "createRun" | "getRun" | "stopRun">;
