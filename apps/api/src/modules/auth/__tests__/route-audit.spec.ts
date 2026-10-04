/**
 * route-audit.spec.ts
 * ===================
 * Build-failing test: every HTTP route handler must declare
 * @RequirePolicy() or @PublicRoute(). Missing either -> test fails.
 *
 * This test prevents silent bypass of the Cerbos deny-by-default guard.
 */

import { describe, it, expect } from "vitest";
import fg from "fast-glob";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import "reflect-metadata";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, "../../..");

// Decorator key constants (must match the decorator files exactly)
const PUBLIC_ROUTE_KEY = "PUBLIC_ROUTE";
const POLICY_KEY = "CERBOS_POLICY";

async function scanControllers(): Promise<string[]> {
  const pattern = "**/*.controller.ts";
  const files = await fg(pattern, {
    cwd: SRC_ROOT,
    absolute: true,
    ignore: ["**/node_modules/**", "**/__tests__/**"],
  });

  const violations: string[] = [];

  for (const file of files) {
    // Import the compiled module via tsx (running under vitest)
    let mod: Record<string, unknown>;
    try {
      mod = await import(file) as Record<string, unknown>;
    } catch {
      // Skip files that can't be imported in test environment
      continue;
    }

    for (const exportName of Object.keys(mod)) {
      const ControllerClass = mod[exportName];
      if (typeof ControllerClass !== "function") continue;

      // Check for NestJS @Controller metadata
      const routePrefix = Reflect.getMetadata("path", ControllerClass);
      if (routePrefix === undefined) continue;

      const prototype = (ControllerClass as { prototype: Record<string, unknown> }).prototype;
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;

        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;

        // Only check actual route handlers (those with HTTP method metadata)
        const httpMethod = Reflect.getMetadata("method", handler);
        if (httpMethod === undefined) continue;

        const isPublic = Reflect.getMetadata(PUBLIC_ROUTE_KEY, handler);
        const hasPolicy = Reflect.getMetadata(POLICY_KEY, handler);
        const classIsPublic = Reflect.getMetadata(PUBLIC_ROUTE_KEY, ControllerClass);
        const classHasPolicy = Reflect.getMetadata(POLICY_KEY, ControllerClass);

        if (!isPublic && !hasPolicy && !classIsPublic && !classHasPolicy) {
          violations.push(
            `${ControllerClass.name}.${methodName}() — missing @RequirePolicy() or @PublicRoute()`
          );
        }
      }
    }
  }

  return violations;
}

describe("Route Policy Audit (deny-by-default enforcement)", () => {
  it(
    "every route handler must declare @RequirePolicy() or @PublicRoute()",
    async () => {
      const violations = await scanControllers();

      if (violations.length > 0) {
        const lines = [
          "",
          "╔══════════════════════════════════════════════════════════════╗",
          "║     FAIL: Routes missing policy declaration detected!       ║",
          "╚══════════════════════════════════════════════════════════════╝",
          "The following handlers have neither @RequirePolicy() nor @PublicRoute():",
          "",
          ...violations.map((v) => `  ✗ ${v}`),
          "",
          "Fix: Add @RequirePolicy({ resource, action }) to each handler,",
          "     or @PublicRoute() if the route is intentionally unauthenticated.",
        ].join("\n");

        expect.fail(lines);
      }

      expect(violations).toHaveLength(0);
    },
    30000
  );
});
