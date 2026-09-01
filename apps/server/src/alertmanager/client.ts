/** Thrown for any non-2xx HTTP response from Alertmanager's API. */
export class AlertmanagerApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`alertmanager: unexpected status ${statusCode}: ${body}`);
    this.name = "AlertmanagerApiError";
  }
}

export interface AlertmanagerClientConfig {
  /** Alertmanager's API root, e.g. "http://alertmanager.monitoring.svc.cluster.local:9093" — no trailing slash or path. */
  baseUrl: string;
  requestTimeoutMs?: number;
}

/** The subset of a gettableAlert (Alertmanager's OpenAPI schema) this client actually reads. */
interface GettableAlert {
  fingerprint?: string;
}

/**
 * Minimal read-only HTTP client for Alertmanager's Alerts API
 * (GET /api/v2/alerts) — used only by reconcile/reconcile.ts to double-check
 * that alerts Hermano still considers active are actually still active per
 * Alertmanager, independent of webhook delivery (see issue #20). Unrelated
 * to HermesClient/hermes/client.ts, which talks to a completely different
 * service.
 */
export class AlertmanagerClient {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(config: AlertmanagerClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;
  }

  enabled(): boolean {
    return this.baseUrl !== "";
  }

  /**
   * Fingerprints of every alert Alertmanager currently considers not yet
   * resolved — firing, silenced, inhibited, or unprocessed. GET
   * /api/v2/alerts' default filters (active=silenced=inhibited=unprocessed=true)
   * already return exactly that set: a resolved alert simply isn't in it,
   * there's no separate "resolved" state to filter out.
   */
  async listActiveFingerprints(): Promise<Set<string>> {
    const res = await fetch(`${this.baseUrl}/api/v2/alerts`, {
      method: "GET",
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 2048);
      throw new AlertmanagerApiError(res.status, body);
    }
    const decoded = (await res.json()) as GettableAlert[];
    return new Set(decoded.map((a) => a.fingerprint).filter((fp): fp is string => Boolean(fp)));
  }
}

/** The subset of AlertmanagerClient's public API reconcile.ts depends on — lets tests substitute a fake without instantiating the real class. */
export type AlertmanagerClientLike = Pick<AlertmanagerClient, "enabled" | "listActiveFingerprints">;
