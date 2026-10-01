import { matchesLabels, type LabelMap } from "@hermano/shared";
import type { DelegationRuleRow } from "../db/schema.js";

function specificity(matchers: LabelMap): number {
  return Object.keys(matchers).length;
}

/**
 * Returns the enabled rule that best matches labels, or null if none do.
 * When several rules match, the most specific one (most matchers) wins and
 * ties go to the oldest rule — so a narrow rule (e.g. one pinning a single
 * alertname to its own Hermes profile) overrides a broad one (e.g.
 * severity=warning) no matter which was created first. The result is
 * therefore independent of the order enabledRules arrives in.
 */
export function matchRule(labels: LabelMap, enabledRules: DelegationRuleRow[]): DelegationRuleRow | null {
  const ranked = [...enabledRules].sort((a, b) => specificity(b.matchers) - specificity(a.matchers) || a.id - b.id);
  for (const rule of ranked) {
    if (matchesLabels(labels, rule.matchers)) {
      return rule;
    }
  }
  return null;
}
