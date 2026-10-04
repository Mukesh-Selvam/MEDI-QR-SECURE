import { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db, pool } from "./index.js";
import { clinicians, users } from "./schema.js";
import {
  provisionFakeDevelopmentClinician,
  type DevClinicianProvisioningStore,
} from "./dev-clinician-provisioning.js";

const logger = new Logger("DevClinicianProvisioning");

const store: DevClinicianProvisioningStore = {
  transaction: (callback) =>
    db.transaction((transaction) =>
      callback({
        findUserByKeycloakId: async (keycloakUserId) => {
          const [user] = await transaction
            .select({
              id: users.id,
              keycloakId: users.keycloakId,
              email: users.email,
              role: users.role,
              status: users.status,
            })
            .from(users)
            .where(eq(users.keycloakId, keycloakUserId))
            .limit(1);
          return user ?? null;
        },
        findUserByEmail: async (email) => {
          const [user] = await transaction
            .select({
              id: users.id,
              keycloakId: users.keycloakId,
              email: users.email,
              role: users.role,
              status: users.status,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);
          return user ?? null;
        },
        insertUser: async (input) => {
          const [user] = await transaction
            .insert(users)
            .values(input)
            .returning({
              id: users.id,
              keycloakId: users.keycloakId,
              email: users.email,
              role: users.role,
              status: users.status,
            });
          if (!user)
            throw new Error(
              "Unable to create the development clinician account.",
            );
          return user;
        },
        findClinicianByUserId: async (userId) => {
          const [clinician] = await transaction
            .select({ isVerified: clinicians.isVerified })
            .from(clinicians)
            .where(eq(clinicians.userId, userId))
            .limit(1);
          return clinician ?? null;
        },
        insertClinician: async (profile) => {
          await transaction.insert(clinicians).values(profile);
        },
      }),
    ),
};

async function provision(): Promise<void> {
  await provisionFakeDevelopmentClinician(
    {
      nodeEnv: env.NODE_ENV,
      keycloakUserId: process.env.DEV_CLINICIAN_KEYCLOAK_ID,
      email: process.env.DEV_CLINICIAN_EMAIL,
    },
    store,
  );
  logger.log("Fake clinician profile linked. Verification remains pending.");
}

provision()
  .catch(() => {
    logger.error(
      "Development clinician provisioning failed. Check the fake account details and database connectivity.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
