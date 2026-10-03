import * as React from "react";
import { cn } from "./utils.js";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "verified" | "patientUploaded" | "emergency" | "neutral" | "plum";
}

export function Badge({
  className,
  variant = "neutral",
  children,
  ...props
}: BadgeProps) {
  const variantStyles = {
    verified:
      "bg-[#EBF6F1] text-[#1D6A4F] border border-[#1D6A4F]/20 font-medium",
    patientUploaded:
      "bg-[#FDF8ED] text-[#8A5A12] border border-[#8A5A12]/20 font-medium",
    emergency:
      "bg-[#FDF0EE] text-[#C0392B] border border-[#C0392B]/20 font-semibold animate-pulse",
    neutral: "bg-ink-50 text-ink-700 border border-ink-100",
    plum: "bg-plum-50 text-plum-800 border border-plum-200",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs transition-colors",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
