import { and, asc, eq, ne } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { delegationRules, hermesProfiles, type HermesProfileRow } from "../db/schema.js";

export function listProfiles(db: DbClient): HermesProfileRow[] {
  return db.select().from(hermesProfiles).orderBy(asc(hermesProfiles.name)).all();
}

export function getProfile(db: DbClient, id: number): HermesProfileRow | null {
  return db.select().from(hermesProfiles).where(eq(hermesProfiles.id, id)).get() ?? null;
}

export function createProfile(db: DbClient, input: { name: string; url: string; apiKey: string | null }): HermesProfileRow {
  const now = new Date();
  return db
    .insert(hermesProfiles)
    .values({ ...input, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateProfile(
  db: DbClient,
  id: number,
  patch: { name?: string | undefined; url?: string | undefined; apiKey?: string | null | undefined },
): HermesProfileRow | null {
  const rows = db
    .update(hermesProfiles)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(hermesProfiles.id, id))
    .returning()
    .all();
  return rows[0] ?? null;
}

export function deleteProfile(db: DbClient, id: number): boolean {
  return db.delete(hermesProfiles).where(eq(hermesProfiles.id, id)).returning().all().length > 0;
}

/** Reports whether another profile (other than excludeId, used when editing a profile against itself) already uses this exact name. */
export function profileNameExists(db: DbClient, name: string, excludeId?: number): boolean {
  const sameName = eq(hermesProfiles.name, name);
  const row = db
    .select({ id: hermesProfiles.id })
    .from(hermesProfiles)
    .where(excludeId == null ? sameName : and(sameName, ne(hermesProfiles.id, excludeId)))
    .get();
  return row != null;
}

/** Names of every rule (enabled or not) that routes to this profile — what blocks deleting it. */
export function ruleNamesUsingProfile(db: DbClient, profileId: number): string[] {
  return db
    .select({ name: delegationRules.name })
    .from(delegationRules)
    .where(eq(delegationRules.profileId, profileId))
    .all()
    .map((row) => row.name);
}
