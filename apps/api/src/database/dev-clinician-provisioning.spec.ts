import { describe, expect, it, vi } from "vitest";
import {
  provisionFakeDevelopmentClinician,
  type DevClinicianProvisioningStore,
  type DevClinicianUser,
  type FakeClinicianProfile,
} from "./dev-clinician-provisioning.js";

const KEYCLOAK_USER_ID = "22222222-2222-4222-8222-222222222222";
const FAKE_EMAIL = "clinician.dev@mediqr.invalid";

describe("development clinician provisioning", () => {
  it.each(["test", "production", undefined])(
    "refuses to run when NODE_ENV is %s",
    async (nodeEnv) => {
      const store = createStore();

      await expect(
        provisionFakeDevelopmentClinician(
          { nodeEnv, keycloakUserId: KEYCLOAK_USER_ID, email: FAKE_EMAIL },
          store,
        ),
      ).rejects.toThrow("available only in development");
      expect(store.transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["non-UUID Keycloak ID", "not-a-uuid", FAKE_EMAIL],
    ["non-fake email", KEYCLOAK_USER_ID, "clinician@example.com"],
  ])("rejects %s", async (_description, keycloakUserId, email) => {
    const store = createStore();

    await expect(
      provisionFakeDevelopmentClinician(
        { nodeEnv: "development", keycloakUserId, email },
        store,
      ),
    ).rejects.toThrow("fake email");
    expect(store.transaction).not.toHaveBeenCalled();
  });

  it("links an active clinician user to a clearly fake, unverified profile", async () => {
    const store = createStore();

    await provisionFakeDevelopmentClinician(
      {
        nodeEnv: "development",
        keycloakUserId: KEYCLOAK_USER_ID,
        email: FAKE_EMAIL,
      },
      store,
    );

    expect(store.insertUser).toHaveBeenCalledWith({
      keycloakId: KEYCLOAK_USER_ID,
      email: FAKE_EMAIL,
      role: "clinician",
      status: "active",
    });
    expect(store.insertClinician).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-id",
        fullName: "FAKE DEVELOPMENT CLINICIAN",
        registrationNumber: expect.stringMatching(/^DEV-/),
        stateMedicalCouncil: "Development-only test council",
        isVerified: false,
      }),
    );
  });

  it("is idempotent for an already-linked unverified profile", async () => {
    const store = createStore({
      user: {
        id: "user-id",
        keycloakId: KEYCLOAK_USER_ID,
        email: FAKE_EMAIL,
        role: "clinician",
        status: "active",
      },
      clinician: { isVerified: false },
    });

    await provisionFakeDevelopmentClinician(
      {
        nodeEnv: "development",
        keycloakUserId: KEYCLOAK_USER_ID,
        email: FAKE_EMAIL,
      },
      store,
    );

    expect(store.insertUser).not.toHaveBeenCalled();
    expect(store.insertClinician).not.toHaveBeenCalled();
  });

  it("refuses to repurpose another account or a verified clinician", async () => {
    const patientStore = createStore({
      user: {
        id: "patient-user-id",
        keycloakId: KEYCLOAK_USER_ID,
        email: FAKE_EMAIL,
        role: "patient",
        status: "active",
      },
    });
    await expect(
      provisionFakeDevelopmentClinician(
        {
          nodeEnv: "development",
          keycloakUserId: KEYCLOAK_USER_ID,
          email: FAKE_EMAIL,
        },
        patientStore,
      ),
    ).rejects.toThrow("cannot be safely linked");

    const verifiedStore = createStore({
      user: {
        id: "user-id",
        keycloakId: KEYCLOAK_USER_ID,
        email: FAKE_EMAIL,
        role: "clinician",
        status: "active",
      },
      clinician: { isVerified: true },
    });
    await expect(
      provisionFakeDevelopmentClinician(
        {
          nodeEnv: "development",
          keycloakUserId: KEYCLOAK_USER_ID,
          email: FAKE_EMAIL,
        },
        verifiedStore,
      ),
    ).rejects.toThrow("cannot modify a verified clinician");
  });
});

function createStore(
  options: {
    user?: DevClinicianUser;
    clinician?: { isVerified: boolean };
  } = {},
) {
  const insertUser = vi.fn(async () => ({
    id: "user-id",
    keycloakId: KEYCLOAK_USER_ID,
    email: FAKE_EMAIL,
    role: "clinician",
    status: "active",
  }));
  const insertClinician = vi.fn(
    async (_profile: FakeClinicianProfile) => undefined,
  );
  const transaction = vi.fn(async (callback) =>
    callback({
      findUserByKeycloakId: vi.fn(async () => options.user ?? null),
      findUserByEmail: vi.fn(async () => options.user ?? null),
      insertUser,
      findClinicianByUserId: vi.fn(async () => options.clinician ?? null),
      insertClinician,
    }),
  );
  const store: DevClinicianProvisioningStore = { transaction };
  return Object.assign(store, {
    transaction,
    insertUser,
    insertClinician,
  });
}
