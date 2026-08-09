import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import type { LabelMap, RuleSnapshot, DelegationStatus } from "@hermano/shared";

/**
 * One row per alert *episode* (a firing→resolved lifecycle). A given
 * fingerprint can have many rows over time (one per episode), but at most
 * one with resolvedAt IS NULL — enforced below by a partial unique index,
 * not just by query pattern (the Go predecessor only had the latter, which
 * left a real race window under concurrent webhook delivery).
 */
export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fingerprint: text("fingerprint").notNull(),
    alertName: text("alert_name").notNull(),
    severity: text("severity").notNull().default(""),
    labels: text("labels", { mode: "json" }).$type<LabelMap>().notNull().default({}),
    annotations: text("annotations", { mode: "json" }).$type<LabelMap>().notNull().default({}),
    generatorUrl: text("generator_url").notNull().default(""),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    alertNameIdx: index("alerts_alert_name_idx").on(table.alertName),
    resolvedAtIdx: index("alerts_resolved_at_idx").on(table.resolvedAt),
    fingerprintIdx: index("alerts_fingerprint_idx").on(table.fingerprint),
    activeFingerprintUnique: uniqueIndex("alerts_fingerprint_active_unique")
      .on(table.fingerprint)
      .where(sql`${table.resolvedAt} is null`),
  }),
);

/** One row per firing notification — the source of truth for fire count/history, never a cached counter. */
export const alertTriggers = sqliteTable(
  "alert_triggers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: integer("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    firedAt: integer("fired_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    alertIdIdx: index("alert_triggers_alert_id_idx").on(table.alertId),
    firedAtIdx: index("alert_triggers_fired_at_idx").on(table.firedAt),
  }),
);

/**
 * A label-matcher-based auto-delegation rule. Duplicate matcher sets are
 * rejected at the application layer (see rules/queries.ts), not via a DB
 * constraint — matchers is a JSON blob, so there's no natural column-level
 * uniqueness to express. `enabled` has no `.default()`: always pass it
 * explicitly from the route handler.
 */
export const delegationRules = sqliteTable("delegation_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  matchers: text("matchers", { mode: "json" }).$type<LabelMap>().notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * One row per dispatch *attempt* — append-only. A retry after a failure
 * inserts a new row rather than overwriting the old one, so an alert's full
 * delegation history is always preserved.
 */
export const delegations = sqliteTable(
  "delegations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    alertId: integer("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    triggerId: integer("trigger_id").references(() => alertTriggers.id, { onDelete: "set null" }),
    // A rule can be deleted after it triggered a delegation; ruleSnapshot
    // below freezes its name+matchers at match time so history survives that.
    ruleId: integer("rule_id").references(() => delegationRules.id, { onDelete: "set null" }),
    ruleSnapshot: text("rule_snapshot", { mode: "json" }).$type<RuleSnapshot>().notNull(),
    status: text("status", {
      enum: ["pending", "dispatched", "completed", "failed", "timed_out"],
    })
      .$type<DelegationStatus>()
      .notNull(),
    runId: text("run_id"),
    delegatedAt: integer("delegated_at", { mode: "timestamp_ms" }).notNull(),
    dispatchedAt: integer("dispatched_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    summary: text("summary"),
    // Nullable, not 0-defaulted: null means Hermes never reported usage for
    // this attempt, which is a different fact than "used zero tokens."
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    alertIdIdx: index("delegations_alert_id_idx").on(table.alertId),
    statusIdx: index("delegations_status_idx").on(table.status),
    runIdIdx: index("delegations_run_id_idx").on(table.runId),
    delegatedAtIdx: index("delegations_delegated_at_idx").on(table.delegatedAt),
  }),
);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Null for the synthetic single-user-mode "local owner" row.
  oidcSubject: text("oidc_subject").unique(),
  email: text("email"),
  name: text("name"),
  isLocalOwner: integer("is_local_owner", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  // Opaque random token; this value (not the row id) is what's stored in the session cookie.
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Runtime-editable overrides for the Settings page — always exactly one row
 * (id fixed at SETTINGS_ROW_ID in settings/queries.ts). Every column here
 * has an env-var counterpart in config.ts; when the env var is set it wins
 * and the corresponding column here is just ignored (see settings/effective.ts).
 */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hermesAgentUrl: text("hermes_agent_url"),
  hermesAgentApiKey: text("hermes_agent_api_key"),
  hermesDispatchTimeoutMs: integer("hermes_dispatch_timeout_ms"),
  hermesPollIntervalMs: integer("hermes_poll_interval_ms"),
  // Overrides hermes/prompt.ts's RUN_INSTRUCTIONS when set.
  customSystemPrompt: text("custom_system_prompt"),
  oidcIssuerUrl: text("oidc_issuer_url"),
  oidcClientId: text("oidc_client_id"),
  oidcClientSecret: text("oidc_client_secret"),
  oidcRedirectUrl: text("oidc_redirect_url"),
  // Auto-generated on first use when OIDC becomes DB-configured and no
  // SESSION_SECRET env var is set — never exposed via the API.
  sessionSecret: text("session_secret"),
  pushoverApiToken: text("pushover_api_token"),
  pushoverUserKey: text("pushover_user_key"),
  // Nullable, not defaulted: null means "unset" (fall through to the env-or-
  // default value), not false — see settings/effective.ts.
  pushoverNotifyOnCompleted: integer("pushover_notify_on_completed", { mode: "boolean" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type AlertRow = typeof alerts.$inferSelect;
export type NewAlertRow = typeof alerts.$inferInsert;
export type AlertTriggerRow = typeof alertTriggers.$inferSelect;
export type NewAlertTriggerRow = typeof alertTriggers.$inferInsert;
export type DelegationRuleRow = typeof delegationRules.$inferSelect;
export type NewDelegationRuleRow = typeof delegationRules.$inferInsert;
export type DelegationRow = typeof delegations.$inferSelect;
export type NewDelegationRow = typeof delegations.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type NewSettingsRow = typeof settings.$inferInsert;
