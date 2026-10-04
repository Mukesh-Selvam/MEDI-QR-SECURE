/**
 * Database Connection & Drizzle ORM Instance
 * ==========================================
 * Connects to PostgreSQL using pg.Pool with validated environment variables.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: env.DB_MAX_CONNECTIONS,
  ssl: env.DB_SSL_ENABLED ? { rejectUnauthorized: true } : false,
});

export const db = drizzle(pool, { schema });
export { schema };
