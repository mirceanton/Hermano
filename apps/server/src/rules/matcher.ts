import { matchesLabels, type LabelMap } from "@hermano/shared";
import type { DelegationRuleRow } from "../db/schema.js";

/** Returns the first enabled rule whose matchers all match labels, or null if none do. */
export function matchRule(labels: LabelMap, enabledRules: DelegationRuleRow[]): DelegationRuleRow | null {
  for (const rule of enabledRules) {
    if (matchesLabels(labels, rule.matchers)) {
      return rule;
    }
  }
  return null;
}
