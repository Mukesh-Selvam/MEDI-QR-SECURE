"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { z } from "zod";

const scopeLabels: Record<string, string> = {
  timeline: "Record timeline",
  "document:scan": "Scans",
  "document:lab": "Laboratory results",
  "document:prescription": "Prescriptions",
  "document:vaccination": "Vaccinations",
  "document:discharge": "Discharge summaries",
};
const documentTypeLabels: Record<string, string> = {
  scan: "scan",
  lab: "laboratory",
  prescription: "prescription",
  vaccination: "vaccination",
  discharge: "discharge summary",
};

const wardSchema = z.object({ id: z.string().uuid(), label: z.string() });
const requestSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  patientLabel: z.string(),
  clinicianName: z.string(),
  purpose: z.string(),
  scope: z.array(z.string()),
  createdAt: z.string(),
});
const inboxSchema = z.object({
  wards: z.array(wardSchema),
  requests: z.array(requestSchema),
  consentDurationHours: z.number().int().positive(),
});
const historySchema = z.object({
  threads: z.array(
    z.object({
      id: z.string().uuid(),
      patientId: z.string().uuid(),
      patientLabel: z.string(),
      clinicianName: z.string(),
      purpose: z.string(),
      scope: z.array(z.string()),
      requestStatus: z.string(),
      consentId: z.string().uuid().nullable(),
      consentStatus: z.string().nullable(),
      consentExpiresAt: z.string().nullable(),
      events: z.array(
        z.object({
          kind: z.enum([
            "requested",
            "approved",
            "denied",
            "read",
            "revoked",
            "expired",
          ]),
          occurredAt: z.string(),
          documentType: z.string().optional(),
        })
      ),
    })
  ),
});

type Inbox = z.infer<typeof inboxSchema>;
type History = z.infer<typeof historySchema>;
type IssuedOtp = { requestId: string; code: string; expiresAt: string };

export default function PatientAccessPage() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [history, setHistory] = useState<History>({ threads: [] });
  const [selectedWardId, setSelectedWardId] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [issuedOtp, setIssuedOtp] = useState<IssuedOtp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [inboxResponse, historyResponse] = await Promise.all([
      fetch("/api/v1/access/requests/inbox", { cache: "no-store" }),
      fetch("/api/v1/access/requests/history", { cache: "no-store" }),
    ]);
    if (!inboxResponse.ok || !historyResponse.ok) {
      throw new Error(
        inboxResponse.status === 401 || historyResponse.status === 401
          ? "Sign in to review access requests."
          : "Access information could not be loaded. Please retry."
      );
    }

    const nextInbox = inboxSchema.parse(await inboxResponse.json());
    const nextHistory = historySchema.parse(await historyResponse.json());
    setInbox(nextInbox);
    setHistory(nextHistory);
    setSelectedWardId((current) =>
      nextInbox.wards.some(({ id }) => id === current)
        ? current
        : nextInbox.wards[0]?.id ?? ""
    );
    setSelectedRequestId((current) =>
      nextInbox.requests.some(({ id }) => id === current)
        ? current
        : nextInbox.requests.find(({ patientId }) => patientId === selectedWardId)?.id ??
          nextInbox.requests[0]?.id ??
          ""
    );
  }, [selectedWardId]);

  useEffect(() => {
    let mounted = true;
    void load()
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Access information could not be loaded."
          );
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [load]);

  const visibleRequests = useMemo(
    () =>
      (inbox?.requests ?? []).filter(
        ({ patientId }) => patientId === selectedWardId
      ),
    [inbox?.requests, selectedWardId]
  );
  const visibleThreads = useMemo(
    () =>
      history.threads.filter(({ patientId }) => patientId === selectedWardId),
    [history.threads, selectedWardId]
  );
  const selectedRequest = visibleRequests.find(
    ({ id }) => id === selectedRequestId
  );

  const decide = async (requestId: string, action: "approve" | "deny") => {
    setBusyId(requestId);
    setError(null);
    setNotice(null);
    setIssuedOtp(null);
    try {
      const response = await fetch(
        `/api/v1/access/requests/${requestId}/${action}`,
        {
          method: "POST",
          headers: { "x-csrf-token": readCookie("__Host-mediqr-csrf") },
          cache: "no-store",
        }
      );
      if (!response.ok) {
        throw new Error(
          response.status === 409 || response.status === 400
            ? "This request is no longer waiting for a decision."
            : "Your decision could not be saved. Please retry."
        );
      }
      setNotice(
        action === "approve"
          ? "Access approved. You can revoke it from access history at any time."
          : "The access request was denied."
      );
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Your decision could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const issueOtp = async (requestId: string) => {
    setBusyId(requestId);
    setError(null);
    setNotice(null);
    setIssuedOtp(null);
    try {
      const response = await fetch(`/api/v1/access/requests/${requestId}/otp`, {
        method: "POST",
        headers: { "x-csrf-token": readCookie("__Host-mediqr-csrf") },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? "Too many codes were requested. Please wait before trying again."
            : "A confirmation code could not be created. Please retry."
        );
      }
      const result = z
        .object({ code: z.string().regex(/^\d{6}$/), expiresAt: z.string() })
        .parse(await response.json());
      setIssuedOtp({ requestId, ...result });
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "A confirmation code could not be created.");
    } finally {
      setBusyId(null);
    }
  };

  const revokeConsent = async (consentId: string) => {
    setBusyId(consentId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/consents/${consentId}/revoke`, {
        method: "POST",
        headers: { "x-csrf-token": readCookie("__Host-mediqr-csrf") },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? "This access has already ended."
            : "Access could not be revoked. Please retry."
        );
      }
      setNotice("Access ended. The clinician cannot read records on their next request.");
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Access could not be revoked.");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-[#FBEAE6] px-4 py-10 text-[#2B2230] dark:bg-[#211923] dark:text-[#F8F0F4] sm:px-6">
        <div className="mx-auto max-w-3xl animate-pulse space-y-5" aria-label="Loading access requests">
          <div className="h-8 w-64 rounded bg-[#EEDBCE] dark:bg-[#443443]" />
          <div className="h-20 rounded-xl bg-white/80 dark:bg-[#322936]" />
          <div className="h-44 rounded-xl bg-white/80 dark:bg-[#322936]" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-[#FBEAE6] px-4 py-8 text-[#2B2230] dark:bg-[#211923] dark:text-[#F8F0F4] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <Link
            href="/patient/credentials"
            className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-[#4A1D3F] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:text-[#F2B9AC]"
          >
            Back to QR credentials
          </Link>
          <Link
            href="/patient/notifications"
            className="ml-5 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-[#4A1D3F] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:text-[#F2B9AC]"
          >
            Notifications
          </Link>
          <Link
            href="/patient/emergency"
            className="ml-5 inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-[#4A1D3F] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:text-[#F2B9AC]"
          >
            Emergency details
          </Link>
          <h1 className="mt-4 font-serif text-3xl font-bold">Record access</h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-[#554653] dark:text-[#D4C6D2]">
            Review who is asking, what they need, and why. You can end approved access at any time.
          </p>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-red-300 bg-white px-4 py-3 text-sm text-red-900 dark:bg-[#322936] dark:text-red-200">
            {error}
            {error.includes("Sign in") && (
              <Link href="/login/patient" className="ml-2 font-semibold underline underline-offset-4">
                Sign in
              </Link>
            )}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-xl border border-[#B7D1C4] bg-[#EFF6F1] px-4 py-3 text-sm text-[#244332] dark:bg-[#24372D] dark:text-[#D4E9DB]">
            {notice}
          </p>
        )}

        {inbox && inbox.wards.length > 1 && (
          <label className="block max-w-md text-sm font-semibold">
            Choose whose requests to review
            <select
              value={selectedWardId}
              onChange={(event) => {
                setSelectedWardId(event.target.value);
                setSelectedRequestId("");
                setIssuedOtp(null);
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-[#BBA5B4] bg-white px-3 text-[#2B2230] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:border-[#6C586C] dark:bg-[#322936] dark:text-white"
            >
              {inbox.wards.map((ward) => (
                <option key={ward.id} value={ward.id}>{ward.label}</option>
              ))}
            </select>
          </label>
        )}

        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="font-serif text-2xl font-semibold">
            Waiting for your decision
          </h2>
          {visibleRequests.length === 0 ? (
            <p className="mt-3 rounded-xl border border-[#EEDBCE] bg-white p-5 text-sm text-[#554653] dark:border-[#493A4A] dark:bg-[#322936] dark:text-[#D4C6D2]">
              There are no pending access requests for this record.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {visibleRequests.map((request) => {
                const selected = request.id === (selectedRequestId || visibleRequests[0]?.id);
                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => {
                      setSelectedRequestId(request.id);
                      setIssuedOtp(null);
                    }}
                    aria-pressed={selected}
                    className={`min-h-14 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] ${
                      selected
                        ? "border-[#4A1D3F] bg-white dark:border-[#E8735A] dark:bg-[#322936]"
                        : "border-[#EEDBCE] bg-white/70 dark:border-[#493A4A] dark:bg-[#322936]"
                    }`}
                  >
                    <span className="block font-semibold">{request.clinicianName}</span>
                    <span className="mt-1 block text-sm text-[#554653] dark:text-[#D4C6D2]">
                      {formatPurpose(request.purpose)}. Requested {formatDate(request.createdAt)}.
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {selectedRequest && (
            <article className="mt-4 rounded-2xl border border-[#EEDBCE] bg-white p-5 dark:border-[#493A4A] dark:bg-[#322936] sm:p-6">
              <h3 className="font-serif text-xl font-semibold">Review this request</h3>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Whose record</dt>
                  <dd className="mt-1">{selectedRequest.patientLabel}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Who is asking</dt>
                  <dd className="mt-1">{selectedRequest.clinicianName}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Purpose</dt>
                  <dd className="mt-1">{formatPurpose(selectedRequest.purpose)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">Records requested</dt>
                  <dd className="mt-1">
                    {selectedRequest.scope.map((scope) => scopeLabels[scope] ?? "Requested record").join(", ")}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-semibold">How long</dt>
                  <dd className="mt-1">
                    If approved, access lasts {inbox?.consentDurationHours ?? 24} hours. You can revoke it sooner from access history.
                  </dd>
                </div>
              </dl>

              {issuedOtp?.requestId === selectedRequest.id ? (
                <div className="mt-5 rounded-xl border border-[#E8735A] bg-[#FBEAE6] p-4 dark:bg-[#462D3D]">
                  <p className="text-sm font-semibold">In-person confirmation code</p>
                  <p className="mt-2 font-mono text-3xl tracking-[0.2em]" aria-label="One-time approval code">
                    {issuedOtp.code}
                  </p>
                  <p className="mt-2 text-sm">
                    Share this code with the requesting clinician in person. It expires at {formatDate(issuedOtp.expiresAt)} and can be used once.
                  </p>
                </div>
              ) : (
                <p className="mt-5 text-sm leading-6 text-[#554653] dark:text-[#D4C6D2]">
                  Approve in the app, or create a short-lived code only while you are with the clinician.
                </p>
              )}

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={busyId === selectedRequest.id}
                  onClick={() => void decide(selectedRequest.id, "approve")}
                  className="min-h-12 rounded-lg bg-[#4A1D3F] px-5 font-semibold text-white hover:bg-[#3C1733] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:bg-[#E8735A] dark:text-[#2B2230] dark:hover:bg-[#F18A73]"
                >
                  Approve access
                </button>
                <button
                  type="button"
                  disabled={busyId === selectedRequest.id}
                  onClick={() => void decide(selectedRequest.id, "deny")}
                  className="min-h-12 rounded-lg border border-[#4A1D3F] px-5 font-semibold text-[#4A1D3F] hover:bg-[#FBEAE6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:border-[#D4C6D2] dark:text-[#F8F0F4] dark:hover:bg-[#493A4A]"
                >
                  Deny request
                </button>
                <button
                  type="button"
                  disabled={busyId === selectedRequest.id}
                  onClick={() => void issueOtp(selectedRequest.id)}
                  className="min-h-12 rounded-lg border border-[#A7443D] px-5 font-semibold text-[#85352F] hover:bg-[#FFF2EF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:border-[#F2B9AC] dark:text-[#F2B9AC] dark:hover:bg-[#493A4A]"
                >
                  Create in-person code
                </button>
              </div>
            </article>
          )}
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-serif text-2xl font-semibold">
            Access history
          </h2>
          {visibleThreads.length === 0 ? (
            <p className="mt-3 rounded-xl border border-[#EEDBCE] bg-white p-5 text-sm dark:border-[#493A4A] dark:bg-[#322936]">
              Requests, decisions, and record views will appear here.
            </p>
          ) : (
            <ol className="mt-4 space-y-5">
              {visibleThreads.map((thread) => (
                <li
                  key={thread.id}
                  className="rounded-2xl border border-[#EEDBCE] bg-white p-5 dark:border-[#493A4A] dark:bg-[#322936] sm:p-6"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      {inbox?.wards.length && inbox.wards.length > 1 && (
                        <p className="text-sm font-semibold text-[#554653] dark:text-[#D4C6D2]">
                          {thread.patientLabel}
                        </p>
                      )}
                      <h3 className="mt-1 font-serif text-xl font-semibold">
                        {thread.clinicianName}
                      </h3>
                      <p className="mt-1 text-sm text-[#554653] dark:text-[#D4C6D2]">
                        Clinician · {formatPurpose(thread.purpose)}
                      </p>
                      <p className="mt-2 text-sm leading-6">
                        Records requested:{" "}
                        {thread.scope
                          .map((scope) => scopeLabels[scope] ?? "Requested record")
                          .join(", ")}
                      </p>
                    </div>
                    <span className="w-fit rounded-md bg-[#FBEAE6] px-3 py-2 text-sm font-semibold text-[#4A1D3F] dark:bg-[#493A4A] dark:text-[#F8F0F4]">
                      {accessStatus(thread.consentStatus, thread.requestStatus)}
                    </span>
                  </div>

                  <ol
                    aria-label={`Access events for ${thread.clinicianName}`}
                    className="mt-5 space-y-0 border-s-2 border-[#EEDBCE] ps-5 dark:border-[#6C586C]"
                  >
                    {thread.events.map((event, index) => (
                      <li
                        key={`${event.kind}-${event.occurredAt}-${index}`}
                        className="relative min-h-12 pb-5 last:pb-0"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute -start-[1.6rem] top-1 h-3 w-3 rounded-full border-2 border-[#4A1D3F] bg-[#FBEAE6] dark:border-[#F2B9AC] dark:bg-[#322936]"
                        />
                        <p className="text-sm leading-6">
                          {describeHistoryEvent(
                            event.kind,
                            thread.clinicianName,
                            event.documentType
                          )}
                        </p>
                        <time
                          dateTime={event.occurredAt}
                          className="mt-1 block text-xs text-[#554653] dark:text-[#D4C6D2]"
                        >
                          {formatDate(event.occurredAt)}
                        </time>
                      </li>
                    ))}
                  </ol>

                  {thread.consentExpiresAt && (
                    <p className="mt-4 text-sm text-[#554653] dark:text-[#D4C6D2]">
                      Access limit: {formatDate(thread.consentExpiresAt)}
                    </p>
                  )}
                  {thread.consentStatus === "active" && thread.consentId && (
                    <button
                      type="button"
                      disabled={busyId === thread.consentId}
                      onClick={() => void revokeConsent(thread.consentId!)}
                      className="mt-4 min-h-11 rounded-lg border border-[#A7443D] px-4 font-semibold text-[#85352F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:text-[#F2B9AC]"
                    >
                      End this access
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}

function formatPurpose(value: string): string {
  return value
    .split(/[-_]/)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function describeHistoryEvent(
  kind: "requested" | "approved" | "denied" | "read" | "revoked" | "expired",
  clinicianName: string,
  documentType?: string
): string {
  switch (kind) {
    case "requested":
      return `${clinicianName}, a clinician, requested access.`;
    case "approved":
      return `You approved access for ${clinicianName}.`;
    case "denied":
      return `You denied the request from ${clinicianName}.`;
    case "read":
      return `${clinicianName}, a clinician, viewed a ${documentTypeLabels[documentType ?? ""] ?? formatPurpose(documentType ?? "record").toLowerCase()} record.`;
    case "revoked":
      return `You ended access for ${clinicianName}.`;
    case "expired":
      return `Access for ${clinicianName} ended when its time limit expired.`;
  }
}

function accessStatus(consentStatus: string | null, requestStatus: string): string {
  if (consentStatus === "active") return "Access active";
  if (consentStatus === "revoked") return "Access ended";
  if (consentStatus === "expired") return "Access expired";
  if (requestStatus === "denied") return "Request denied";
  if (requestStatus === "pending") return "Awaiting decision";
  return "Request complete";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "the recorded time" : date.toLocaleString();
}

function readCookie(name: string): string {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
