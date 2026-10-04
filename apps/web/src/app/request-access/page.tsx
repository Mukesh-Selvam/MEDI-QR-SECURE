"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

type AccessPurpose =
  | "clinical-care"
  | "medication-review"
  | "vaccination-follow-up"
  | "continuity-of-care";

const scopes = [
  ["timeline", "Record timeline"],
  ["document:scan", "Scans"],
  ["document:lab", "Laboratory results"],
  ["document:prescription", "Prescriptions"],
  ["document:vaccination", "Vaccinations"],
  ["document:discharge", "Discharge summaries"],
] as const;

interface StaffSession {
  role: string;
  isVerified: boolean;
}

export default function RequestAccessPage() {
  const [resolutionId, setResolutionId] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [purpose, setPurpose] = useState<AccessPurpose>("clinical-care");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [approvalComplete, setApprovalComplete] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("credential") ?? fragment.get("qr");
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) return;

    const id = window.crypto.randomUUID();
    setResolutionId(id);
    void fetch("/api/v1/qr/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, resolutionId: id }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
      .then((response) => {
        if (!response.ok) {
          setResolutionError("QR resolution is temporarily unavailable. Please try again.");
        }
      })
      .catch(() => {
        setResolutionError("QR resolution is temporarily unavailable. Please try again.");
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    const refreshSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!mounted) return;
        if (response.status === 401) {
          setStaffSession(null);
        } else if (!response.ok) {
          setResolutionError("Could not check the staff session.");
        } else {
          const value: unknown = await response.json();
          if (isStaffSession(value)) setStaffSession(value);
          else setResolutionError("Could not check the staff session.");
        }
      } catch {
        if (mounted) setResolutionError("Could not check the staff session.");
      } finally {
        if (mounted) setSessionChecked(true);
      }
    };

    void refreshSession();
    const interval = window.setInterval(() => void refreshSession(), 2500);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const toggleScope = (scope: string, checked: boolean) => {
    setSelectedScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope)
    );
  };

  const createRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolutionId || selectedScopes.length === 0) return;

    const csrfToken = readCookie("__Host-mediqr-csrf");
    if (!csrfToken) {
      setResolutionError("Your secure session expired. Sign in again to continue.");
      return;
    }

    setSubmitting(true);
    setResolutionError(null);
    try {
      const response = await fetch("/api/v1/access/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ resolutionId, purpose, scope: selectedScopes }),
        cache: "no-store",
      });
      if (!response.ok) {
        setResolutionError(
          response.status === 403
            ? "Verified clinician access is required."
            : "Could not submit the access request. Scan the QR again and retry."
        );
        return;
      }
      const result = (await response.json()) as { requestId: string };
      setRequestId(result.requestId);
    } catch {
      setResolutionError("Could not submit the access request. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmWithOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requestId || !/^\d{6}$/.test(otp)) {
      setOtpError("Enter the six-digit code shown by the patient.");
      return;
    }
    const csrfToken = readCookie("__Host-mediqr-csrf");
    if (!csrfToken) {
      setOtpError("Your secure session expired. Sign in again to continue.");
      return;
    }

    setOtpSubmitting(true);
    setOtpError(null);
    try {
      const response = await fetch(
        `/api/v1/access/requests/${requestId}/approve-with-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ code: otp }),
          cache: "no-store",
        }
      );
      if (!response.ok) {
        setOtpError(
          response.status === 403
            ? "Only the clinician who requested access can confirm this code."
            : "This code is incorrect, expired, or already used. Ask the patient to create a new code."
        );
        return;
      }
      setOtp("");
      setApprovalComplete(true);
    } catch {
      setOtpError("The code could not be checked. Please retry.");
    } finally {
      setOtpSubmitting(false);
    }
  };

  const isVerifiedClinician =
    staffSession?.role === "clinician" && staffSession.isVerified;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FDF8F6] px-5 py-10 text-[#2B2230]">
      <section className="w-full max-w-lg rounded-2xl border border-[#EEDBCE] bg-white p-8">
        <h1 className="font-serif text-2xl font-bold">Request record access</h1>
        <p className="mt-3 text-sm leading-6 text-[#6B5A72]">
          A QR code is only an access credential. It does not contain a Health ID or medical
          information. A patient must review and approve any request before records can be
          viewed.
        </p>

        {resolutionId && (
          <p className="mt-5 rounded-lg bg-[#FDF1ED] p-3 text-sm">
            QR received. The patient’s identity is not disclosed by QR resolution.
          </p>
        )}
        {resolutionError && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {resolutionError}
          </p>
        )}

        {requestId ? (
          <div className="mt-6 rounded-xl border border-[#EEDBCE] bg-[#FFFDFC] p-5 dark:border-[#493A4A] dark:bg-[#322936]">
            {approvalComplete ? (
              <p role="status" className="text-sm font-semibold text-[#244332] dark:text-[#D4E9DB]">
                Patient approval confirmed. The consent is now active for the requested scope.
              </p>
            ) : (
              <>
                <p role="status" className="text-sm font-semibold">
                  Request sent. Waiting for the patient to review it.
                </p>
                <p className="mt-2 text-sm leading-6 text-[#554653] dark:text-[#D4C6D2]">
                  If the patient is with you, ask them to create an in-person confirmation code and enter it below. Codes expire quickly and work once.
                </p>
                {otpError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{otpError}</p>}
                <form onSubmit={(event) => void confirmWithOtp(event)} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block flex-1 text-sm font-semibold">
                    Patient&apos;s six-digit code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="mt-2 min-h-12 w-full rounded-lg border border-[#BBA5B4] bg-white px-3 font-mono text-lg tracking-[0.2em] text-[#2B2230] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:border-[#6C586C] dark:bg-[#211923] dark:text-white"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={otpSubmitting || otp.length !== 6}
                    className="min-h-12 rounded-lg bg-[#4A1D3F] px-5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:bg-[#E8735A] dark:text-[#2B2230]"
                  >
                    {otpSubmitting ? "Checking code…" : "Confirm approval"}
                  </button>
                </form>
              </>
            )}
            <Link
              href={`/clinician/records/${requestId}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-[#BBA5B4] px-4 text-sm font-semibold text-[#4A1D3F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] dark:text-[#F8EAF2]"
            >
              Open clinician records console
            </Link>
          </div>
        ) : isVerifiedClinician && resolutionId ? (
          <form onSubmit={(event) => void createRequest(event)} className="mt-6 space-y-5">
            <label className="block text-sm font-semibold">
              Purpose
              <select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as AccessPurpose)}
                className="mt-2 min-h-11 w-full rounded-lg border border-[#D9C4BA] bg-white px-3"
              >
                <option value="clinical-care">Clinical care</option>
                <option value="medication-review">Medication review</option>
                <option value="vaccination-follow-up">Vaccination follow-up</option>
                <option value="continuity-of-care">Continuity of care</option>
              </select>
            </label>

            <fieldset className="space-y-1">
              <legend className="mb-2 text-sm font-semibold">Requested scope</legend>
              {scopes.map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(value)}
                    onChange={(event) => toggleScope(value, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              disabled={submitting || selectedScopes.length === 0}
              className="min-h-11 w-full rounded-lg bg-[#4A1D3F] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Send request to patient"}
            </button>
          </form>
        ) : staffSession?.role === "clinician" && !staffSession.isVerified ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            Your clinician account is pending verification. You cannot request or view patient
            records yet.
          </p>
        ) : !sessionChecked || !staffSession ? (
          <Link
            href="/login/clinician"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-[#4A1D3F] px-5 py-3 text-sm font-semibold text-white"
          >
            Continue to Keycloak staff sign-in
          </Link>
        ) : (
          <p className="mt-6 text-sm">
            Access requests can be submitted only by a verified clinician.
          </p>
        )}
      </section>
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

function readCookie(name: string): string {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
