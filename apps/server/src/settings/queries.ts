import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { settings, type SettingsRow } from "../db/schema.js";

/** Always exactly one row. */
const SETTINGS_ROW_ID = 1;

export function getSettingsRow(db: DbClient): SettingsRow {
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ROW_ID)).get();
  if (existing) return existing;

  return db
    .insert(settings)
    .values({ id: SETTINGS_ROW_ID, updatedAt: new Date() })
    .returning()
    .get();
}

// Deliberately includes sessionSecret (only ensureSessionSecret below sets
// it) — the HTTP settings route's own request-body schema is what actually
// keeps that field unreachable from user input, not this type.
export type SettingsPatch = Partial<Omit<SettingsRow, "id" | "updatedAt">>;

export function updateSettingsRow(db: DbClient, patch: SettingsPatch): SettingsRow {
  getSettingsRow(db); // ensure the row exists before updating it
  return db
    .update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, SETTINGS_ROW_ID))
    .returning()
    .get();
}

/**
 * Returns the persisted session-signing secret, generating and storing a
 * random one on first use. This is what lets OIDC become fully DB-
 * configured (via the Settings page) without also requiring a manually-set
 * SESSION_SECRET env var — env still wins if one is set (see effective.ts).
 */
export function ensureSessionSecret(db: DbClient): string {
  const row = getSettingsRow(db);
  if (row.sessionSecret) return row.sessionSecret;

  const generated = randomBytes(32).toString("hex");
  updateSettingsRow(db, { sessionSecret: generated });
  return generated;
}
