import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface KeycloakUser {
  id: string;
  requiredActions?: string[];
}

interface KeycloakRole {
  id: string;
  name: string;
}

describe("Keycloak staff MFA (integration)", () => {
  const keycloakBaseUrl =
    process.env.KEYCLOAK_BASE_URL ?? "http://127.0.0.1:8080";
  const adminUsername = process.env.KEYCLOAK_ADMIN_USER ?? "admin";
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const realm = process.env.KEYCLOAK_REALM ?? "mediqr";
  const username = `fake-clinician-${randomUUID()}`;
  let adminToken: string | undefined;
  let userId: string | undefined;

  beforeAll(async () => {
    if (!adminPassword) {
      throw new Error("KEYCLOAK_ADMIN_PASSWORD is required for this integration test.");
    }

    const tokenResponse = await fetch(
      `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: adminUsername,
          password: adminPassword,
        }),
      }
    );
    expect(tokenResponse.status).toBe(200);
    adminToken = (await tokenResponse.json() as { access_token: string }).access_token;
  }, 30000);

  afterAll(async () => {
    if (adminToken && userId) {
      await keycloakRequest(`/admin/realms/${realm}/users/${userId}`, {
        method: "DELETE",
      });
    }
  });

  it("requires TOTP enrollment for newly provisioned clinician accounts", async () => {
    const createResponse = await keycloakRequest(`/admin/realms/${realm}/users`, {
      method: "POST",
      body: JSON.stringify({ username, enabled: true }),
    });
    expect(createResponse.status).toBe(201);

    const searchResponse = await keycloakRequest(
      `/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`
    );
    expect(searchResponse.status).toBe(200);
    const users = (await searchResponse.json()) as KeycloakUser[];
    expect(users).toHaveLength(1);
    userId = users[0]?.id;
    if (!userId) throw new Error("Keycloak did not return the seeded user ID.");

    const roleResponse = await keycloakRequest(
      `/admin/realms/${realm}/roles/clinician`
    );
    expect(roleResponse.status).toBe(200);
    const role = (await roleResponse.json()) as KeycloakRole;
    const mappingResponse = await keycloakRequest(
      `/admin/realms/${realm}/users/${userId}/role-mappings/realm`,
      {
        method: "POST",
        body: JSON.stringify([role]),
      }
    );
    expect(mappingResponse.status).toBe(204);

    const userResponse = await keycloakRequest(
      `/admin/realms/${realm}/users/${userId}`
    );
    expect(userResponse.status).toBe(200);
    const user = (await userResponse.json()) as KeycloakUser;
    expect(user.requiredActions).toContain("CONFIGURE_TOTP");
  }, 30000);

  async function keycloakRequest(
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (!adminToken) throw new Error("Keycloak admin authentication is unavailable.");
    return fetch(`${keycloakBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }
});
