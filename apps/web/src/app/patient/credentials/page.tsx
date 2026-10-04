"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

interface Credential {
  id: string;
  status: "active" | "rotated" | "revoked";
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

interface RotatingQr {
  token: string;
  expiresAt: string;
}

export default function PatientCredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [rotatingQr, setRotatingQr] = useState<RotatingQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCredential = credentials.find(({ status }) => status === "active");
  const cardUrl = useMemo(
    () => createQrUrl(cardToken, "credential"),
    [cardToken]
  );
  const rotatingUrl = useMemo(
    () => createQrUrl(rotatingQr?.token ?? null, "qr"),
    [rotatingQr?.token]
  );

  const loadCredentials = useCallback(async () => {
    const response = await fetch("/api/v1/qr/credentials", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load QR credentials.");
    setCredentials((await response.json()) as Credential[]);
  }, []);

  const loadRotatingQr = useCallback(async () => {
    const response = await fetch("/api/v1/qr/credentials/current", {
      cache: "no-store",
    });
    if (response.status === 404) {
      setRotatingQr(null);
      return;
    }
    if (!response.ok) throw new Error("Could not refresh the in-app QR.");
    setRotatingQr((await response.json()) as RotatingQr);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        await loadCredentials();
        await loadRotatingQr();
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Could not load QR credentials.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [loadCredentials, loadRotatingQr]);

  useEffect(() => {
    if (!activeCredential) return;
    let mounted = true;
    const untilExpiry = rotatingQr
      ? Math.max(0, Date.parse(rotatingQr.expiresAt) - Date.now() + 25)
      : 0;
    const timeout = window.setTimeout(() => {
      void loadRotatingQr().catch((refreshError: unknown) => {
        if (mounted) {
          setError(refreshError instanceof Error ? refreshError.message : "Could not refresh the in-app QR.");
        }
      });
    }, untilExpiry);

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
    };
  }, [activeCredential?.id, rotatingQr?.expiresAt, loadRotatingQr]);

  const issueOrRotate = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/qr/credentials", {
        method: "POST",
        headers: {
          "x-csrf-token": readCookie("__Host-mediqr-csrf"),
        },
      });
      if (!response.ok) throw new Error("Could not issue a QR credential.");
      const result = (await response.json()) as { id: string; credentialToken: string };
      setCardToken(result.credentialToken);
      await Promise.all([loadCredentials(), loadRotatingQr()]);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Could not issue a QR credential.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!activeCredential) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/qr/credentials/${activeCredential.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": readCookie("__Host-mediqr-csrf") },
      });
      if (!response.ok) throw new Error("Could not revoke the active QR credential.");
      setCardToken(null);
      setRotatingQr(null);
      await loadCredentials();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke the QR credential.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="mx-auto max-w-3xl p-8">Loading QR credentials…</main>;

  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 bg-[#FDF8F6] px-5 py-10 text-[#2B2230]">
      <header>
        <Link className="text-sm text-[#6B5A72] underline" href="/">
          Back to home
        </Link>
        <h1 className="mt-4 font-serif text-3xl font-bold">Your record access QR</h1>
        <p className="mt-2 text-sm text-[#6B5A72]">
          The QR contains only an opaque access credential. It never includes your name,
          Health ID, or medical records.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-[#EEDBCE] bg-white p-6">
        <h2 className="font-serif text-xl font-semibold">Printed card QR</h2>
        <p className="mt-2 text-sm text-[#6B5A72]">
          Keep the printed card private. You can replace or revoke its QR at any time.
        </p>
        {cardUrl ? (
          <div className="mt-5 inline-flex rounded-xl border border-[#F3E8E3] p-4">
            <QRCodeSVG value={cardUrl} size={192} level="M" />
          </div>
        ) : activeCredential ? (
          <p className="mt-4 text-sm">The active card QR is not stored by the app. Re-issue it to print a new card.</p>
        ) : (
          <p className="mt-4 text-sm">No active card QR.</p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void issueOrRotate()}
          className="mt-5 min-h-11 rounded-lg bg-[#4A1D3F] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Please wait…" : activeCredential ? "Replace printed QR" : "Create printed QR"}
        </button>
        {activeCredential && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void revoke()}
            className="ml-3 min-h-11 rounded-lg border border-[#4A1D3F] px-5 py-2 text-sm font-semibold text-[#4A1D3F] disabled:opacity-60"
          >
            Revoke QR
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-[#EEDBCE] bg-white p-6">
        <h2 className="font-serif text-xl font-semibold">In-app QR</h2>
        <p className="mt-2 text-sm text-[#6B5A72]">
          This signed QR refreshes every 60 seconds and is intended for an in-person scan.
        </p>
        {rotatingUrl ? (
          <>
            <div className="mt-5 inline-flex rounded-xl border border-[#F3E8E3] p-4">
              <QRCodeSVG value={rotatingUrl} size={192} level="M" />
            </div>
            <p className="mt-3 text-xs text-[#6B5A72]">
              Refreshes at {new Date(rotatingQr?.expiresAt ?? "").toLocaleTimeString()}.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm">Create a printed credential to enable your in-app QR.</p>
        )}
      </section>

      <section className="rounded-2xl border border-[#EEDBCE] bg-white p-6">
        <h2 className="font-serif text-xl font-semibold">Credential history</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {credentials.map((credential) => (
            <li key={credential.id} className="flex justify-between border-b border-[#F3E8E3] py-2">
              <span>QR credential</span>
              <span className="capitalize">{credential.status}</span>
            </li>
          ))}
          {credentials.length === 0 && <li>No QR credentials issued.</li>}
        </ul>
      </section>
    </main>
  );
}

function createQrUrl(token: string | null, parameter: "credential" | "qr"): string {
  if (!token || typeof window === "undefined") return "";
  const url = new URL("/request-access", window.location.origin);
  url.hash = `${parameter}=${encodeURIComponent(token)}`;
  return url.toString();
}

function readCookie(name: string): string {
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}
