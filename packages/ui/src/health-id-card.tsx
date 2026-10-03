import * as React from "react";
import { cn } from "./utils.js";
import { Badge } from "./badge.js";
import { ShieldCheck, QrCode, HeartPulse, User } from "lucide-react";

export interface HealthIdCardProps {
  healthId: string;
  patientName: string;
  category: "maternal" | "child" | "general";
  bloodGroup?: string;
  emergencyContact: string;
  isOfflineCached?: boolean;
  className?: string;
}

export function HealthIdCard({
  healthId,
  patientName,
  category,
  bloodGroup = "O+",
  emergencyContact,
  isOfflineCached = true,
  className,
}: HealthIdCardProps) {
  const categoryLabels = {
    maternal: "Maternal Health Profile",
    child: "Child & Infant Record",
    general: "Patient Record",
  };

  return (
    <div
      className={cn(
        "health-id-card-hero relative w-full max-w-md overflow-hidden rounded-3xl border border-plum-900/10 bg-gradient-to-br from-[#4A1D3F] via-[#36142D] to-[#240C1E] p-7 text-white shadow-2xl transition-all duration-300",
        className,
      )}
    >
      {/* Decorative Dot Grid Texture Overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />

      {/* Subtle radial sheen */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-coral-500/20 blur-3xl" />

      {/* Top Bar: Brand, Category Badge & Security Seal */}
      <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500 text-white shadow-md">
            <HeartPulse className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-serif text-lg font-bold tracking-tight text-white">
              MediQR Secure
            </h4>
            <p className="text-[10px] uppercase tracking-wider text-coral-200">
              India Health ID
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge
            variant="neutral"
            className="border-white/20 bg-white/10 text-white backdrop-blur-sm"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px]">Tamper-Evident</span>
          </Badge>
        </div>
      </div>

      {/* Main Body: QR & Details */}
      <div className="relative z-10 my-6 flex items-center justify-between gap-6">
        <div className="flex-1 space-y-2">
          <div className="inline-block rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium text-coral-200">
            {categoryLabels[category]}
          </div>
          <div className="font-serif text-2xl font-bold tracking-tight text-white">
            {patientName}
          </div>
          <div className="font-mono text-sm tracking-wider text-blush-200">
            {healthId}
          </div>
          <div className="flex items-center gap-4 pt-1 text-xs text-blush-200/80">
            <span>
              Blood Group: <strong className="text-white">{bloodGroup}</strong>
            </span>
            <span>
              SOS: <strong className="text-white">{emergencyContact}</strong>
            </span>
          </div>
        </div>

        {/* QR Code Presentation Box */}
        <div className="relative flex h-28 w-28 flex-shrink-0 flex-col items-center justify-center rounded-2xl border border-white/20 bg-white p-2 shadow-inner">
          <QrCode className="h-20 w-20 text-plum-900" />
          <span className="text-[8px] font-medium uppercase tracking-tight text-plum-950">
            Scan to Request
          </span>
        </div>
      </div>

      {/* Bottom Bar: Privacy & Offline Status */}
      <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-4 text-[11px] text-blush-200/80">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          <span>
            {isOfflineCached ? "Encrypted offline vault" : "Online token"}
          </span>
        </div>
        <div className="text-[10px] text-coral-200/90">
          Opaque Token • Zero PHI in QR
        </div>
      </div>
    </div>
  );
}
