/**
 * @PublicRoute() — marks a handler as authentication-exempt.
 * The JwtAuthGuard skips verification for these routes.
 */
import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "PUBLIC_ROUTE";
export const PublicRoute = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
