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
          <p className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
            Request submitted. The patient must approve the requested purpose and scope before
            any record can be viewed.
          </p>
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
