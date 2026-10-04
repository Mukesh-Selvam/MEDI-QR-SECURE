import { Logger } from "@nestjs/common";
import { env } from "../../config/env.js";
import { eq } from "drizzle-orm";
import { db, pool } from "../index.js";
import { users } from "../schema.js";

const logger = new Logger("DevSeed");
const seedEmail = "patient.seed@mediqr.invalid";

async function seedDevUser(): Promise<void> {
  if (env.NODE_ENV === "production") {
    throw new Error("Development seed data is forbidden in production.");
  }

  const existingUser = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, seedEmail),
  });

  if (!existingUser) {
    await db.insert(users).values({
      email: seedEmail,
      role: "patient",
      status: "active",
    });
  }

  logger.log("Fake development patient user is ready.");
}

seedDevUser()
  .catch((error: unknown) => {
    logger.error(
      "Development seed failed.",
      error instanceof Error ? error.stack : undefined
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
