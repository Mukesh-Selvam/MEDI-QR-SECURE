import { describe, it, expect, beforeEach } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(() => {
    controller = new HealthController();
  });

  it("should return liveness status ok", () => {
    const result = controller.getLiveness();
    expect(result.status).toBe("ok");
    expect(result.version).toBe("0.1.0");
    expect(typeof result.uptimeSeconds).toBe("number");
    expect(result.timestamp).toBeDefined();
  });

  it("should return readiness status ready with dependency checks", () => {
    const result = controller.getReadiness();
    expect(result.status).toBe("ready");
    expect(result.checks.database).toBe("connected");
    expect(result.checks.redis).toBe("connected");
    expect(result.checks.storage).toBe("connected");
  });
});
