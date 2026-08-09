import { desc, eq, ne } from "drizzle-orm";
import { labelMapsEqual, type LabelMap } from "@hermano/shared";
import type { DbClient } from "../db/client.js";
import { delegationRules, type DelegationRuleRow } from "../db/schema.js";

export function listRules(db: DbClient): DelegationRuleRow[] {
  return db.select().from(delegationRules).orderBy(desc(delegationRules.createdAt)).all();
}

export function createRule(
  db: DbClient,
  input: { name: string; matchers: LabelMap; enabled: boolean },
): DelegationRuleRow {
  const now = new Date();
  return db
    .insert(delegationRules)
    .values({ ...input, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateRule(
  db: DbClient,
  id: number,
  input: Partial<{ name: string; matchers: LabelMap; enabled: boolean }>,
): DelegationRuleRow | null {
  const rows = db
    .update(delegationRules)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(delegationRules.id, id))
    .returning()
    .all();
  return rows[0] ?? null;
}

export function deleteRule(db: DbClient, id: number): boolean {
  const rows = db.delete(delegationRules).where(eq(delegationRules.id, id)).returning().all();
  return rows.length > 0;
}

/**
 * Reports whether any existing rule (other than excludeId, used when
 * editing a rule against itself) already has exactly matchers as its
 * matcher set, regardless of name or enabled state.
 */
export function ruleMatchersExist(db: DbClient, matchers: LabelMap, excludeId?: number): boolean {
  const rows =
    excludeId == null
      ? db.select().from(delegationRules).all()
      : db.select().from(delegationRules).where(ne(delegationRules.id, excludeId)).all();
  return rows.some((rule) => labelMapsEqual(rule.matchers, matchers));
}
