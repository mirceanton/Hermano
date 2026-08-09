import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettingsResponse } from "@hermano/shared";
import type { Config } from "../../config.js";
import type { DbClient } from "../../db/client.js";
import { RUN_INSTRUCTIONS } from "../../hermes/prompt.js";
import { effectiveHermesConfig } from "../../settings/effective.js";
import { getSettingsRow, updateSettingsRow, type SettingsPatch } from "../../settings/queries.js";

function toSettingsResponse(config: Config, db: DbClient): SettingsResponse {
  const settings = getSettingsRow(db);
  const locks = config.envLocks;
  const hermes = effectiveHermesConfig(config, settings);

  return {
    hermes: {
      agentUrl: { value: hermes.baseUrl, locked: locks.hermesAgentUrl },
      agentApiKeySet: Boolean(hermes.apiKey),
      agentApiKeyLocked: locks.hermesAgentApiKey,
      dispatchTimeoutMs: { value: hermes.dispatchTimeoutMs, locked: locks.hermesDispatchTimeoutMs },
      pollIntervalMs: { value: hermes.pollIntervalMs, locked: locks.hermesPollIntervalMs },
    },
    systemPrompt: {
      value: settings.customSystemPrompt ?? "",
      isCustom: Boolean(settings.customSystemPrompt?.trim()),
      default: RUN_INSTRUCTIONS,
    },
    oidc: {
      locked: locks.oidc,
      issuerUrl: locks.oidc ? (config.oidc?.issuerUrl ?? "") : (settings.oidcIssuerUrl ?? ""),
      clientId: locks.oidc ? (config.oidc?.clientId ?? "") : (settings.oidcClientId ?? ""),
      clientSecretSet: locks.oidc ? Boolean(config.oidc?.clientSecret) : Boolean(settings.oidcClientSecret),
      redirectUrl: locks.oidc ? (config.oidc?.redirectUrl ?? "") : (settings.oidcRedirectUrl ?? ""),
    },
  };
}

// "" (or whitespace-only) normalizes to null — clears the field — rather
// than being stored as a meaningless empty override.
const nullableString = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const nullablePositiveInt = z.number().int().positive().nullable().optional();

const updateBodySchema = z.object({
  hermesAgentUrl: nullableString,
  hermesAgentApiKey: nullableString,
  hermesDispatchTimeoutMs: nullablePositiveInt,
  hermesPollIntervalMs: nullablePositiveInt,
  customSystemPrompt: nullableString,
  oidcIssuerUrl: nullableString,
  oidcClientId: nullableString,
  oidcClientSecret: nullableString,
  oidcRedirectUrl: nullableString,
});

// Maps each editable body field to the EnvLocks key (if any) that locks it.
const FIELD_LOCKS = {
  hermesAgentUrl: "hermesAgentUrl",
  hermesAgentApiKey: "hermesAgentApiKey",
  hermesDispatchTimeoutMs: "hermesDispatchTimeoutMs",
  hermesPollIntervalMs: "hermesPollIntervalMs",
  oidcIssuerUrl: "oidc",
  oidcClientId: "oidc",
  oidcClientSecret: "oidc",
  oidcRedirectUrl: "oidc",
} as const;

export function registerSettingsRoutes(app: FastifyInstance, db: DbClient, config: Config): void {
  app.get("/api/settings", async (): Promise<SettingsResponse> => toSettingsResponse(config, db));

  app.patch("/api/settings", async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: `invalid settings payload: ${parsed.error.message}` });
      return;
    }

    for (const [field, lockKey] of Object.entries(FIELD_LOCKS)) {
      if (field in parsed.data && config.envLocks[lockKey]) {
        reply.code(400).send({ error: `${field} is set via an environment variable and cannot be edited here` });
        return;
      }
    }

    updateSettingsRow(db, parsed.data as SettingsPatch);
    return toSettingsResponse(config, db) satisfies SettingsResponse;
  });
}
