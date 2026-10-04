import { randomUUID } from "crypto";
import { z } from "zod";

const InputSchema = z.object({
  nodeEnv: z.literal("development"),
  keycloakUserId: z.string().uuid(),
  email: z
    .string()
    .email()
    .refine((email) => email.toLowerCase().endsWith("@mediqr.invalid")),
});

export interface DevClinicianUser {
  id: string;
  keycloakId: string | null;
  email: string | null;
  role: string;
  status: string;
}

export interface FakeClinicianProfile {
  userId: string;
  fullName: string;
  registrationNumber: string;
  stateMedicalCouncil: string;
  qualification: string;
  specialization: string;
  isVerified: false;
}

export interface DevClinicianProvisioningTransaction {
  findUserByKeycloakId(
    keycloakUserId: string,
  ): Promise<DevClinicianUser | null>;
  findUserByEmail(email: string): Promise<DevClinicianUser | null>;
  insertUser(input: {
    keycloakId: string;
    email: string;
    role: "clinician";
    status: "active";
  }): Promise<DevClinicianUser>;
  findClinicianByUserId(
    userId: string,
  ): Promise<{ isVerified: boolean } | null>;
  insertClinician(profile: FakeClinicianProfile): Promise<void>;
}

export interface DevClinicianProvisioningStore {
  transaction<T>(
    callback: (transaction: DevClinicianProvisioningTransaction) => Promise<T>,
  ): Promise<T>;
}

export async function provisionFakeDevelopmentClinician(
  input: {
    nodeEnv: string | undefined;
    keycloakUserId: string | undefined;
    email: string | undefined;
  },
  store: DevClinicianProvisioningStore,
): Promise<void> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      input.nodeEnv !== "development"
        ? "Clinician provisioning is available only in development."
        : "Provide a Keycloak user UUID and a fake email ending in @mediqr.invalid.",
    );
  }

  await store.transaction(async (transaction) => {
    const byKeycloakId = await transaction.findUserByKeycloakId(
      parsed.data.keycloakUserId,
    );
    const byEmail = await transaction.findUserByEmail(parsed.data.email);

    if (byKeycloakId && byEmail && byKeycloakId.id !== byEmail.id) {
      throw new Error(
        "The Keycloak identity and fake email are linked to different accounts.",
      );
    }

    const existingUser = byKeycloakId ?? byEmail;
    if (
      existingUser &&
      (existingUser.keycloakId !== parsed.data.keycloakUserId ||
        existingUser.email?.toLowerCase() !== parsed.data.email.toLowerCase() ||
        existingUser.role !== "clinician" ||
        existingUser.status !== "active")
    ) {
      throw new Error(
        "The existing account cannot be safely linked as a development clinician.",
      );
    }

    const user =
      existingUser ??
      (await transaction.insertUser({
        keycloakId: parsed.data.keycloakUserId,
        email: parsed.data.email,
        role: "clinician",
        status: "active",
      }));

    const existingClinician = await transaction.findClinicianByUserId(user.id);
    if (existingClinician?.isVerified) {
      throw new Error("Provisioning cannot modify a verified clinician.");
    }
    if (existingClinician) return;

    await transaction.insertClinician({
      userId: user.id,
      fullName: "FAKE DEVELOPMENT CLINICIAN",
      registrationNumber: `DEV-${randomUUID()}`,
      stateMedicalCouncil: "Development-only test council",
      qualification: "Development-only",
      specialization: "Development-only",
      isVerified: false,
    });
  });
}
