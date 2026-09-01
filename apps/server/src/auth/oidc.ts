import * as client from "openid-client";
import type { FastifyBaseLogger } from "fastify";
import type { OidcConfig } from "../config.js";
import { withRetry } from "../lib/retry.js";

let discoveredConfig: client.Configuration | null = null;

// A blip on the IdP side (restart, migration, brief network partition) is
// common enough at boot that crashing the whole process on the first failed
// discovery attempt — taking down alert ingestion and the dashboard along
// with it — is worse than riding it out. Fast-failing attempts (the
// observed case: an immediate 404) back off up to ~29s total across 5
// attempts; a hung attempt can take longer since each one still runs to
// openid-client's own (30s default) per-request timeout.
const DISCOVERY_RETRY_ATTEMPTS = 5;
const DISCOVERY_RETRY_BASE_DELAY_MS = 2_000;
const DISCOVERY_RETRY_MAX_DELAY_MS = 15_000;

/**
 * Must be called once at boot when OIDC is configured — but unlike most
 * boot-time setup, a failure here does not stop the server from starting.
 * Discovery is retried with backoff to ride out a transient blip; if the
 * IdP is still unreachable once the retry budget is spent, this logs and
 * returns rather than throwing, leaving discoveredConfig unset. The rest of
 * the server (alert ingestion, the dashboard, webhook delivery) comes up
 * regardless — OIDC login/callback then fail per-request via
 * getOidcClient()'s own check below until the next restart retries
 * discovery from scratch.
 */
export async function initOidcClient(oidcConfig: OidcConfig, log: FastifyBaseLogger): Promise<boolean> {
  try {
    discoveredConfig = await withRetry(
      () =>
        client.discovery(new URL(oidcConfig.issuerUrl), oidcConfig.clientId, {
          client_secret: oidcConfig.clientSecret,
        }),
      {
        attempts: DISCOVERY_RETRY_ATTEMPTS,
        baseDelayMs: DISCOVERY_RETRY_BASE_DELAY_MS,
        maxDelayMs: DISCOVERY_RETRY_MAX_DELAY_MS,
        // Whatever the failure — a transient 5xx/404, a network blip,
        // even a config mistake — the cost of retrying it out is the same
        // bounded ~29s-plus-hangs budget, and giving up gracefully
        // afterward (see the catch below) is the same either way. Not
        // worth the fragility of special-casing openid-client's internal
        // error shapes to tell those cases apart.
        isRetryable: () => true,
      },
    );
    return true;
  } catch (err) {
    log.error(
      err,
      `OIDC discovery failed after ${DISCOVERY_RETRY_ATTEMPTS} attempts against ${oidcConfig.issuerUrl} — starting without OIDC login enabled; restart the process once the identity provider is reachable again`,
    );
    return false;
  }
}

export function getOidcClient(): client.Configuration {
  if (!discoveredConfig) {
    throw new Error("OIDC is not available: discovery has not completed (identity provider may be unreachable)");
  }
  return discoveredConfig;
}

interface PendingAuth {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
}

// In-memory is fine: these are short-lived (minutes) and single-process —
// losing them across a restart just means an in-flight login has to restart
// too, no data loss.
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
const pendingAuthRequests = new Map<string, PendingAuth>();

export function createPendingAuth(state: string, codeVerifier: string, nonce: string): void {
  pendingAuthRequests.set(state, { codeVerifier, nonce, createdAt: Date.now() });
}

/** One-time use: the entry is removed whether or not it's still valid. */
export function consumePendingAuth(state: string): Omit<PendingAuth, "createdAt"> | null {
  const entry = pendingAuthRequests.get(state);
  pendingAuthRequests.delete(state);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > PENDING_AUTH_TTL_MS) return null;
  return entry;
}
