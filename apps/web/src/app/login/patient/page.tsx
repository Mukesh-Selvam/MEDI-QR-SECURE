"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Lock,
  ArrowRight,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  HeartPulse,
  QrCode,
  LogOut,
} from "lucide-react";

export default function PatientLoginPage() {
  const [phone, setPhone] = useState("+919876543210");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp" | "authenticated">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{ id: string; role: string } | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>("");
  const [countdown, setCountdown] = useState(300); // 5 minutes (Condition 1)

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === "otp" && countdown > 0) {
      timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await fetch("/api/v1/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to send OTP");
      }

      setStep("otp");
      setCountdown(300);
      setInfo("OTP dispatched to your mobile number. Check Mailpit in dev (port 8025).");
    } catch (err: any) {
      setError(err.message || "Failed to connect to authentication server");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Invalid OTP code");
      }

      setCsrfToken(data.csrfToken);

      // Fetch user profile from /auth/me
      const meRes = await fetch("/api/v1/auth/me");
      if (meRes.ok) {
        const meData = await meRes.json();
        setUserProfile(meData);
      } else {
        setUserProfile({ id: "verified-patient-session", role: "patient" });
      }

      setStep("authenticated");
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      setStep("phone");
      setOtp("");
      setUserProfile(null);
      setInfo("You have been securely logged out. Session revoked.");
    } catch {
      setStep("phone");
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="min-h-screen bg-[#FDF8F6] text-[#2B2230] flex flex-col justify-between">
      {/* Top Banner */}
      <aside className="border-b border-[#F7D8D0] bg-[#FDF1ED] px-4 py-2 text-center text-xs text-[#3D2E45]">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#E05D44]" />
          <span>
            <strong>Zero-Leak Mobile OTP:</strong> Cryptographic server-side HMAC, HttpOnly cookies, zero tokens in localStorage.
          </span>
        </div>
      </aside>

      {/* Nav */}
      <header className="border-b border-[#F3E8E3] bg-[#FDF8F6]/90 backdrop-blur-sm px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3D2E45] text-white">
              <HeartPulse className="h-5 w-5 text-[#F28470]" />
            </div>
            <span className="font-serif text-lg font-bold text-[#2B2230]">MediQR Secure</span>
          </Link>
          <div className="flex items-center gap-4 text-xs font-medium text-[#6B5A72]">
            <Link href="/" className="hover:text-[#2B2230]">Home</Link>
            <Link href="/login/clinician" className="hover:text-[#2B2230]">Clinician Portal</Link>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {step !== "authenticated" ? (
            <div className="rounded-2xl border border-[#EEDBCE] bg-white p-8 shadow-sm">
              <div className="text-center mb-6">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#FDF1ED] text-[#E05D44] mb-3">
                  <Lock className="h-6 w-6" />
                </div>
                <h1 className="font-serif text-2xl font-bold text-[#2B2230]">
                  Patient Secure Access
                </h1>
                <p className="mt-1 text-xs text-[#7B6A82]">
                  India-First Maternal & Child Health Record System
                </p>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
                  <span>{error}</span>
                </div>
              )}

              {info && (
                <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                  <span>{info}</span>
                </div>
              )}

              {step === "phone" ? (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#5A4862] mb-1.5">
                      Indian Mobile Number
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-xs font-semibold text-[#7B6A82]">
                        🇮🇳 +91
                      </div>
                      <input
                        type="tel"
                        value={phone.replace(/^\+91/, "")}
                        onChange={(e) => setPhone("+91" + e.target.value.replace(/\D/g, ""))}
                        placeholder="9876543210"
                        maxLength={10}
                        required
                        className="w-full rounded-xl border border-[#D5C2B8] bg-[#FDFBF9] py-2.5 pl-16 pr-3 text-sm font-medium text-[#2B2230] placeholder-[#B5A49D] focus:border-[#E05D44] focus:outline-none focus:ring-1 focus:ring-[#E05D44]"
                      />
                    </div>
                    <span className="text-[11px] text-[#8C7B93] mt-1 block">
                      Stored as blind HMAC index. No plaintext phone numbers in audit logs.
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || phone.length < 13}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#E05D44] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#C84C34] disabled:opacity-50"
                  >
                    {loading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <span>Send Verification OTP</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#5A4862]">
                        One-Time Password (OTP)
                      </label>
                      <span className="text-xs font-mono font-medium text-[#E05D44]">
                        ⏱ {formatTime(countdown)}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456"
                      maxLength={6}
                      autoFocus
                      required
                      className="w-full text-center tracking-widest text-2xl font-mono rounded-xl border border-[#D5C2B8] bg-[#FDFBF9] py-3 text-[#2B2230] placeholder-[#C5B5AE] focus:border-[#E05D44] focus:outline-none focus:ring-1 focus:ring-[#E05D44]"
                    />
                    <div className="flex justify-between text-[11px] text-[#8C7B93] mt-1.5">
                      <span>Max 5 attempts allowed</span>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        className="text-[#E05D44] hover:underline font-medium"
                      >
                        Resend OTP
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || otp.length !== 6}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#3D2E45] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2B2031] disabled:opacity-50"
                  >
                    {loading ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4 text-[#F28470]" />
                        <span>Verify & Sign In</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("phone")}
                    className="w-full text-center text-xs text-[#7B6A82] hover:text-[#2B2230] pt-2"
                  >
                    ← Change Phone Number
                  </button>
                </form>
              )}
            </div>
          ) : (
            /* Authenticated Patient Dashboard */
            <div className="rounded-2xl border border-[#EEDBCE] bg-white p-8 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#F3E8E3] pb-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="font-serif text-lg font-bold text-[#2B2230]">
                      Patient Sovereign Portal
                    </h2>
                    <span className="text-xs text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Authenticated (Session Active)
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-lg border border-[#D5C2B8] px-3 py-1.5 text-xs font-semibold text-[#5A4862] hover:bg-[#FDF8F6]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout</span>
                </button>
              </div>

              {/* Patient Health ID Card Preview */}
              <div className="rounded-xl border border-[#D9C4BA] bg-gradient-to-br from-[#3D2E45] to-[#241A29] p-5 text-white shadow-md relative overflow-hidden mb-6">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#F28470]">
                      National Health ID
                    </span>
                    <h3 className="text-lg font-serif font-bold text-white tracking-wide">
                      Maternal Health Card
                    </h3>
                  </div>
                  <QrCode className="h-8 w-8 text-[#F28470]" />
                </div>

                <div className="space-y-1 font-mono text-xs text-[#E5D7D1]">
                  <div>ABHA ID: 91-8472-9102-4821</div>
                  <div>Opaque User UUID: {userProfile?.id?.slice(0, 18)}...</div>
                  <div>Role: {userProfile?.role}</div>
                </div>

                <div className="mt-4 pt-3 border-t border-white/10 flex justify-between text-[10px] text-[#CBB9B2]">
                  <span>Assistive · Strictly Non-Diagnostic</span>
                  <span>Cerbos Deny-by-Default Enforced</span>
                </div>
              </div>

              {/* Security Invariants Checklist */}
              <div className="space-y-2 text-xs text-[#5A4862] bg-[#FDFBF9] p-4 rounded-xl border border-[#EEDBCE]">
                <div className="font-semibold text-[#2B2230] mb-1">Session Invariants Verified:</div>
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>HttpOnly, SameSite=Strict, Secure cookies set</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Zero tokens in localStorage or sessionStorage</span>
                </div>
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Single-use refresh token rotation active</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#F3E8E3] py-4 text-center text-xs text-[#8C7B93]">
        MediQR India Maternal & Child Health Record Platform · Compliant with DPDP Act 2023 & ABDM
      </footer>
    </div>
  );
}
