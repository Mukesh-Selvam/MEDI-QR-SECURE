import "../../config/env.js";
import { AuditChainVerifier } from "./audit-chain-verifier.js";
import { pool } from "../../database/index.js";

const verifier = new AuditChainVerifier();

try {
  const result = await verifier.verify();
  if (!result.valid) {
    process.stderr.write(
      `Audit chain verification failed at event index ${result.eventIndex ?? "unknown"} (${result.reason ?? "unknown"}).\n`
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Audit chain verified: ${result.eventCount} events.\n`);
  }
} catch {
  process.stderr.write("Audit chain verification could not complete.\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
