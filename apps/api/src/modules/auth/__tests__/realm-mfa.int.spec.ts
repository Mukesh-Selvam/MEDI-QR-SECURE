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

interface AuthenticationFlow {
  id: string;
  alias: string;
}

interface AuthenticationExecution {
  authenticationFlow?: boolean;
  displayName?: string;
  providerId?: string;
  requirement: string;
}

interface KeycloakClient {
  id: string;
}

interface KeycloakRealm {
  browserFlow: string;
}

interface ProtocolMapper {
  protocolMapper: string;
  config: Record<string, string>;
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

  it("requires an existing TOTP or WebAuthn credential for browser authentication", async () => {
    const realmResponse = await keycloakRequest(`/admin/realms/${realm}`);
    expect(realmResponse.status).toBe(200);
    const realmConfiguration = (await realmResponse.json()) as KeycloakRealm;
    expect(realmConfiguration.browserFlow).toBe("mediqr-browser-mfa");

    const flowsResponse = await keycloakRequest(
      `/admin/realms/${realm}/authentication/flows`
    );
    expect(flowsResponse.status).toBe(200);
    const flows = (await flowsResponse.json()) as AuthenticationFlow[];
    expect(flows.map((flow) => flow.alias)).toContain("mediqr-browser-mfa");

    const formsResponse = await keycloakRequest(
      `/admin/realms/${realm}/authentication/flows/mediqr-browser-forms/executions`
    );
    expect(formsResponse.status).toBe(200);
    const forms = (await formsResponse.json()) as AuthenticationExecution[];
    expect(forms).toContainEqual(
      expect.objectContaining({
        displayName: "mediqr-mfa",
        authenticationFlow: true,
        requirement: "REQUIRED",
      })
    );

    const mfaResponse = await keycloakRequest(
      `/admin/realms/${realm}/authentication/flows/mediqr-mfa/executions`
    );
    expect(mfaResponse.status).toBe(200);
    const mfaExecutions =
      (await mfaResponse.json()) as AuthenticationExecution[];
    expect(mfaExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "auth-otp-form",
          requirement: "ALTERNATIVE",
        }),
        expect.objectContaining({
          providerId: "webauthn-authenticator",
          requirement: "ALTERNATIVE",
        }),
      ])
    );
  }, 30000);

  it("includes Keycloak completed authentication methods in access tokens", async () => {
    const clientsResponse = await keycloakRequest(
      `/admin/realms/${realm}/clients?clientId=mediqr-web`
    );
    expect(clientsResponse.status).toBe(200);
    const clients = (await clientsResponse.json()) as KeycloakClient[];
    const clientId = clients[0]?.id;
    if (!clientId) throw new Error("Keycloak web client was not imported.");

    const mappersResponse = await keycloakRequest(
      `/admin/realms/${realm}/clients/${clientId}/protocol-mappers/models`
    );
    expect(mappersResponse.status).toBe(200);
    const mappers = (await mappersResponse.json()) as ProtocolMapper[];
    expect(mappers).toContainEqual(
      expect.objectContaining({
        protocolMapper: "oidc-amr-mapper",
        config: expect.objectContaining({
          "access.token.claim": "true",
          "id.token.claim": "false",
        }),
      })
    );
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
