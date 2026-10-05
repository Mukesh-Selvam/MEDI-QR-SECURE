"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { z } from "zod";
import {
  EmergencySummaryView,
  emergencySummarySchema,
  type EmergencySummary,
} from "../../emergency-summary-view";

const requestIdSchema = z.string().uuid();

export default function EmergencySummaryPage() {
  const { requestId: rawRequestId } = useParams<{ requestId: string }>();
  const [summary, setSummary] = useState<EmergencySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const parsedRequestId = requestIdSchema.safeParse(rawRequestId);
    if (!parsedRequestId.success) {
      setUnavailable(true);
      setLoading(false);
      return;
    }

    let active = true;
    void fetch(
      `/api/v1/emergency-access/requests/${parsedRequestId.data}/summary`,
      { cache: "no-store", credentials: "include" },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Summary unavailable.");
        return emergencySummarySchema.parse(await response.json());
      })
      .then((nextSummary) => {
        if (active) setSummary(nextSummary);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [rawRequestId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10" aria-busy="true">
        Loading emergency summary…
      </main>
    );
  }
  if (unavailable || !summary) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl font-semibold">
          Emergency summary unavailable
        </h1>
        <p className="mt-3">
          This summary is unavailable or your access has ended.
        </p>
      </main>
    );
  }
  return <EmergencySummaryView summary={summary} />;
}
