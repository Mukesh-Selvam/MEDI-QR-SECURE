import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./src/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://mediqr_user:mediqr_secure_dev_password_do_not_use_in_prod@localhost:5433/mediqr_db",
  },
});
