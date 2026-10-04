/**
 * Programmatic Drizzle Database Migration Runner
 * ===============================================
 * Executes pending SQL migrations against the configured PostgreSQL instance.
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { Logger } from "@nestjs/common";

const logger = new Logger("Migrations");

export async function runMigrations() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(currentDir, "migrations");
  logger.log("Applying pending database migrations...");
  await migrate(db, { migrationsFolder });
  logger.log("Migrations applied successfully.");
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
      logger.error("Migration failed.", err instanceof Error ? err.stack : undefined);
      await pool.end();
      process.exit(1);
    });
}
