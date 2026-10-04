"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function RequestAccessPage() {
  const [credentialPresent, setCredentialPresent] = useState(false);

  useEffect(() => {
    const hasCredential = window.location.hash.length > 1;
    window.history.replaceState(null, "", window.location.pathname);
    setCredentialPresent(hasCredential);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FDF8F6] px-5 py-10 text-[#2B2230]">
      <section className="w-full max-w-lg rounded-2xl border border-[#EEDBCE] bg-white p-8">
        <h1 className="font-serif text-2xl font-bold">Request record access</h1>
        <p className="mt-3 text-sm leading-6 text-[#6B5A72]">
          A QR code is only an access credential. It does not contain a Health ID or medical
          information. A patient must review and approve any request before records can be
          viewed.
        </p>
        {credentialPresent && (
          <p className="mt-5 rounded-lg bg-[#FDF1ED] p-3 text-sm">
            QR received. Sign in through the staff portal to continue the secure request flow.
          </p>
        )}
        <Link
          href="/login/clinician"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-[#4A1D3F] px-5 py-3 text-sm font-semibold text-white"
        >
          Continue to staff sign-in
        </Link>
      </section>
    </main>
  );
}
