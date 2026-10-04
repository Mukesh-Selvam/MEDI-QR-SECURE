import { NextRequest, NextResponse } from "next/server";
import { apiOrigin, apiJsonError } from "@/lib/staff-auth";
import { STAFF_ACCESS_COOKIE } from "@/lib/staff-oidc";

export const dynamic = "force-dynamic";

interface ApiUser {
  role?: unknown;
  isVerified?: unknown;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(STAFF_ACCESS_COOKIE)?.value;
  if (!accessToken) return apiJsonError(401, "Staff session is not active.");

  try {
    const response = await fetch(`${apiOrigin()}/api/v1/auth/me`, {
      headers: { cookie: `${STAFF_ACCESS_COOKIE}=${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return apiJsonError(response.status, "Staff session is not active.");
    const user: unknown = await response.json();
    if (!isApiUser(user)) return apiJsonError(502, "Could not load staff session.");
    return NextResponse.json({
      role: user.role,
      isVerified: user.isVerified === true,
    });
  } catch {
    return apiJsonError(502, "Could not load staff session.");
  }
}

function isApiUser(value: unknown): value is ApiUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string"
  );
}
