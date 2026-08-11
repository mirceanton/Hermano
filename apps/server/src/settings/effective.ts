import type { Config, HermesConfig, OidcConfig, PushoverConfig } from "../config.js";
import type { SettingsRow } from "../db/schema.js";
import { RUN_INSTRUCTIONS } from "../hermes/prompt.js";

/**
 * Merges env-var config with DB-persisted settings-page overrides: an env
 * var, when set, always wins (see EnvLocks); otherwise the DB value is used
 * if set, falling back to config.hermes's own default (env value or the
 * zod-schema default, whichever loadConfig already resolved).
 */
export function effectiveHermesConfig(config: Config, settings: SettingsRow): HermesConfig {
  const locks = config.envLocks;
  return {
    baseUrl: locks.hermesAgentUrl ? config.hermes.baseUrl : (settings.hermesAgentUrl ?? config.hermes.baseUrl),
    apiKey: locks.hermesAgentApiKey ? config.hermes.apiKey : (settings.hermesAgentApiKey ?? config.hermes.apiKey),
    dispatchTimeoutMs: locks.hermesDispatchTimeoutMs
      ? config.hermes.dispatchTimeoutMs
      : (settings.hermesDispatchTimeoutMs ?? config.hermes.dispatchTimeoutMs),
    pollIntervalMs: locks.hermesPollIntervalMs
      ? config.hermes.pollIntervalMs
      : (settings.hermesPollIntervalMs ?? config.hermes.pollIntervalMs),
  };
}

export function effectivePushoverConfig(config: Config, settings: SettingsRow): PushoverConfig {
  const locks = config.envLocks;
  return {
    apiToken: locks.pushoverApiToken ? config.pushover.apiToken : (settings.pushoverApiToken ?? config.pushover.apiToken),
    userKey: locks.pushoverUserKey ? config.pushover.userKey : (settings.pushoverUserKey ?? config.pushover.userKey),
    notifyOnCompleted: locks.pushoverNotifyOnCompleted
      ? config.pushover.notifyOnCompleted
      : (settings.pushoverNotifyOnCompleted ?? config.pushover.notifyOnCompleted),
  };
}

/** The custom prompt override if one is set (and non-blank), else the built-in RUN_INSTRUCTIONS. */
export function effectiveSystemPrompt(settings: SettingsRow): string {
  return settings.customSystemPrompt?.trim() || RUN_INSTRUCTIONS;
}

/**
 * The externally-reachable origin used to build links back into the
 * dashboard (Pushover's "View in Hermano", OIDC's redirect default).
 * config.publicUrl already falls back to webBaseUrl (http://127.0.0.1:<port>)
 * when HERMANO_PUBLIC_URL is unset, so that's the final fallback here too.
 */
export function effectivePublicUrl(config: Config, settings: SettingsRow): string {
  if (config.envLocks.publicUrl) return config.publicUrl;
  return settings.publicUrl ?? config.publicUrl;
}

/**
 * OIDC has no per-field locking (loadConfig already requires its three env
 * vars all-or-nothing), so this is env-or-DB at the whole-integration
 * level: env config if configured there, else a DB-built OidcConfig once
 * issuer/client id/secret are all present, else null (single-user mode).
 */
export function effectiveOidcConfig(config: Config, settings: SettingsRow): OidcConfig | null {
  if (config.envLocks.oidc) return config.oidc;

  if (settings.oidcIssuerUrl && settings.oidcClientId && settings.oidcClientSecret) {
    return {
      issuerUrl: settings.oidcIssuerUrl,
      clientId: settings.oidcClientId,
      clientSecret: settings.oidcClientSecret,
      redirectUrl: settings.oidcRedirectUrl || `${effectivePublicUrl(config, settings)}/auth/callback`,
    };
  }

  return null;
}
