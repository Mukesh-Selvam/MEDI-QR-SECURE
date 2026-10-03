import React from "react";
import { HealthIdCard } from "@mediqr/ui";
import { Button } from "@mediqr/ui";
import { Badge } from "@mediqr/ui";
import {
  ShieldCheck,
  Lock,
  AlertTriangle,
  QrCode,
  Building2,
  Stethoscope,
  HeartPulse,
  FileSpreadsheet,
  CheckCircle2,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#FDF8F6] text-[#2B2230]">
      {/* Top Banner: Hard Constraint Notice */}
      <aside
        aria-label="Regulatory Notice"
        className="border-b border-blush-300 bg-blush-100/90 px-4 py-2.5 text-center text-xs font-medium text-plum-900"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-coral-500" />
          <span>
            <strong>Assistive, Non-Diagnostic Platform:</strong> MediQR Secure
            surfaces verified medical documents only. Zero AI interpretation,
            clinical triage, or risk scoring. Complements ABDM/ABHA.
          </span>
        </div>
      </aside>

      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-blush-200/80 bg-[#FDF8F6]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-plum-700 text-white shadow-sm">
              <HeartPulse className="h-6 w-6 text-coral-300" />
            </div>
            <div>
              <span className="font-serif text-xl font-bold tracking-tight text-plum-900">
                MediQR Secure
              </span>
              <span className="ml-2 rounded border border-plum-300/40 bg-plum-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-plum-800">
                India Health ID
              </span>
            </div>
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="#portals"
              className="text-sm font-medium text-ink-600 transition-colors hover:text-plum-900"
            >
              Access Portals
            </a>
            <a
              href="#security"
              className="text-sm font-medium text-ink-600 transition-colors hover:text-plum-900"
            >
              Zero-PHI QR Architecture
            </a>
            <a
              href="#compliance"
              className="text-sm font-medium text-ink-600 transition-colors hover:text-plum-900"
            >
              DPDP Act & ABDM
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
            >
              Verify Health ID
            </Button>
            <Button variant="coral" size="sm">
              Emergency SOS
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="editorial-grid relative overflow-hidden px-6 py-16 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
            {/* Left Column: Editorial Headline & Value Prop */}
            <div className="space-y-6 lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-coral-200 bg-blush-100 px-3.5 py-1 text-xs font-medium text-plum-900">
                <ShieldCheck className="h-4 w-4 text-coral-600" />
                <span>Enterprise India-First Health Record Access</span>
              </div>

              <h1 className="font-serif text-4xl font-extrabold leading-[1.12] tracking-tight text-plum-950 sm:text-5xl lg:text-6xl">
                One opaque QR.{" "}
                <span className="text-coral-600">
                  Total patient sovereignty.
                </span>
              </h1>

              <p className="max-w-xl text-lg leading-relaxed text-ink-600">
                MediQR provides mothers and children with a single, revocable
                Health ID. Clinicians request access; patients consent; every
                single view is permanently recorded in a tamper-evident audit
                chain.
              </p>

              {/* Trust Indicators */}
              <div className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-3">
                <div className="rounded-xl border border-blush-200 bg-white/70 p-3.5 backdrop-blur-sm">
                  <div className="font-serif text-2xl font-bold text-plum-800">
                    Zero PHI
                  </div>
                  <div className="text-xs text-ink-500">
                    Opaque 128-bit hash in QR
                  </div>
                </div>
                <div className="rounded-xl border border-blush-200 bg-white/70 p-3.5 backdrop-blur-sm">
                  <div className="font-serif text-2xl font-bold text-plum-800">
                    30-min Max
                  </div>
                  <div className="text-xs text-ink-500">
                    Strict break-glass expiry
                  </div>
                </div>
                <div className="rounded-xl border border-blush-200 bg-white/70 p-3.5 backdrop-blur-sm">
                  <div className="font-serif text-2xl font-bold text-plum-800">
                    SHA-256
                  </div>
                  <div className="text-xs text-ink-500">
                    Cryptographic audit chain
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-4 pt-4">
                <Button variant="primary" size="lg" className="px-8">
                  Enter Patient Vault
                </Button>
                <Button variant="outline" size="lg">
                  Clinician Scan Console
                </Button>
              </div>
            </div>

            {/* Right Column: Hero Tactile Health ID Card */}
            <div className="flex justify-center lg:col-span-5">
              <div className="w-full max-w-sm sm:max-w-md">
                <div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-ink-500">
                  <span>Interactive Patient Card</span>
                  <span className="text-coral-600 font-semibold">
                    Hover to inspect
                  </span>
                </div>
                <HealthIdCard
                  healthId="MQ-7492-8104-5821"
                  patientName="Priya Sundaram & Baby Ananya"
                  category="maternal"
                  bloodGroup="B+"
                  emergencyContact="+91 98765 43210"
                  isOfflineCached={true}
                />
                <div className="mt-4 flex items-center justify-center gap-6 text-xs text-ink-500">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Offline Cached PWA
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Rotates Every 60s
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Portals Showcase Section */}
      <section
        id="portals"
        className="border-t border-blush-200 bg-white px-6 py-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-12 max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-coral-600">
              System Architecture
            </span>
            <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight text-plum-950 sm:text-4xl">
              Five purpose-built, role-isolated portals
            </h2>
            <p className="mt-3 text-base text-ink-600">
              Every persona operates inside a zero-trust perimeter with strict
              policy-as-code enforcement.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Portal 1: Patient App */}
            <div className="rounded-2xl border border-blush-200 bg-[#FDF8F6] p-7 transition-all hover:border-plum-300 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-plum-100 text-plum-800">
                <QrCode className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-plum-900">
                1. Patient App (PWA)
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Health ID card with dynamic QR, records vault, granular consent
                requests, access history, and guardian management for infants.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="plum">Offline Ready</Badge>
                <Badge variant="neutral">Mobile OTP</Badge>
              </div>
            </div>

            {/* Portal 2: Clinician Console */}
            <div className="rounded-2xl border border-blush-200 bg-[#FDF8F6] p-7 transition-all hover:border-plum-300 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-coral-100 text-coral-800">
                <Stethoscope className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-plum-900">
                2. Clinician Console
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Scan or enter opaque token, request scoped access with medical
                purpose, view verified scan reports and prescriptions.
                Read-only.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="verified">Verified Clinician</Badge>
                <Badge variant="neutral">MFA Enforced</Badge>
              </div>
            </div>

            {/* Portal 3: Facilities & Pharmacies */}
            <div className="rounded-2xl border border-blush-200 bg-[#FDF8F6] p-7 transition-all hover:border-plum-300 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-plum-100 text-plum-800">
                <Building2 className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-plum-900">
                3. Facility & Pharmacy Portal
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Institutional onboarding, verified-provider badges, staff
                credentialing, and supervised emergency break-glass dispatch.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="neutral">State Council Verified</Badge>
              </div>
            </div>

            {/* Portal 4: Admin & Compliance */}
            <div className="rounded-2xl border border-blush-200 bg-[#FDF8F6] p-7 transition-all hover:border-plum-300 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-100 text-ink-800">
                <FileSpreadsheet className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-plum-900">
                4. Compliance & Audit Console
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Cryptographic audit explorer, break-glass review queue within 24
                hours, consent analytics, and system health telemetry.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="neutral">Tamper Chain Monitor</Badge>
              </div>
            </div>

            {/* Portal 5: Emergency Break-Glass */}
            <div className="rounded-2xl border border-coral-200 bg-[#FDF4F2] p-7 transition-all hover:border-coral-400 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-coral-500 text-white">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-coral-900">
                Emergency Break-Glass
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Time-boxed 30-minute access limited strictly to Emergency
                Summary: blood group, documented allergies, active
                prescriptions. Zero download.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="emergency">Mandatory Review</Badge>
                <Badge variant="neutral">SMS / Push Alert</Badge>
              </div>
            </div>

            {/* Portal 6: Public Trust & Compliance */}
            <div className="rounded-2xl border border-blush-200 bg-[#FDF8F6] p-7 transition-all hover:border-plum-300 hover:shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800">
                <Lock className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-serif text-xl font-bold text-plum-900">
                5. Trust & Security Center
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                India DPDP Act 2023 compliance checklist, ABDM sandbox
                integration guide, OWASP ASVS Level 2 status, and STRIDE threat
                models.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="verified">DPDP 2023 Mapped</Badge>
                <Badge variant="neutral">ABDM Compliant</Badge>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-blush-200 bg-[#FDF8F6] px-6 py-12 text-ink-600">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2 font-serif text-lg font-bold text-plum-950">
            <HeartPulse className="h-5 w-5 text-coral-500" />
            <span>MediQR Secure</span>
            <span className="text-xs font-sans font-normal text-ink-400">
              © 2026 Sovereign Health Platform (India)
            </span>
          </div>

          <div className="flex items-center gap-6 text-xs text-ink-500">
            <span>India Region Data Residency</span>
            <span>•</span>
            <span>HL7 FHIR R4 Standard</span>
            <span>•</span>
            <span>ISO/IEC 27001 Aligned</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
