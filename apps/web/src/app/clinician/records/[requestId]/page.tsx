"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { z } from "zod";
import { SecureDocumentViewer } from "./secure-document-viewer";

const accessStatusSchema = z.object({
  status: z.enum([
    "pending",
    "denied",
    "cancelled",
    "revoked",
    "expired",
    "active",
  ]),
  scope: z.array(z.string()).optional(),
  purpose: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

const documentSchema = z.object({
  id: z.string().uuid(),
  documentType: z.enum(["scan", "lab", "prescription", "vaccination", "discharge"]),
  sourceLabel: z.enum(["verified-source", "patient-uploaded"]),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  documentDate: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const timelineSchema = z.object({
  groups: z.array(z.object({
    type: z.enum(["scan", "lab", "prescription", "vaccination", "discharge"]),
    documents: z.array(documentSchema),
  })),
  consent: z.object({
    scope: z.array(z.string()),
    purpose: z.string(),
    expiresAt: z.string().datetime(),
  }),
});

type ConsoleState = "loading" | "waiting" | "active" | "locked" | "auth" | "error";
type TimelineDocument = z.infer<typeof documentSchema>;

interface StaffSession {
  role: string;
  isVerified: boolean;
}

const scopeLabels: Record<string, string> = {
  timeline: "Record timeline",
  "document:scan": "Scans",
  "document:lab": "Laboratory records",
  "document:prescription": "Prescriptions",
  "document:vaccination": "Vaccinations",
  "document:discharge": "Discharge summaries",
};

const documentLabels: Record<TimelineDocument["documentType"], string> = {
  scan: "Scans",
  lab: "Laboratory records",
  prescription: "Prescriptions",
  vaccination: "Vaccinations",
  discharge: "Discharge summaries",
};

export default function ClinicianRecordsPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [session, setSession] = useState<StaffSession | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [state, setState] = useState<ConsoleState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<z.infer<typeof timelineSchema> | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<TimelineDocument | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let mounted = true;
    void fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          if (mounted) setSession(null);
          return;
        }
        const value: unknown = await response.json();
        if (isStaffSession(value) && mounted) setSession(value);
        else if (mounted) setMessage("Your staff session could not be confirmed.");
      })
      .catch(() => {
        if (mounted) setMessage("Your staff session could not be confirmed.");
      })
      .finally(() => {
        if (mounted) setSessionLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session || session.role !== "clinician" || !session.isVerified) return;
    let stopped = false;
    let checking = false;

    const refresh = async () => {
      if (checking || stopped) return;
      checking = true;
      try {
        const statusResponse = await fetch(
          `/api/v1/access/requests/${requestId}/status`,
          { cache: "no-store", credentials: "same-origin" }
        );
        if (stopped) return;
        if (statusResponse.status === 401) {
          setState("auth");
          setTimeline(null);
          setSelectedDocument(null);
          return;
        }
        if (!statusResponse.ok) {
          throw new Error("The access status could not be checked.");
        }
        const statusValue = accessStatusSchema.safeParse(await statusResponse.json());
        if (!statusValue.success) {
          throw new Error("The access status response was invalid.");
        }
        const current = statusValue.data;
        if (current.status === "pending") {
          setState("waiting");
          setMessage(null);
          return;
        }
        if (current.status !== "active") {
          setState("locked");
          setTimeline(null);
          setSelectedDocument(null);
          setMessage(statusMessage(current.status));
          return;
        }

        const timelineResponse = await fetch(
          `/api/v1/vault/requests/${requestId}/timeline`,
          { cache: "no-store", credentials: "same-origin" }
        );
        if (stopped) return;
        if (timelineResponse.status === 401) {
          setState("auth");
          setTimeline(null);
          setSelectedDocument(null);
          return;
        }
        if (timelineResponse.status === 403) {
          setState("locked");
          setTimeline(null);
          setSelectedDocument(null);
          setMessage("Consent has ended. Records are locked.");
          return;
        }
        if (!timelineResponse.ok) {
          throw new Error("The record timeline could not be loaded.");
        }
        const timelineValue = timelineSchema.safeParse(await timelineResponse.json());
        if (!timelineValue.success) {
          throw new Error("The record timeline response was invalid.");
        }
        setTimeline(timelineValue.data);
        setMessage(null);
        setState("active");
      } catch (error) {
        if (!stopped) {
          setMessage(error instanceof Error ? error.message : "The records could not be loaded.");
          setState("error");
        }
      } finally {
        checking = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [requestId, session]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remaining = useMemo(() => {
    if (!timeline) return null;
    return Math.max(0, Date.parse(timeline.consent.expiresAt) - now);
  }, [now, timeline]);

  useEffect(() => {
    if (remaining !== null && remaining <= 0) {
      setState("locked");
      setTimeline(null);
      setSelectedDocument(null);
      setMessage("Consent has expired. Records are locked.");
    }
  }, [remaining]);

  if (sessionLoading) {
    return <ConsoleShell><p role="status">Checking your access…</p></ConsoleShell>;
  }
  if (!session) {
    return (
      <ConsoleShell>
        <h1 className="font-serif text-2xl font-bold">Clinician sign-in required</h1>
        <p className="mt-3 text-sm">Sign in through the staff identity provider to continue.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[#4A1D3F] px-5 text-white" href="/login/clinician">
          Continue to staff sign-in
        </Link>
      </ConsoleShell>
    );
  }
  if (session.role !== "clinician") {
    return <ConsoleShell><h1 className="font-serif text-2xl font-bold">Clinician access required</h1></ConsoleShell>;
  }
  if (!session.isVerified) {
    return (
      <ConsoleShell>
        <h1 className="font-serif text-2xl font-bold">Pending verification</h1>
        <p className="mt-3 text-sm">Patient records remain unavailable until your credentials are verified.</p>
      </ConsoleShell>
    );
  }
  if (state === "loading") {
    return <ConsoleShell><p role="status">Checking your access…</p></ConsoleShell>;
  }

  return (
    <ConsoleShell>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#E5D8E1] pb-5 dark:border-[#493A4A]">
        <div>
          <p className="text-sm font-semibold text-[#6B5A72] dark:text-[#C8B8C7]">Clinician records</p>
          <h1 className="mt-1 font-serif text-2xl font-bold">Consent-scoped record view</h1>
        </div>
        <Link href="/request-access" className="inline-flex min-h-11 items-center rounded-lg border border-[#BBA5B4] px-4 text-sm font-semibold">
          Request access
        </Link>
      </header>

      {state === "waiting" && (
        <p role="status" className="mt-6 rounded-xl border border-[#E5D8E1] bg-[#FFFDFC] p-5 text-sm dark:border-[#493A4A] dark:bg-[#322936]">
          Waiting for the patient to approve this request. This page checks for a decision automatically.
        </p>
      )}
      {state === "locked" && (
        <p role="alert" className="mt-6 rounded-xl border border-[#E5D8E1] bg-[#FFFDFC] p-5 text-sm dark:border-[#493A4A] dark:bg-[#322936]">
          {message ?? "Consent is not active. Records are locked."}
        </p>
      )}
      {state === "auth" && (
        <p role="alert" className="mt-6 rounded-xl border border-[#E5D8E1] bg-[#FFFDFC] p-5 text-sm">
          Your staff session has ended. <Link className="underline" href="/login/clinician">Sign in again</Link> to continue.
        </p>
      )}
      {state === "error" && (
        <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-5 text-sm text-red-900" role="alert">
          <p>{message}</p>
          <button type="button" onClick={() => setState("loading")} className="mt-3 min-h-11 rounded-lg border border-red-500 px-4 font-semibold">
            Retry
          </button>
        </div>
      )}

      {state === "active" && timeline && remaining !== null && remaining > 0 && (
        <section aria-label="Active consent" className="mt-6 rounded-xl border border-[#D8B9AD] bg-[#FBEAE6] p-5 text-[#2B2230] dark:border-[#74505F] dark:bg-[#322936] dark:text-[#F8EAF2]">
          <h2 className="font-semibold">Access is active</h2>
          <p className="mt-2 text-sm">
            Purpose: {purposeLabel(timeline.consent.purpose)}.
            {" "}Time remaining: {formatRemaining(remaining)}.
          </p>
          <p className="mt-2 text-sm">
            Scope: {timeline.consent.scope.map((scope) => scopeLabels[scope] ?? "Approved records").join(", ")}.
          </p>
        </section>
      )}

      {state === "active" && timeline && (
        <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
          <section aria-label="Record timeline">
            <h2 className="font-serif text-xl font-bold">Records by type</h2>
            {timeline.groups.length === 0 ? (
              <p className="mt-4 rounded-lg border border-[#E5D8E1] p-4 text-sm">No records are available in this approved scope.</p>
            ) : (
              <div className="mt-4 space-y-6">
                {timeline.groups.map((group) => (
                  <section key={group.type}>
                    <h3 className="mb-2 text-sm font-semibold">{documentLabels[group.type]}</h3>
                    <ul className="divide-y divide-[#E5D8E1] dark:divide-[#493A4A]">
                      {group.documents.map((document) => (
                        <li key={document.id} className="py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedDocument(document)}
                            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-sm hover:bg-[#FBEAE6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E8735A] dark:hover:bg-[#322936]"
                          >
                            <span>
                              <span className="block font-semibold">
                                {document.documentDate
                                  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(document.documentDate))
                                  : "Record"}
                              </span>
                              <span className="mt-1 block text-xs text-[#6B5A72] dark:text-[#C8B8C7]">
                                {document.sourceLabel === "verified-source" ? "Verified source" : "Patient uploaded"}
                              </span>
                            </span>
                            <span className="text-[#4A1D3F] dark:text-[#F2A08D]">Open</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Selected record">
            <h2 className="font-serif text-xl font-bold">
              {selectedDocument ? documentLabels[selectedDocument.documentType] : "Secure viewer"}
            </h2>
            {selectedDocument ? (
              <div className="mt-4">
                <p className="mb-3 text-sm text-[#6B5A72] dark:text-[#C8B8C7]">
                  Read-only. This view is locked automatically if consent ends.
                </p>
                <SecureDocumentViewer
                  key={selectedDocument.id}
                  documentId={selectedDocument.id}
                  mimeType={selectedDocument.mimeType}
                />
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-dashed border-[#BBA5B4] p-6 text-sm text-[#6B5A72] dark:text-[#C8B8C7]">
                Select a record to open its read-only view.
              </p>
            )}
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}

function ConsoleShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#FDF8F6] px-4 py-8 text-[#2B2230] dark:bg-[#211923] dark:text-[#F8EAF2] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-2xl border border-[#E5D8E1] bg-white p-5 dark:border-[#493A4A] dark:bg-[#2B2230] sm:p-8">
        {children}
      </div>
    </main>
  );
}

function isStaffSession(value: unknown): value is StaffSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    typeof value.role === "string" &&
    "isVerified" in value &&
    typeof value.isVerified === "boolean"
  );
}

function statusMessage(status: z.infer<typeof accessStatusSchema>["status"]): string {
  switch (status) {
    case "denied":
      return "The patient declined this request. Records are locked.";
    case "revoked":
      return "Consent has been revoked. Records are locked.";
    case "expired":
      return "Consent has expired. Records are locked.";
    case "cancelled":
      return "This request was cancelled. Records are locked.";
    default:
      return "Consent is not active. Records are locked.";
  }
}

function purposeLabel(value: string): string {
  const labels: Record<string, string> = {
    "clinical-care": "Clinical care",
    "medication-review": "Medication review",
    "vaccination-follow-up": "Vaccination follow-up",
    "continuity-of-care": "Continuity of care",
  };
  return labels[value] ?? "Approved purpose";
}

function formatRemaining(milliseconds: number): string {
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
