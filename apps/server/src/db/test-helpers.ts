import { createDbClient, type DbClient } from "./client.js";
import { runMigrations } from "./migrate.js";

/** A fresh, fully-migrated in-memory database — one per call, isolated per test. */
export function createTestDb(): DbClient {
  const db = createDbClient(":memory:");
  runMigrations(db);
  return db;
}
