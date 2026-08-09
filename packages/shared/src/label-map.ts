export type LabelMap = Record<string, string>;

/**
 * Reports whether labels satisfies every key/value pair in matchers (logical
 * AND, exact string equality, no wildcards/regex). An empty matcher set never
 * matches — a rule with no matchers configured is inert, not a catch-all.
 */
export function matchesLabels(labels: LabelMap, matchers: LabelMap): boolean {
  const keys = Object.keys(matchers);
  if (keys.length === 0) return false;
  return keys.every((key) => labels[key] === matchers[key]);
}

/** Reports whether two matcher sets are identical (same keys, same values) — used to reject duplicate rules. */
export function labelMapsEqual(a: LabelMap, b: LabelMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}
