/**
 * FhirDocumentMapper
 * ==================
 * Transforms internal Document records to valid HL7 FHIR R4 DocumentReference resources.
 *
 * LOINC code mapping (https://loinc.org):
 *   scan         → 11528-7  (Radiology Study observation)
 *   lab          → 11502-2  (Laboratory report)
 *   prescription → 57833-6  (Prescription for medication)
 *   vaccination  → 11369-6  (History of Immunization)
 *   discharge    → 18842-5  (Discharge summary)
 *
 * Source label is propagated to the FHIR resource via:
 *   - `securityLabel` (V3 Act Code): `UPLDFAC` (facility-verified) | `UPLDSUB` (patient-uploaded)
 *   - `extension[x-mediqr-upload-source]`: "facility-verified" | "patient-uploaded"
 *
 * Zero-leak: patient identifiers are always opaque UUID references, never health IDs,
 * names, or phone numbers.
 */

import { Injectable } from "@nestjs/common";
import { FHIRDocumentReferenceResourceSchema } from "@mediqr/schemas";
import type { Document } from "../../../database/schema.js";
import type { FHIRDocumentReferenceResource } from "@mediqr/schemas";

type DocumentType = "scan" | "lab" | "prescription" | "vaccination" | "discharge";
type UploadSource = "patient-uploaded" | "facility-verified";

interface FhirCoding {
  system: string;
  code: string;
  display: string;
}

const LOINC_MAP: Record<DocumentType, FhirCoding> = {
  scan: { system: "http://loinc.org", code: "11528-7", display: "Radiology study observation" },
  lab: { system: "http://loinc.org", code: "11502-2", display: "Laboratory report" },
  prescription: { system: "http://loinc.org", code: "57833-6", display: "Prescription for medication" },
  vaccination: { system: "http://loinc.org", code: "11369-6", display: "History of Immunization" },
  discharge: { system: "http://loinc.org", code: "18842-5", display: "Discharge summary" },
};

const SOURCE_SECURITY_LABEL: Record<UploadSource, FhirCoding> = {
  "facility-verified": {
    system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    code: "UPLDFAC",
    display: "Facility Verified Upload",
  },
  "patient-uploaded": {
    system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    code: "UPLDSUB",
    display: "Patient Self-Upload",
  },
};

@Injectable()
export class FhirDocumentMapper {
  /**
   * Map a Document record to an HL7 FHIR R4 DocumentReference resource.
   * @param doc           - The internal Document record
   * @param sha256Hex     - SHA-256 hex of plaintext file (from document_crypto_keys)
   * @returns             FHIR R4 DocumentReference object + fhirId to store in DB
   */
  map(
    doc: Document,
    sha256Hex: string
  ): { fhirId: string; resource: FHIRDocumentReferenceResource } {
    const fhirId = `MediQR-${doc.id}`;
    const loincCode = LOINC_MAP[doc.documentType as DocumentType];
    const securityLabel = SOURCE_SECURITY_LABEL[doc.uploadSource as UploadSource];

    const resource = FHIRDocumentReferenceResourceSchema.parse({
      resourceType: "DocumentReference",
      id: fhirId,
      meta: {
        profile: ["http://hl7.org/fhir/StructureDefinition/DocumentReference"],
      },
      extension: [
        {
          url: "https://mediqr.health/fhir/StructureDefinition/upload-source",
          valueString: doc.uploadSource,
        },
      ],
      status:
        doc.status === "deleted"
          ? "superseded"
          : doc.status === "rejected"
            ? "entered-in-error"
            : "current",
      docStatus:
        doc.status === "ready"
          ? "final"
          : doc.status === "rejected"
            ? "entered-in-error"
            : "preliminary",
      type: {
        coding: [loincCode],
        text: loincCode.display,
      },
      subject: {
        // Opaque UUID reference — never health ID, name, or phone
        reference: `Patient/${doc.patientId}`,
      },
      date: (doc.documentDate ?? doc.createdAt).toISOString(),
      author: [
        {
          reference: `Practitioner/${doc.uploaderId}`,
        },
      ],
      content: [
        {
          attachment: {
            contentType: doc.mimeType,
            size: doc.fileSizeBytes,
            // Base64 of SHA-256 bytes (FHIR spec: attachment.hash is Base64-encoded SHA-1 or SHA-256)
            hash: Buffer.from(sha256Hex, "hex").toString("base64"),
            title: "encrypted-document",
            creation: doc.createdAt.toISOString(),
          },
        },
      ],
      securityLabel: [
        {
          coding: [securityLabel],
        },
      ],
    });

    return { fhirId, resource };
  }
}
