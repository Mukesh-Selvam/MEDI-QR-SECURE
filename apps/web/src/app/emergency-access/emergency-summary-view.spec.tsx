import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EmergencySummaryView,
  emergencySummarySchema,
} from "./emergency-summary-view";

describe("EmergencySummaryView", () => {
  it("renders pharmacy summaries as allergies only", () => {
    const summary = emergencySummarySchema.parse({
      requestId: "00000000-0000-4000-8000-000000000001",
      expiresAt: "2026-10-05T10:00:00.000Z",
      allergies: ["FAKE patient-declared allergy"],
    });
    const markup = renderToStaticMarkup(
      createElement(EmergencySummaryView, { summary }),
    );

    expect(markup).toContain("Allergies");
    expect(markup).toContain("FAKE patient-declared allergy");
    expect(markup).not.toContain("Blood group");
    expect(markup).not.toContain("Emergency contacts");
    expect(markup).not.toContain("Visible prescriptions");
    expect(markup).not.toContain("href=");
  });

  it("rejects pharmacy responses containing out-of-scope medical fields", () => {
    expect(() =>
      emergencySummarySchema.parse({
        requestId: "00000000-0000-4000-8000-000000000001",
        expiresAt: "2026-10-05T10:00:00.000Z",
        allergies: [],
        bloodGroup: "O+",
      }),
    ).toThrow();
  });

  it("shows hospital prescription type and date without document details", () => {
    const summary = emergencySummarySchema.parse({
      requestId: "00000000-0000-4000-8000-000000000001",
      expiresAt: "2026-10-05T10:00:00.000Z",
      allergies: [],
      bloodGroup: "unknown",
      emergencyContacts: [],
      prescriptions: [{ type: "prescription", date: "2026-10-01" }],
    });
    const markup = renderToStaticMarkup(
      createElement(EmergencySummaryView, { summary }),
    );

    expect(markup).toContain("prescription — 2026-10-01");
    expect(markup).not.toContain("documentId");
    expect(markup).not.toContain("filename");
    expect(markup).not.toContain("href=");
  });
});
