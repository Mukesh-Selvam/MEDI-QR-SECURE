import fastifyCookie from "@fastify/cookie";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { randomBytes, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../config/env.js";
import { db, pool } from "../../../database/index.js";
import { clinicians, users } from "../../../database/schema.js";
import { AuthModule } from "../auth.module.js";
import { PatientsModule } from "../../patients/patients.module.js";
import { EmergencyModule } from "../../emergency/emergency.module.js";
import { FacilitiesModule } from "../../facilities/facilities.module.js";

interface KeycloakUser {
  id: string;
  requiredActions?: string[];
}

interface KeycloakRole {
  id: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

interface KeycloakClient {
  id: string;
}

interface TokenResponse {
  access_token: string;
}

@Module({
  imports: [AuthModule, PatientsModule, EmergencyModule, FacilitiesModule],
})
class StaffOidcIntegrationModule {}

describe("Staff Keycloak token validation (integration)", () => {
  const keycloakBaseUrl = env.KEYCLOAK_BASE_URL;
  const realm = env.KEYCLOAK_REALM;
  const adminUsername = process.env.KEYCLOAK_ADMIN_USER ?? "admin";
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
  const suffix = randomUUID();
  const username = `fake-clinician-${suffix}`;
  const email = `${username}@mediqr.invalid`;
  const password = `A1!${randomBytes(32).toString("hex")}a`;
  const testClientId = `mediqr-oidc-test-${suffix}`;
  let adminToken: string | undefined;
  let staffAccessToken: string | undefined;
  let keycloakUserId: string | undefined;
  let keycloakClientId: string | undefined;
  let localUserId: string | undefined;
  let app: NestFastifyApplication | undefined;
  let fastify: FastifyInstance | undefined;

  beforeAll(async () => {
    if (!adminPassword) {
      throw new Error("KEYCLOAK_ADMIN_PASSWORD is required for this integration test.");
    }
    adminToken = await getAdminToken();
    await createTokenTestClient();
    keycloakUserId = await createKeycloakClinician();
    await seedLocalClinician();

    staffAccessToken = await getClinicianToken();
    app = await NestFactory.create<NestFastifyApplication>(
      StaffOidcIntegrationModule,
      new FastifyAdapter({ logger: false })
    );
    await app.register(fastifyCookie, { secret: env.SESSION_SECRET });
    app.setGlobalPrefix("api/v1");
    await app.init();
    fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();

  }, 90000);

  afterAll(async () => {
    await app?.close();
    if (localUserId) {
      await db.delete(clinicians).where(eq(clinicians.userId, localUserId));
      await db.delete(users).where(eq(users.id, localUserId));
    }
    if (adminToken && keycloakUserId) {
      await keycloakRequest(`/admin/realms/${realm}/users/${keycloakUserId}`, {
        method: "DELETE",
      });
    } else if (adminToken) {
      const search = await keycloakRequest(
        `/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`
      );
      if (search.ok) {
        const users = (await search.json()) as KeycloakUser[];
        const createdUserId = users[0]?.id;
        if (createdUserId) {
          await keycloakRequest(`/admin/realms/${realm}/users/${createdUserId}`, {
            method: "DELETE",
          });
        }
      }
    }
    if (adminToken && keycloakClientId) {
      await keycloakRequest(`/admin/realms/${realm}/clients/${keycloakClientId}`, {
        method: "DELETE",
      });
    } else if (adminToken) {
      const search = await keycloakRequest(
        `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(testClientId)}`
      );
      if (search.ok) {
        const clients = (await search.json()) as KeycloakClient[];
        const createdClientId = clients[0]?.id;
        if (createdClientId) {
          await keycloakRequest(`/admin/realms/${realm}/clients/${createdClientId}`, {
            method: "DELETE",
          });
        }
      }
    }
    await pool.end();
  });

  it("rejects a Keycloak password-only token without MFA evidence", async () => {
    if (!fastify || !staffAccessToken) {
      throw new Error("The fake clinician or Keycloak access token was not initialized.");
    }

    const facilityId = randomUUID();
    const affiliationId = randomUUID();
    const facilityAdminId = randomUUID();
    const documentId = randomUUID();
    const patientId = randomUUID();
    const requestId = randomUUID();
    const responses = await Promise.all([
      fastify.inject({
        method: "GET",
        url: `/api/v1/patients/${patientId}`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "GET",
        url: `/api/v1/patients/${patientId}/records`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "GET",
        url: `/api/v1/emergency/profiles/${patientId}`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "POST",
        url: `/api/v1/emergency-access/facilities/${facilityId}/requests`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: {
          resolutionId: randomUUID(),
          reasonCode: "GUARDIAN_UNAVAILABLE",
        },
      }),
      fastify.inject({
        method: "GET",
        url: `/api/v1/emergency-access/requests/${requestId}/summary`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "PATCH",
        url: `/api/v1/emergency-access/documents/${documentId}/visibility`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: { emergencyVisible: true },
      }),
      fastify.inject({
        method: "POST",
        url: "/api/v1/facilities",
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: {
          facilityType: "pharmacy",
          displayName: "FAKE MFA test facility",
          registrationNumber: `FAKE-${randomUUID()}`,
          registrationJurisdiction: "FAKE",
        },
      }),
      fastify.inject({
        method: "POST",
        url: `/api/v1/facilities/${facilityId}/administrators`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: { userId: facilityAdminId },
      }),
      fastify.inject({
        method: "PATCH",
        url: `/api/v1/facilities/${facilityId}/verification`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: { status: "verified" },
      }),
      fastify.inject({
        method: "POST",
        url: `/api/v1/facilities/${facilityId}/affiliations`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
        payload: { userId: randomUUID() },
      }),
      fastify.inject({
        method: "PATCH",
        url: `/api/v1/facilities/${facilityId}/affiliations/${affiliationId}/activate`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "PATCH",
        url: `/api/v1/facilities/${facilityId}/affiliations/${affiliationId}/suspend`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
      fastify.inject({
        method: "DELETE",
        url: `/api/v1/facilities/${facilityId}/affiliations/${affiliationId}`,
        headers: { cookie: `__Host-mediqr-access=${staffAccessToken}` },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual(
      Array.from({ length: 13 }, () => 401),
    );
    expect(localUserId).toBeDefined();
  });

  async function getAdminToken(): Promise<string> {
    const response = await fetch(
      `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "admin-cli",
          username: adminUsername,
          password: adminPassword!,
        }),
      }
    );
    if (!response.ok) {
      throw new Error("Could not authenticate the Keycloak integration-test administrator.");
    }
    return ((await response.json()) as TokenResponse).access_token;
  }

  async function createTokenTestClient(): Promise<void> {
    const response = await keycloakRequest(`/admin/realms/${realm}/clients`, {
      method: "POST",
      body: JSON.stringify({
        clientId: testClientId,
        enabled: true,
        protocol: "openid-connect",
        publicClient: true,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: true,
        serviceAccountsEnabled: false,
        protocolMappers: [
          {
            name: "MediQR API audience",
            protocol: "openid-connect",
            protocolMapper: "oidc-audience-mapper",
            config: {
              "included.client.audience": env.KEYCLOAK_CLIENT_ID,
              "access.token.claim": "true",
              "id.token.claim": "false",
            },
          },
        ],
      }),
    });
    expect(response.status).toBe(201);

    const search = await keycloakRequest(
      `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(testClientId)}`
    );
    expect(search.status).toBe(200);
    keycloakClientId = ((await search.json()) as KeycloakClient[])[0]?.id;
    if (!keycloakClientId) throw new Error("Keycloak did not create the test client.");
  }

  async function createKeycloakClinician(): Promise<string> {
    const createResponse = await keycloakRequest(`/admin/realms/${realm}/users`, {
      method: "POST",
      body: JSON.stringify({ username, email, enabled: true, emailVerified: true }),
    });
    expect(createResponse.status).toBe(201);

    const search = await keycloakRequest(
      `/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`
    );
    expect(search.status).toBe(200);
    const user = ((await search.json()) as KeycloakUser[])[0];
    if (!user?.id) throw new Error("Keycloak did not create the fake clinician.");
    keycloakUserId = user.id;

    const roleResponse = await keycloakRequest(
      `/admin/realms/${realm}/roles/platform-admin`
    );
    expect(roleResponse.status).toBe(200);
    const role = (await roleResponse.json()) as KeycloakRole;
    const mappingResponse = await keycloakRequest(
      `/admin/realms/${realm}/users/${user.id}/role-mappings/realm`,
      { method: "POST", body: JSON.stringify([role]) }
    );
    expect(mappingResponse.status).toBe(204);

    await keycloakRequest(`/admin/realms/${realm}/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...user, requiredActions: [] }),
    });
    const passwordResponse = await keycloakRequest(
      `/admin/realms/${realm}/users/${user.id}/reset-password`,
      {
        method: "PUT",
        body: JSON.stringify({
          type: "password",
          value: password,
          temporary: false,
        }),
      }
    );
    expect(passwordResponse.status).toBe(204);
    return user.id;
  }

  async function seedLocalClinician(): Promise<void> {
    const [user] = await db
      .insert(users)
      .values({
        keycloakId: keycloakUserId!,
        email,
        role: "clinician",
        status: "active",
      })
      .returning({ id: users.id });
    if (!user) throw new Error("Could not seed the fake clinician in the local database.");
    localUserId = user.id;

    await db.insert(clinicians).values({
      userId: user.id,
      fullName: "Fake Integration Clinician",
      registrationNumber: `TEST-${suffix}`,
      stateMedicalCouncil: "Integration Test Council",
      isVerified: false,
    });
  }

  async function getClinicianToken(): Promise<string> {
    const response = await fetch(
      `${keycloakBaseUrl}/realms/${realm}/protocol/openid-connect/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "password",
          client_id: testClientId,
          username,
          password,
        }),
      }
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as TokenResponse).access_token;
  }

  async function keycloakRequest(
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    if (!adminToken) throw new Error("Keycloak integration-test admin token is unavailable.");
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
