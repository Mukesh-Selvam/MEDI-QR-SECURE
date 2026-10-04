"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const notificationSchema = z.object({
  id: z.string().uuid(),
  eventType: z.enum([
    "ACCESS_REQUESTED",
    "ACCESS_APPROVED",
    "ACCESS_DENIED",
    "DOCUMENT_READ",
    "ACCESS_REVOKED",
  ]),
  requestId: z.string().uuid(),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

const notificationsSchema = z.array(notificationSchema);
type Notification = z.infer<typeof notificationSchema>;

const eventMessages: Record<Notification["eventType"], string> = {
  ACCESS_REQUESTED: "A clinician asked to view records.",
  ACCESS_APPROVED: "A record-access request was approved.",
  ACCESS_DENIED: "A record-access request was denied.",
  DOCUMENT_READ: "A clinician viewed a record.",
  ACCESS_REVOKED: "Record access was ended.",
};

export default function PatientNotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/notifications", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? "Sign in to view notifications."
          : "Notifications could not be loaded. Please retry."
      );
    }
    setItems(notificationsSchema.parse(await response.json()));
  }, []);

  useEffect(() => {
    let mounted = true;
    void load()
      .catch((loadError: unknown) => {
        if (mounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Notifications could not be loaded."
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

  const markRead = async (notificationId: string) => {
    setSavingId(notificationId);
    setError(null);
    try {
      const csrfCookie = document.cookie
        .split("; ")
        .find((entry) => entry.startsWith("__Host-mediqr-csrf="));
      const csrfToken = csrfCookie
        ? decodeURIComponent(csrfCookie.slice("__Host-mediqr-csrf=".length))
        : "";
      const response = await fetch(
        `/api/v1/notifications/${notificationId}/read`,
        {
          method: "PATCH",
          headers: { "x-csrf-token": csrfToken },
          cache: "no-store",
        }
      );
      if (!response.ok) {
        throw new Error("This notification could not be marked as read.");
      }
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId
            ? { ...item, readAt: new Date().toISOString() }
            : item
        )
      );
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "This notification could not be marked as read."
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#FBEAE6] px-4 py-8 text-[#2B2230] dark:bg-[#211923] dark:text-[#F8F0F4] sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <Link
            href="/patient/access"
            className="text-sm font-medium text-[#4A1D3F] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E8735A] dark:text-[#F2B9AC]"
          >
            Back to record access
          </Link>
          <h1 className="mt-4 font-serif text-3xl font-bold">
            Notifications
          </h1>
          <p className="mt-2 max-w-[65ch] text-sm leading-6 text-[#554653] dark:text-[#D4C6D2]">
            Updates about access to your record. Notifications never include
            record details.
          </p>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-white px-4 py-3 text-sm text-red-900 dark:bg-[#322936] dark:text-red-200"
          >
            {error}
          </p>
        )}

        {loading ? (
          <div
            aria-label="Loading notifications"
            className="animate-pulse space-y-3"
          >
            <div className="h-20 rounded-xl bg-white/80 dark:bg-[#322936]" />
            <div className="h-20 rounded-xl bg-white/80 dark:bg-[#322936]" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-[#EEDBCE] bg-white p-5 text-sm text-[#554653] dark:border-[#493A4A] dark:bg-[#322936] dark:text-[#D4C6D2]">
            There are no notifications yet.
          </p>
        ) : (
          <ol aria-label="Notifications" className="space-y-3">
            {items.map((item) => (
              <li
                key={item.id}
                className={`rounded-xl border px-4 py-4 ${
                  item.readAt
                    ? "border-[#EEDBCE] bg-white/70 dark:border-[#493A4A] dark:bg-[#322936]"
                    : "border-[#4A1D3F] bg-white dark:border-[#E8735A] dark:bg-[#322936]"
                }`}
              >
                <p className="font-semibold">{eventMessages[item.eventType]}</p>
                <p className="mt-1 text-xs text-[#554653] dark:text-[#D4C6D2]">
                  Request reference: <span className="font-mono">{item.requestId}</span>
                </p>
                <time
                  className="mt-1 block text-xs text-[#554653] dark:text-[#D4C6D2]"
                  dateTime={item.createdAt}
                >
                  {formatDate(item.createdAt)}
                </time>
                {!item.readAt && (
                  <button
                    type="button"
                    disabled={savingId === item.id}
                    onClick={() => void markRead(item.id)}
                    className="mt-3 min-h-11 rounded-lg border border-[#4A1D3F] px-4 text-sm font-semibold text-[#4A1D3F] transition-transform active:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E8735A] disabled:opacity-60 dark:border-[#F2B9AC] dark:text-[#F2B9AC]"
                  >
                    {savingId === item.id ? "Saving..." : "Mark as read"}
                  </button>
                )}
                {item.readAt && (
                  <p className="mt-3 text-xs font-semibold text-[#554653] dark:text-[#D4C6D2]">
                    Read
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString();
}
