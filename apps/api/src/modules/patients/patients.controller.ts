import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";

@ApiTags("Patients")
@Controller("patients")
export class PatientsController {
  @RequirePolicy({ resource: "patient", action: "read" })
  @Get(":id")
  @ApiOperation({ summary: "Get patient details (protected by Cerbos PDP)" })
  getPatientById(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      id,
      name: "Encrypted Patient Record",
      healthId: "ABHA-1234-5678-9012",
      requestedBy: user.id,
      role: user.role,
    };
  }

  @RequirePolicy({ resource: "document", action: "read" })
  @Get(":id/records")
  @ApiOperation({ summary: "Get patient documents (protected by Cerbos PDP)" })
  getPatientRecords(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      patientId: id,
      records: [
        {
          id: "doc-1",
          type: "immunization_record",
          title: "Maternal Health Immunization Log",
        },
      ],
      requestedBy: user.id,
    };
  }
}
