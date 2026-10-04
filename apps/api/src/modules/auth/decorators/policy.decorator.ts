/**
 * @RequirePolicy({ resource, action }) — declares the Cerbos policy check for
 * a route handler. PolicyGuard enforces this at request time.
 * Routes without @RequirePolicy or @PublicRoute fail the route-audit test.
 */
import { SetMetadata } from "@nestjs/common";

export const POLICY_KEY = "CERBOS_POLICY";

export interface PolicyMetadata {
  resource: string;
  action: string;
}

export const RequirePolicy = (meta: PolicyMetadata) =>
  SetMetadata(POLICY_KEY, meta);
