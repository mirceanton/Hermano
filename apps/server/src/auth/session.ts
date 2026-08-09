import { randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { DbClient } from "../db/client.js";
import { sessions as sessionsTable, users as usersTable, type UserRow } from "../db/schema.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createSession(db: DbClient, userId: number): { id: string; expiresAt: Date } {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessionsTable).values({ id, userId, createdAt: now, expiresAt }).run();
  return { id, expiresAt };
}

export function getUserBySession(db: DbClient, sessionId: string): UserRow | null {
  const now = new Date();
  const row = db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(and(eq(sessionsTable.id, sessionId), gt(sessionsTable.expiresAt, now)))
    .get();
  return row?.user ?? null;
}

export function deleteSession(db: DbClient, sessionId: string): void {
  db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).run();
}

export interface OidcProfile {
  sub: string;
  email?: string;
  name?: string;
}

export function upsertOidcUser(db: DbClient, profile: OidcProfile): UserRow {
  const existing = db.select().from(usersTable).where(eq(usersTable.oidcSubject, profile.sub)).get();
  const now = new Date();

  if (existing) {
    const updated = {
      ...existing,
      email: profile.email ?? existing.email,
      name: profile.name ?? existing.name,
      updatedAt: now,
    };
    db.update(usersTable)
      .set({ email: updated.email, name: updated.name, updatedAt: now })
      .where(eq(usersTable.id, existing.id))
      .run();
    return updated;
  }

  return db
    .insert(usersTable)
    .values({
      oidcSubject: profile.sub,
      email: profile.email,
      name: profile.name,
      isLocalOwner: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** Single-user mode: the one synthetic user every request resolves to. Created on first use. */
export function ensureLocalOwner(db: DbClient): UserRow {
  const existing = db.select().from(usersTable).where(eq(usersTable.isLocalOwner, true)).get();
  if (existing) return existing;

  const now = new Date();
  return db
    .insert(usersTable)
    .values({ isLocalOwner: true, name: "Local Owner", createdAt: now, updatedAt: now })
    .returning()
    .get();
}
