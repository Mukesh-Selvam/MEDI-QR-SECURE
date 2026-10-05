import { z } from "zod";

const summaryBase = {
  requestId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
  allergies: z.array(z.string()),
};

export const emergencySummarySchema = z.union([
  z
    .object({
      ...summaryBase,
      bloodGroup: z.string(),
      emergencyContacts: z.array(
        z
          .object({
            name: z.string(),
            relationship: z.string(),
            phone: z.string(),
          })
          .strict(),
      ),
      prescriptions: z.array(
        z
          .object({
            type: z.literal("prescription"),
            date: z.string().date().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      ...summaryBase,
    })
    .strict(),
]);

export type EmergencySummary = z.infer<typeof emergencySummarySchema>;

export function EmergencySummaryView({
  summary,
}: {
  summary: EmergencySummary;
}) {
  const isHospitalSummary = "bloodGroup" in summary;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 text-[#2B2230]">
      <h1 className="font-serif text-3xl font-semibold">Emergency summary</h1>
      <p className="mt-3 leading-7">
        Patient-declared information only. This summary does not interpret
        records or provide medical advice.
      </p>
      <p className="mt-2 text-sm">
        Access ends at {new Date(summary.expiresAt).toLocaleString("en-IN")}.
      </p>

      <section
        className="mt-8 space-y-6"
        aria-label="Emergency summary details"
      >
        {isHospitalSummary && (
          <section>
            <h2 className="font-semibold">Blood group</h2>
            <p>{summary.bloodGroup || "Not provided"}</p>
          </section>
        )}

        <section>
          <h2 className="font-semibold">Allergies</h2>
          {summary.allergies.length > 0 ? (
            <ul className="list-disc pl-6">
              {summary.allergies.map((allergy, index) => (
                <li key={`${index}-${allergy}`}>{allergy}</li>
              ))}
            </ul>
          ) : (
            <p>None listed.</p>
          )}
        </section>

        {isHospitalSummary && (
          <>
            <section>
              <h2 className="font-semibold">Emergency contacts</h2>
              {summary.emergencyContacts.length > 0 ? (
                <ul className="space-y-2">
                  {summary.emergencyContacts.map((contact, index) => (
                    <li key={`${index}-${contact.phone}`}>
                      {contact.name} ({contact.relationship}) — {contact.phone}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None listed.</p>
              )}
            </section>
            <section>
              <h2 className="font-semibold">Visible prescriptions</h2>
              {summary.prescriptions.length > 0 ? (
                <ul className="list-disc pl-6">
                  {summary.prescriptions.map((prescription, index) => (
                    <li key={`${index}-${prescription.date ?? "undated"}`}>
                      {prescription.type}
                      {prescription.date ? ` — ${prescription.date}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>None marked visible.</p>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
