import { describe, expect, it } from "vitest";
import { createTestDb } from "../db/test-helpers.js";
import { ensureSessionSecret, getSettingsRow, updateSettingsRow } from "./queries.js";

describe("getSettingsRow", () => {
  it("creates a default row on first read", () => {
    const db = createTestDb();
    const row = getSettingsRow(db);
    expect(row.id).toBe(1);
    expect(row.hermesAgentUrl).toBeNull();
    expect(row.customSystemPrompt).toBeNull();
  });

  it("returns the same row on subsequent reads", () => {
    const db = createTestDb();
    const first = getSettingsRow(db);
    updateSettingsRow(db, { hermesAgentUrl: "http://example.com" });
    const second = getSettingsRow(db);
    expect(second.id).toBe(first.id);
    expect(second.hermesAgentUrl).toBe("http://example.com");
  });
});

describe("updateSettingsRow", () => {
  it("updates only the given fields and bumps updatedAt", () => {
    const db = createTestDb();
    const before = getSettingsRow(db);
    const updated = updateSettingsRow(db, { customSystemPrompt: "be nice" });
    expect(updated.customSystemPrompt).toBe("be nice");
    expect(updated.hermesAgentUrl).toBeNull();
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  });
});

describe("ensureSessionSecret", () => {
  it("generates a secret once and persists it across calls", () => {
    const db = createTestDb();
    const first = ensureSessionSecret(db);
    expect(first.length).toBeGreaterThanOrEqual(32);
    const second = ensureSessionSecret(db);
    expect(second).toBe(first);
  });
});
