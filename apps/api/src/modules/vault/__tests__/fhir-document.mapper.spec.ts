import { describe, expect, it } from "vitest";
import {
  FHIRDocumentReferenceResourceSchema,
  type FHIRDocumentReferenceResource,
} from "@mediqr/schemas";
import type { Document } from "../../../database/schema.js";
import { FhirDocumentMapper } from "../fhir/fhir-document.mapper.js";

const documentTypes = [
  ["scan", "11528-7"],
  ["lab", "11502-2"],
  ["prescription", "57833-6"],
  ["vaccination", "11369-6"],
  ["discharge", "18842-5"],
] as const;

describe("FhirDocumentMapper", () => {
  const mapper = new FhirDocumentMapper();

  it.each(documentTypes)(
    "maps %s documents to schema-valid FHIR DocumentReferences",
    (documentType, loincCode) => {
      const document = createDocument({ documentType });
      const { fhirId, resource } = mapper.map(document, "ab".repeat(32));

      expect(fhirId).toBe(`MediQR-${document.id}`);
      expect(FHIRDocumentReferenceResourceSchema.parse(resource)).toEqual(resource);
      expect(resource).toMatchObject({
        resourceType: "DocumentReference",
        status: "current",
        docStatus: "preliminary",
        type: {
          coding: [{ system: "http://loinc.org", code: loincCode }],
        },
        subject: { reference: `Patient/${document.patientId}` },
        content: [
          {
            attachment: {
              contentType: document.mimeType,
              size: document.fileSizeBytes,
              title: "encrypted-document",
            },
          },
        ],
      });
    }
  );

  it("maps a ready facility document to a final resource with a verified-source label", () => {
    const document = createDocument({
      uploadSource: "facility-verified",
      status: "ready",
    });
    const resource = mapper.map(document, "cd".repeat(32)).resource;

    expect(resource).toMatchObject({
      status: "current",
      docStatus: "final",
      securityLabel: [
        {
          coding: [
            {
              code: "UPLDFAC",
              display: "Facility Verified Upload",
            },
          ],
        },
      ],
      extension: [
        {
          valueString: "facility-verified",
        },
      ],
    });
  });

  it("maps rejected documents to entered-in-error", () => {
    const resource = mapper.map(
      createDocument({ status: "rejected" }),
      "ef".repeat(32)
    ).resource;

    expect(resource).toMatchObject({
      status: "entered-in-error",
      docStatus: "entered-in-error",
    });
    expect(FHIRDocumentReferenceResourceSchema.parse(resource)).toEqual(resource);
  });

  it("rejects invalid FHIR DocumentReference status and dates", () => {
    const resource = mapper.map(
      createDocument(),
      "01".repeat(32)
    ).resource as FHIRDocumentReferenceResource;

    expect(() =>
      FHIRDocumentReferenceResourceSchema.parse({
        ...resource,
        status: "infected",
      })
    ).toThrow();
    expect(() =>
      FHIRDocumentReferenceResourceSchema.parse({
        ...resource,
        date: "not-a-date",
      })
    ).toThrow();
  });
});

function createDocument(
  overrides: Partial<Document> = {}
): Document {
  const createdAt = new Date("2026-05-01T10:30:00.000Z");

  return {
    id: "00000000-0000-4000-8000-000000000001",
    patientId: "00000000-0000-4000-8000-000000000002",
    uploaderId: "00000000-0000-4000-8000-000000000003",
    uploadSource: "patient-uploaded",
    documentType: "lab",
    storageKey: "q/document-key",
    storageBucket: "quarantine",
    mimeType: "application/pdf",
    fileSizeBytes: 128,
    status: "quarantined",
    scanStatus: "pending",
    scanCompletedAt: null,
    scanThreatName: null,
    documentDate: null,
    facilityId: null,
    notes: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    ...overrides,
  };
}
