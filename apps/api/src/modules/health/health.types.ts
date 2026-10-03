/**
 * MediQR Health Check Infrastructure
 *
 * Each check must perform a REAL network call within a strict timeout.
 * Returning "connected" without making a call is a hard violation.
 *
 * Rules:
 *  - Every check races its real I/O against a 2-second AbortSignal.
 *  - Timeout or error → {status: "error", detail: <message>}
 *  - Success         → {status: "ok", latencyMs: <number>}
 *  - /health/ready returns HTTP 200 only when all 4 checks are "ok".
 *  - /health/ready returns HTTP 503 + body listing failing checks otherwise.
 */

export type CheckStatus = "ok" | "error";

export interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

export interface ReadinessResult {
  status: "ready" | "degraded";
  timestamp: string;
  durationMs: number;
  checks: {
    database: CheckResult;
    redis: CheckResult;
    storage: CheckResult;
    scanner: CheckResult;
  };
  /** Names of failing checks when degraded */
  failing?: string[];
}

export const HEALTH_CHECK_TIMEOUT_MS = 2000;
