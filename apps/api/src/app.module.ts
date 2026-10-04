import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { PatientsModule } from "./modules/patients/patients.module.js";
import { FacilitiesModule } from "./modules/facilities/facilities.module.js";
import { CliniciansModule } from "./modules/clinicians/clinicians.module.js";
import { DocumentsModule } from "./modules/documents/documents.module.js";
import { ConsentModule } from "./modules/consent/consent.module.js";
import { AccessModule } from "./modules/access/access.module.js";
import { EmergencyModule } from "./modules/emergency/emergency.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { AdminModule } from "./modules/admin/admin.module.js";
import { VaultModule } from "./modules/vault/vault.module.js";

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    PatientsModule,
    FacilitiesModule,
    CliniciansModule,
    DocumentsModule,
    ConsentModule,
    AccessModule,
    EmergencyModule,
    AuditModule,
    NotificationsModule,
    AdminModule,
    VaultModule,
  ],
})
export class AppModule {}
