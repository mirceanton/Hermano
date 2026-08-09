import * as client from "openid-client";
import type { OidcConfig } from "../config.js";

let discoveredConfig: client.Configuration | null = null;

/** Must be called once at boot (before the server starts accepting requests) when OIDC is configured. */
export async function initOidcClient(oidcConfig: OidcConfig): Promise<void> {
  discoveredConfig = await client.discovery(new URL(oidcConfig.issuerUrl), oidcConfig.clientId, {
    client_secret: oidcConfig.clientSecret,
  });
}

export function getOidcClient(): client.Configuration {
  if (!discoveredConfig) {
    throw new Error("OIDC client not initialized — call initOidcClient at boot");
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
