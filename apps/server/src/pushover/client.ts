export type PushoverPriority = -2 | -1 | 0 | 1;

export interface PushoverMessage {
  title: string;
  message: string;
  /** Defaults to 0 (normal) when omitted. Emergency priority (2) is deliberately unsupported — it requires retry/expire params and receipt polling, overkill for this app. */
  priority?: PushoverPriority;
  url?: string;
  urlTitle?: string;
}

export interface PushoverClientConfig {
  apiToken: string | undefined;
  userKey: string | undefined;
}

/**
 * Thin client for Pushover's message API (https://pushover.net/api). Unlike
 * HermesClient, send() never throws — a notification failure must never
 * break ingest or the dispatch worker, so every error is caught and logged
 * here rather than propagated.
 */
export class PushoverClient {
  private readonly apiToken: string | undefined;
  private readonly userKey: string | undefined;

  constructor(config: PushoverClientConfig) {
    this.apiToken = config.apiToken;
    this.userKey = config.userKey;
  }

  enabled(): boolean {
    return Boolean(this.apiToken) && Boolean(this.userKey);
  }

  async send(message: PushoverMessage): Promise<void> {
    if (!this.enabled()) return;

    try {
      const body = new URLSearchParams({
        token: this.apiToken!,
        user: this.userKey!,
        title: message.title,
        message: message.message,
        priority: String(message.priority ?? 0),
      });
      if (message.url) body.set("url", message.url);
      if (message.urlTitle) body.set("url_title", message.urlTitle);

      const res = await fetch("https://api.pushover.net/1/messages.json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`pushover: send failed (${res.status}): ${text.slice(0, 500)}`);
      }
    } catch (err) {
      console.error("pushover: send failed", err);
    }
  }
}
