import { z } from "zod";

const envSchema = z.object({
  HERMANO_DATABASE_PATH: z
    .string()
    .min(1, "HERMANO_DATABASE_PATH must be set to the path of the SQLite database file"),
  HERMANO_PORT: z.coerce.number().int().positive().default(8080),
  HERMANO_WEBHOOK_SHARED_SECRET: z.string().min(1).optional(),
  HERMANO_HERMES_AGENT_URL: z.string().url().optional(),
  HERMANO_HERMES_AGENT_API_KEY: z.string().min(1).optional(),
  HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60_000),
  HERMANO_HERMES_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Absolute path to the built web SPA (apps/web/dist). When set, this
  // server also serves the SPA (with client-side-routing fallback) at `/`.
  // Left unset in dev, where the Vite dev server serves the SPA instead.
  STATIC_WEB_DIR: z.string().min(1).optional(),
  // OIDC: unset entirely -> single-user mode (no login). If any of these
  // three are set, all three (and SESSION_SECRET) are required.
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_REDIRECT_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters").optional(),
});

export interface OidcConfig {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
}

export interface HermesConfig {
  baseUrl: string;
  apiKey: string | undefined;
  dispatchTimeoutMs: number;
  pollIntervalMs: number;
}

export type Config = {
  databasePath: string;
  port: number;
  webhookSharedSecret: string | null;
  hermes: HermesConfig;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  webBaseUrl: string;
  staticWebDir: string | null;
  /** null means single-user mode: no auth middleware is mounted at all. */
  oidc: OidcConfig | null;
  sessionSecret: string | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const parsed = result.data;
  const webBaseUrl = `http://127.0.0.1:${parsed.HERMANO_PORT}`;

  const oidcFieldsSet = [parsed.OIDC_ISSUER_URL, parsed.OIDC_CLIENT_ID, parsed.OIDC_CLIENT_SECRET];
  const anyOidcFieldSet = oidcFieldsSet.some((v) => v != null);
  const allOidcFieldsSet = oidcFieldsSet.every((v) => v != null);

  if (anyOidcFieldSet && !allOidcFieldsSet) {
    throw new Error(
      "Invalid environment configuration:\n" +
        "  - OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET must all be set together, or all left unset for single-user mode",
    );
  }
  if (anyOidcFieldSet && !parsed.SESSION_SECRET) {
    throw new Error(
      "Invalid environment configuration:\n" +
        "  - SESSION_SECRET is required when OIDC_* is configured (at least 32 characters)",
    );
  }

  const oidc: OidcConfig | null = allOidcFieldsSet
    ? {
        issuerUrl: parsed.OIDC_ISSUER_URL!,
        clientId: parsed.OIDC_CLIENT_ID!,
        clientSecret: parsed.OIDC_CLIENT_SECRET!,
        redirectUrl: parsed.OIDC_REDIRECT_URL ?? `${webBaseUrl}/auth/callback`,
      }
    : null;

  return {
    databasePath: parsed.HERMANO_DATABASE_PATH,
    port: parsed.HERMANO_PORT,
    webhookSharedSecret: parsed.HERMANO_WEBHOOK_SHARED_SECRET ?? null,
    hermes: {
      baseUrl: parsed.HERMANO_HERMES_AGENT_URL ?? "",
      apiKey: parsed.HERMANO_HERMES_AGENT_API_KEY,
      dispatchTimeoutMs: parsed.HERMANO_HERMES_AGENT_DISPATCH_TIMEOUT_MS,
      pollIntervalMs: parsed.HERMANO_HERMES_POLL_INTERVAL_MS,
    },
    logLevel: parsed.LOG_LEVEL,
    webBaseUrl,
    staticWebDir: parsed.STATIC_WEB_DIR ?? null,
    oidc,
    sessionSecret: parsed.SESSION_SECRET ?? null,
  };
}
