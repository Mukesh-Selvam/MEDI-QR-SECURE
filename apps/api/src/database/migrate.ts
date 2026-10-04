/**
 * Programmatic Drizzle Database Migration Runner
 * ===============================================
 * Executes pending SQL migrations against the configured PostgreSQL instance.
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

export async function runMigrations() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(currentDir, "migrations");
  console.log(`[Migrations] Applying migrations from ${migrationsFolder}...`);
  await migrate(db, { migrationsFolder });
  console.log("[Migrations] Migrations applied successfully.");
}

// Allow direct execution via tsx src/database/migrate.ts
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Migrations] Migration failed:", err);
      await pool.end();
      process.exit(1);
    });
}
