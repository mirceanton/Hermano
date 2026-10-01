import { matchesLabels, labelMapsEqual } from "@hermano/shared";
import { describe, expect, it } from "vitest";
import type { DelegationRuleRow } from "../db/schema.js";
import { matchRule } from "./matcher.js";

describe("matchesLabels", () => {
  const labels = { alertname: "KubePodCrashLooping", severity: "critical", namespace: "default" };

  it.each([
    ["single match", { alertname: "KubePodCrashLooping" }, true],
    ["multi match AND", { alertname: "KubePodCrashLooping", severity: "critical" }, true],
    ["one mismatching key fails AND", { alertname: "KubePodCrashLooping", severity: "warning" }, false],
    ["missing key fails", { team: "sre" }, false],
    ["empty matchers never match", {}, false],
  ] as const)("%s", (_name, matchers, want) => {
    expect(matchesLabels(labels, matchers)).toBe(want);
  });
});

describe("labelMapsEqual", () => {
  it.each([
    ["identical", { alertname: "Foo", severity: "critical" }, { alertname: "Foo", severity: "critical" }, true],
    ["different order same content", { severity: "critical", alertname: "Foo" }, { alertname: "Foo", severity: "critical" }, true],
    ["different value", { alertname: "Foo" }, { alertname: "Bar" }, false],
    ["different size", { alertname: "Foo" }, { alertname: "Foo", severity: "critical" }, false],
    ["both empty", {}, {}, true],
  ] as const)("%s", (_name, a, b, want) => {
    expect(labelMapsEqual(a, b)).toBe(want);
  });
});

function rule(overrides: Partial<DelegationRuleRow>): DelegationRuleRow {
  const now = new Date();
  return {
    id: 1,
    name: "rule",
    matchers: {},
    enabled: true,
    profileId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("matchRule", () => {
  it("returns null when no enabled rule matches", () => {
    const rules = [rule({ id: 1, matchers: { alertname: "Other" } })];
    expect(matchRule({ alertname: "Target" }, rules)).toBeNull();
  });

  it("returns the first enabled rule that matches", () => {
    const rules = [
      rule({ id: 1, name: "first", matchers: { alertname: "Target" } }),
      rule({ id: 2, name: "second", matchers: { alertname: "Target" } }),
    ];
    expect(matchRule({ alertname: "Target" }, rules)?.id).toBe(1);
  });

  it("prefers the more specific rule even when a broader one was created first", () => {
    const rules = [
      rule({ id: 1, name: "broad", matchers: { severity: "critical" } }),
      rule({ id: 2, name: "narrow", matchers: { severity: "critical", alertname: "Target" } }),
    ];
    expect(matchRule({ alertname: "Target", severity: "critical" }, rules)?.name).toBe("narrow");
    expect(matchRule({ alertname: "Other", severity: "critical" }, rules)?.name).toBe("broad");
  });

  it("gives equally specific rules to the oldest, regardless of input order", () => {
    const older = rule({ id: 1, name: "older", matchers: { alertname: "Target" } });
    const newer = rule({ id: 2, name: "newer", matchers: { severity: "critical" } });
    const labels = { alertname: "Target", severity: "critical" };
    expect(matchRule(labels, [older, newer])?.name).toBe("older");
    expect(matchRule(labels, [newer, older])?.name).toBe("older");
  });

  it("does not reorder the caller's array", () => {
    const rules = [
      rule({ id: 1, matchers: { severity: "critical" } }),
      rule({ id: 2, matchers: { severity: "critical", alertname: "Target" } }),
    ];
    matchRule({ alertname: "Target", severity: "critical" }, rules);
    expect(rules.map((r) => r.id)).toEqual([1, 2]);
  });
});
