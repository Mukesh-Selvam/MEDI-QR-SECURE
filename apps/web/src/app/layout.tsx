import type { Metadata, Viewport } from "next";
import { Fraunces, Figtree } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MediQR Secure — Maternal & Child Health Record Access Platform",
  description:
    "Enterprise-grade, India-first digital health-record access platform. Opaque QR token authorization, consent-based access, and tamper-evident audit trail.",
  applicationName: "MediQR Secure",
  authors: [{ name: "MediQR Engineering" }],
  keywords: [
    "ABDM",
    "ABHA",
    "DPDP Act",
    "FHIR R4",
    "Maternal Health",
    "Pediatric Health",
    "Health ID",
  ],
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#4A1D3F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${figtree.variable}`}>
      <body className="min-h-screen bg-[#FDF8F6] text-[#2B2230] selection:bg-coral-200 selection:text-plum-900">
        {children}
      </body>
    </html>
  );
}
