import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DbClient } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(__dirname, "..", "..", "drizzle");

export function runMigrations(db: DbClient): void {
  migrate(db, { migrationsFolder });
}
