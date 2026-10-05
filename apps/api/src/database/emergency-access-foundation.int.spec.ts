import { describe, expect, it } from "vitest";
import { pool } from "./index.js";
import { emergencyReasonCodeEnum } from "./schema.js";

describe("Emergency-access database foundation (integration)", () => {
  it("persists only the approved finite emergency reason codes", async () => {
    const result = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'emergency_reason_code'
       ORDER BY e.enumsortorder`
    );

    expect(result.rows.map(({ enumlabel }) => enumlabel)).toEqual([
      ...emergencyReasonCodeEnum.enumValues,
    ]);
  });

  it("defines the emergency-department realm role in the API role enum", async () => {
    const result = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'user_role'
         AND e.enumlabel = 'emergency-department-staff'`
    );

    expect(result.rows).toEqual([
      { enumlabel: "emergency-department-staff" },
    ]);
  });

  it("keeps emergency-visible document metadata opt-in by default", async () => {
    const result = await pool.query<{
      column_default: string | null;
      is_nullable: string;
    }>(
      `SELECT column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'documents'
         AND column_name = 'emergency_visible'`
    );

    expect(result.rows).toEqual([
      { column_default: "false", is_nullable: "NO" },
    ]);
  });

  it("constrains grants to a fixed 30-minute expiry and stores no free-text note", async () => {
    const constraints = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'emergency_access_requests'`
    );
    expect(
      constraints.rows.some(({ definition }) =>
        /granted_at.*(?:30 minutes|00:30:00)/i.test(definition)
      )
    ).toBe(true);

    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (
           'emergency_access_requests',
           'emergency_access_reviews'
         )`
    );
    expect(
      columns.rows.filter(({ column_name }) =>
        /note|comment|free.?text/i.test(column_name)
      )
    ).toEqual([]);
  });

  it("indexes only opted-in ready prescription metadata for emergency listing", async () => {
    const result = await pool.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = 'documents_emergency_visible_idx'`
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toContain("emergency_visible");
    expect(result.rows[0]?.indexdef).toContain("prescription");
    expect(result.rows[0]?.indexdef).toContain("ready");
  });
});
