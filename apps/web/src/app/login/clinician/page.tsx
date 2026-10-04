"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, LockKeyhole, LogOut, RefreshCw, Stethoscope } from "lucide-react";

interface StaffSession {
  role: string;
  isVerified: boolean;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
}

export default function ClinicianLoginPage() {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        setSession(null);
        return;
      }
      const data: unknown = await response.json();
      if (
        typeof data !== "object" ||
        data === null ||
        !("role" in data) ||
        typeof data.role !== "string" ||
        !("isVerified" in data) ||
        typeof data.isVerified !== "boolean"
      ) {
        throw new Error("The staff session response was invalid.");
      }
      setSession({ role: data.role, isVerified: data.isVerified });
      setError(null);
    } catch {
      setError("We could not confirm your sign-in. Please try again.");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const csrfToken = readCookie("__Host-mediqr-csrf");
    if (!csrfToken) {
      setSession(null);
      return;
    }
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "x-csrf-token": csrfToken },
    });
    if (!response.ok) {
      setSession(null);
      return;
    }
    await loadSession();
  }, [loadSession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    const authResult = new URLSearchParams(window.location.search).get("auth");
    if (authResult === "mfa-setup") {
      setError(
        "Your second factor is now enrolled. Sign in again to complete secure authentication."
      );
    } else if (authResult === "failed") {
      setError("We could not complete secure sign-in. Please try again.");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(() => void refreshSession(), 240_000);
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [refreshSession, session]);

  const handleLogout = async () => {
    const csrfToken = readCookie("__Host-mediqr-csrf");
    if (!csrfToken) {
      setError("Your sign-out token is missing. Reload the page and try again.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!response.ok) {
        setError("We could not end your identity-provider session. Please try again.");
        return;
      }
      setSession(null);
      setError(null);
    } catch {
      setError("We could not complete sign-out. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isClinician = session?.role === "clinician";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FDF8F6] px-4 py-12 text-[#2B2230]">
      <section className="w-full max-w-xl rounded-2xl border border-[#EEDBCE] bg-white p-8 shadow-sm">
        <Link href="/" className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3D2E45] text-white">
            <Stethoscope className="h-5 w-5 text-[#F28470]" />
          </span>
          <span className="font-serif text-lg font-bold">
            MediQR Secure · Clinician Portal
          </span>
        </Link>

        {loading ? (
          <div className="flex items-center gap-3 py-8" role="status">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <p>Checking your staff session…</p>
          </div>
        ) : !session ? (
          <div className="space-y-5">
            <div>
              <h1 className="font-serif text-2xl font-bold">
                Medical Practitioner Sign-In
              </h1>
              <p className="mt-2 text-sm text-[#6B5A72]">
                Sign in securely through MediQR&apos;s identity provider. A second
                factor is required.
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <a
              href="/api/auth/login"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#3D2E45] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2B2031]"
            >
              <LockKeyhole className="h-4 w-4" />
              Continue with secure sign-in
            </a>
          </div>
        ) : !isClinician ? (
          <div className="space-y-4">
            <h1 className="font-serif text-2xl font-bold">Clinician access required</h1>
            <p className="text-sm text-[#6B5A72]">
              This portal is available to clinician accounts only.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D5C2B8] px-4 py-2 text-sm font-semibold"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        ) : !session.isVerified ? (
          <div className="space-y-5" role="status">
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h1 className="font-serif text-xl font-bold">
                  Pending verification
                </h1>
                <p className="mt-2 text-sm leading-relaxed">
                  Your clinician credentials are awaiting verification. Patient
                  records remain unavailable until a platform administrator
                  completes that review.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D5C2B8] px-4 py-2 text-sm font-semibold"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
              <h1 className="font-serif text-xl font-bold">Clinician signed in</h1>
              <p className="mt-2 text-sm">
                Your verification is current. Patient record access is separately
                checked against consent and policy for every request.
              </p>
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D5C2B8] px-4 py-2 text-sm font-semibold"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
