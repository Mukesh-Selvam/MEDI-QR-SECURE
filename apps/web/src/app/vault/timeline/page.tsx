"use client";

import { useState, useEffect, useCallback } from "react";
import { z } from "zod";

type DocumentType =
  "scan" | "lab" | "prescription" | "vaccination" | "discharge";

const timelineDocumentSchema = z.object({
  id: z.string().uuid(),
  documentType: z.enum([
    "scan",
    "lab",
    "prescription",
    "vaccination",
    "discharge",
  ]),
  uploadSource: z.enum(["patient-uploaded", "facility-verified"]),
  sourceLabel: z.enum(["verified-source", "patient-uploaded"]),
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  status: z.string(),
  scanStatus: z.enum([
    "pending",
    "scanning",
    "clean",
    "infected",
    "scan_failed",
  ]),
  documentDate: z.string().nullable(),
  createdAt: z.string(),
  emergencyVisible: z.boolean().optional(),
});
const timelineSchema = z.array(
  z.object({
    type: z.enum(["scan", "lab", "prescription", "vaccination", "discharge"]),
    documents: z.array(timelineDocumentSchema),
  }),
);
const userSchema = z.object({
  patientId: z.string().uuid().nullable(),
  role: z.string(),
});
const wardsSchema = z.object({
  wards: z.array(z.object({ id: z.string().uuid(), label: z.string() })),
});
type TimelineDocument = z.infer<typeof timelineDocumentSchema>;
type TimelineGroup = z.infer<typeof timelineSchema>[number];
type ScanStatus = TimelineDocument["scanStatus"];

const DOC_META: Record<
  DocumentType,
  { label: string; icon: string; gradient: string }
> = {
  lab: {
    label: "Lab Reports",
    icon: "🧪",
    gradient: "linear-gradient(135deg,#38bdf8,#0ea5e9)",
  },
  scan: {
    label: "Scans & Imaging",
    icon: "🩻",
    gradient: "linear-gradient(135deg,#a78bfa,#7c3aed)",
  },
  prescription: {
    label: "Prescriptions",
    icon: "💊",
    gradient: "linear-gradient(135deg,#34d399,#059669)",
  },
  vaccination: {
    label: "Vaccinations",
    icon: "💉",
    gradient: "linear-gradient(135deg,#fb923c,#ea580c)",
  },
  discharge: {
    label: "Discharge Summaries",
    icon: "🏥",
    gradient: "linear-gradient(135deg,#f472b6,#db2777)",
  },
};

const SCAN_STATUS_BADGE: Record<ScanStatus, { label: string; color: string }> =
  {
    pending: { label: "Scan Pending", color: "#fbbf24" },
    scanning: { label: "Scanning…", color: "#38bdf8" },
    clean: { label: "Verified Clean", color: "#34d399" },
    infected: { label: "⚠️ Quarantined", color: "#f87171" },
    scan_failed: { label: "Scan Failed", color: "#f87171" },
  };

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TimelinePage() {
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [patientChoices, setPatientChoices] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [patientId, setPatientId] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [updatingDocumentId, setUpdatingDocumentId] = useState<string | null>(
    null,
  );
  const [filter, setFilter] = useState<DocumentType | "all">("all");
  const [activeViewerDoc, setActiveViewerDoc] =
    useState<TimelineDocument | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(300);

  const fetchTimeline = useCallback(async (requestedPatientId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const userResponse = await fetch("/api/v1/auth/me", {
        cache: "no-store",
      });
      if (!userResponse.ok) throw new Error("Sign in to view records.");
      const user = userSchema.parse(await userResponse.json());
      setCurrentRole(user.role);
      const inboxResponse =
        user.role === "guardian"
          ? await fetch("/api/v1/access/requests/inbox", { cache: "no-store" })
          : undefined;
      const wards = inboxResponse?.ok
        ? wardsSchema.parse(await inboxResponse.json()).wards
        : [];
      const choices = [
        ...(user.patientId
          ? [{ id: user.patientId, label: "My records" }]
          : []),
        ...wards,
      ];
      const targetPatientId =
        requestedPatientId &&
        choices.some(({ id }) => id === requestedPatientId)
          ? requestedPatientId
          : choices[0]?.id;
      setPatientChoices(choices);
      if (!targetPatientId) {
        setPatientId("");
        throw new Error("No patient record is available for this account.");
      }
      setPatientId(targetPatientId);
      const res = await fetch(`/api/v1/vault/timeline/${targetPatientId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load timeline (${res.status})`);
      const data = timelineSchema.parse(await res.json());
      setGroups(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load records");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTimeline();
  }, [fetchTimeline]);

  // Zero-footprint session countdown timer
  useEffect(() => {
    if (!activeViewerDoc) return;
    setRemainingSeconds(300);
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          setActiveViewerDoc(null); // Force close on expiry
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [activeViewerDoc]);

  const openDocument = (doc: TimelineDocument) => {
    setActiveViewerDoc(doc);
  };

  const closeViewer = () => {
    setActiveViewerDoc(null);
  };

  const updateEmergencyVisibility = async (
    doc: TimelineDocument,
    emergencyVisible: boolean,
  ) => {
    setUpdatingDocumentId(doc.id);
    setVisibilityError(null);
    try {
      const csrfCookie = document.cookie
        .split("; ")
        .find((part) => part.startsWith("__Host-mediqr-csrf="));
      const csrfToken = csrfCookie
        ? decodeURIComponent(csrfCookie.split("=").slice(1).join("="))
        : "";
      if (!csrfToken)
        throw new Error("Your secure session expired. Sign in again.");
      const response = await fetch(
        `/api/v1/emergency-access/documents/${doc.id}/visibility`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify({ emergencyVisible }),
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error("Emergency visibility could not be updated.");
      setGroups((current) =>
        current.map((group) => ({
          ...group,
          documents: group.documents.map((item) =>
            item.id === doc.id ? { ...item, emergencyVisible } : item,
          ),
        })),
      );
    } catch (updateError) {
      setVisibilityError(
        updateError instanceof Error
          ? updateError.message
          : "Emergency visibility could not be updated.",
      );
    } finally {
      setUpdatingDocumentId(null);
    }
  };

  const displayedGroups =
    filter === "all" ? groups : groups.filter((g) => g.type === filter);
  const totalDocs = groups.reduce((n, g) => n + g.documents.length, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #0a0f1e; color: #e2e8f0; }
        .page { min-height: 100vh; padding: 2rem 1.5rem; max-width: 860px; margin: 0 auto; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem; }
        .logo { display: flex; align-items: center; gap: .6rem; }
        .logo-icon { width: 2.2rem; height: 2.2rem; background: linear-gradient(135deg,#38bdf8,#818cf8); border-radius: .5rem; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
        .logo-text { font-size: 1.25rem; font-weight: 700; background: linear-gradient(to right,#38bdf8,#818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .upload-btn { background: rgba(56,189,248,0.1); border: 1.5px solid rgba(56,189,248,0.3); border-radius: .6rem; padding: .5rem 1rem; color: #38bdf8; font-size: .85rem; font-weight: 600; cursor: pointer; font-family: inherit; text-decoration: none; transition: all .2s; }
        .upload-btn:hover { background: rgba(56,189,248,0.2); }
        h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: .25rem; }
        .subtitle { color: #64748b; font-size: .875rem; margin-bottom: 1.5rem; }
        .stats { display: flex; gap: 1rem; margin-bottom: 1.75rem; flex-wrap: wrap; }
        .stat { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); border-radius: .75rem; padding: .75rem 1.25rem; }
        .stat-val { font-size: 1.5rem; font-weight: 700; color: #38bdf8; }
        .stat-label { font-size: .75rem; color: #64748b; margin-top: .15rem; }
        .filters { display: flex; gap: .5rem; margin-bottom: 1.75rem; flex-wrap: wrap; }
        .filter-btn { background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.08); border-radius: 2rem; padding: .4rem .9rem; font-size: .8rem; cursor: pointer; font-family: inherit; color: #94a3b8; transition: all .2s; }
        .filter-btn.active { background: rgba(56,189,248,0.12); border-color: rgba(56,189,248,0.5); color: #38bdf8; }
        .group { margin-bottom: 2rem; }
        .group-header { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
        .group-icon { width: 2.4rem; height: 2.4rem; border-radius: .6rem; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0; }
        .group-title { font-size: 1.05rem; font-weight: 600; }
        .group-count { background: rgba(255,255,255,0.08); border-radius: 1rem; padding: .15rem .6rem; font-size: .75rem; color: #94a3b8; }
        .doc-list { display: flex; flex-direction: column; gap: .6rem; }
        .doc-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: .875rem; padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem; transition: all .2s; }
        .doc-card:hover { border-color: rgba(255,255,255,0.14); background: rgba(255,255,255,0.05); }
        .doc-mime { width: 2.2rem; height: 2.2rem; border-radius: .5rem; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; }
        .doc-info { flex: 1; min-width: 0; }
        .doc-date { font-weight: 600; font-size: .875rem; color: #e2e8f0; }
        .doc-meta { font-size: .75rem; color: #64748b; margin-top: .2rem; display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
        .source-badge { display: inline-flex; align-items: center; gap: .25rem; padding: .18rem .5rem; border-radius: 1rem; font-size: .7rem; font-weight: 500; }
        .source-verified { background: rgba(52,211,153,0.1); color: #34d399; border: 1px solid rgba(52,211,153,0.25); }
        .source-patient { background: rgba(56,189,248,0.1); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); }
        .scan-badge { padding: .18rem .5rem; border-radius: 1rem; font-size: .68rem; font-weight: 500; }
        .doc-actions { flex-shrink: 0; }
        .emergency-visible-control { min-height: 44px; display: flex; align-items: center; gap: .5rem; margin: 0 .75rem; color: #e2e8f0; font-size: .75rem; }
        .emergency-visible-control input { width: 1.15rem; height: 1.15rem; accent-color: #E8735A; }
        .view-btn { background: rgba(129,140,248,0.1); border: 1.5px solid rgba(129,140,248,0.25); border-radius: .5rem; padding: .45rem .85rem; color: #818cf8; font-size: .8rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .2s; }
        .view-btn:hover:not(:disabled) { background: rgba(129,140,248,0.2); transform: translateY(-1px); }
        .view-btn:disabled { opacity: .4; cursor: not-allowed; }
        .empty { text-align: center; padding: 4rem 2rem; color: #475569; }
        .empty-icon { font-size: 3.5rem; margin-bottom: 1rem; }
        .empty-title { font-size: 1.1rem; font-weight: 600; color: #64748b; margin-bottom: .5rem; }
        .loading { display: flex; align-items: center; justify-content: center; padding: 4rem; }
        .spin { animation: spin 1s linear infinite; font-size: 2rem; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .viewer-overlay { position: fixed; inset: 0; background: rgba(3,7,18,0.85); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1.5rem; }
        .viewer-card { background: #0f172a; border: 1.5px solid rgba(255,255,255,0.12); border-radius: 1.25rem; width: 100%; max-width: 900px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.7); }
        .viewer-header { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); }
        .viewer-title-group { display: flex; align-items: center; gap: .75rem; }
        .viewer-title { font-size: 1rem; font-weight: 600; color: #f1f5f9; }
        .viewer-timer { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.3); border-radius: 2rem; padding: .25rem .75rem; font-size: .75rem; color: #fbbf24; font-weight: 600; font-family: monospace; }
        .viewer-close-btn { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); color: #f87171; border-radius: .5rem; padding: .4rem .9rem; font-size: .8rem; font-weight: 600; cursor: pointer; transition: all .2s; }
        .viewer-close-btn:hover { background: rgba(239,68,68,0.22); }
        .viewer-security-bar { padding: .45rem 1.5rem; background: rgba(56,189,248,0.08); border-bottom: 1px solid rgba(56,189,248,0.15); font-size: .72rem; color: #38bdf8; display: flex; align-items: center; justify-content: space-between; }
        .viewer-body { flex: 1; background: #020617; position: relative; }
        .viewer-frame { width: 100%; height: 100%; border: none; }
        .security-notice { background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.2); border-radius: .75rem; padding: .75rem 1rem; font-size: .78rem; color: #fbbf24; margin-bottom: 1.5rem; display: flex; align-items: flex-start; gap: .5rem; }
      `}</style>

      <div className="page">
        <div className="header">
          <div className="logo">
            <div className="logo-icon">🏥</div>
            <span className="logo-text">MediQR Vault</span>
          </div>
          <a href="/vault/upload" className="upload-btn">
            + Upload Document
          </a>
        </div>

        <h1>My Medical Records</h1>
        <p className="subtitle">
          Your encrypted document vault — all records are virus-scanned and
          end-to-end encrypted
        </p>

        <div className="security-notice">
          🔐{" "}
          <span>
            Documents open in <strong>5-minute secure windows</strong>. Links
            expire automatically for your protection.
          </span>
        </div>

        {error && <div className="error">⚠️ {error}</div>}
        {visibilityError && (
          <div className="error" role="alert">
            {visibilityError}
          </div>
        )}

        {loading ? (
          <div className="loading">
            <span className="spin">⏳</span>
          </div>
        ) : (
          <>
            {patientChoices.length > 1 && (
              <label className="mb-6 block">
                <span className="mb-2 block font-medium">Records for</span>
                <select
                  value={patientId}
                  onChange={(event) => void fetchTimeline(event.target.value)}
                  className="min-h-11 rounded-lg border border-[#8B7D88] bg-white px-3 text-[#2B2230]"
                >
                  {patientChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="stats">
              <div className="stat">
                <div className="stat-val">{totalDocs}</div>
                <div className="stat-label">Total Records</div>
              </div>
              <div className="stat">
                <div className="stat-val">{groups.length}</div>
                <div className="stat-label">Categories</div>
              </div>
              <div className="stat">
                <div className="stat-val">
                  {groups.reduce(
                    (n, g) =>
                      n +
                      g.documents.filter(
                        (d) => d.uploadSource === "facility-verified",
                      ).length,
                    0,
                  )}
                </div>
                <div className="stat-label">Verified by Facility</div>
              </div>
            </div>

            <div className="filters">
              <button
                className={`filter-btn ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
              {groups.map((g) => (
                <button
                  key={g.type}
                  className={`filter-btn ${filter === g.type ? "active" : ""}`}
                  onClick={() => setFilter(g.type)}
                >
                  {DOC_META[g.type].icon} {DOC_META[g.type].label}
                </button>
              ))}
            </div>

            {displayedGroups.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">📭</div>
                <div className="empty-title">No records yet</div>
                <p>Upload your first medical document to get started.</p>
              </div>
            ) : (
              displayedGroups.map((group) => {
                const meta = DOC_META[group.type];
                return (
                  <div key={group.type} className="group">
                    <div className="group-header">
                      <div
                        className="group-icon"
                        style={{ background: meta.gradient }}
                      >
                        {meta.icon}
                      </div>
                      <span className="group-title">{meta.label}</span>
                      <span className="group-count">
                        {group.documents.length}
                      </span>
                    </div>
                    <div className="doc-list">
                      {group.documents.map((doc) => {
                        const scanBadge = SCAN_STATUS_BADGE[doc.scanStatus];
                        const mimeIcon =
                          doc.mimeType === "application/pdf"
                            ? "📄"
                            : doc.mimeType === "image/jpeg"
                              ? "🖼️"
                              : "🖼️";
                        return (
                          <div key={doc.id} className="doc-card">
                            <div className="doc-mime">{mimeIcon}</div>
                            <div className="doc-info">
                              <div className="doc-date">
                                {formatDate(doc.documentDate ?? doc.createdAt)}
                              </div>
                              <div className="doc-meta">
                                <span
                                  className={`source-badge ${doc.uploadSource === "facility-verified" ? "source-verified" : "source-patient"}`}
                                >
                                  {doc.uploadSource === "facility-verified"
                                    ? "✅ Verified Source"
                                    : "👤 Patient Uploaded"}
                                </span>
                                <span
                                  className="scan-badge"
                                  style={{
                                    color: scanBadge.color,
                                    background: `color-mix(in srgb, ${scanBadge.color} 10%, transparent)`,
                                  }}
                                >
                                  {scanBadge.label}
                                </span>
                                <span>{formatSize(doc.fileSizeBytes)}</span>
                              </div>
                            </div>
                            <div className="doc-actions">
                              {(currentRole === "patient" ||
                                currentRole === "guardian") &&
                                doc.documentType === "prescription" && (
                                  <label className="emergency-visible-control">
                                    <input
                                      type="checkbox"
                                      checked={doc.emergencyVisible ?? false}
                                      disabled={
                                        doc.status !== "ready" ||
                                        updatingDocumentId === doc.id
                                      }
                                      onChange={(event) =>
                                        void updateEmergencyVisibility(
                                          doc,
                                          event.target.checked,
                                        )
                                      }
                                      aria-label={`Show prescription dated ${formatDate(doc.documentDate)} in emergency summary`}
                                    />
                                    <span>
                                      Visible in emergencies
                                      {doc.status !== "ready" &&
                                        " (available when ready)"}
                                    </span>
                                  </label>
                                )}
                              <button
                                className="view-btn"
                                disabled={doc.status !== "ready"}
                                onClick={() => openDocument(doc)}
                                type="button"
                              >
                                View Record
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeViewerDoc && (
          <div className="viewer-overlay" onClick={closeViewer}>
            <div className="viewer-card" onClick={(e) => e.stopPropagation()}>
              <div className="viewer-header">
                <div className="viewer-title-group">
                  <span className="viewer-title">
                    {DOC_META[activeViewerDoc.documentType]?.icon}{" "}
                    {DOC_META[activeViewerDoc.documentType]?.label}
                  </span>
                  <span
                    className={`source-badge ${activeViewerDoc.uploadSource === "facility-verified" ? "source-verified" : "source-patient"}`}
                  >
                    {activeViewerDoc.uploadSource === "facility-verified"
                      ? "✅ Verified Source"
                      : "👤 Patient Uploaded"}
                  </span>
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "1rem" }}
                >
                  <div className="viewer-timer">
                    ⏱️ Session: {Math.floor(remainingSeconds / 60)}:
                    {(remainingSeconds % 60).toString().padStart(2, "0")}
                  </div>
                  <button
                    className="viewer-close-btn"
                    onClick={closeViewer}
                    type="button"
                  >
                    ✕ Close &amp; Wipe
                  </button>
                </div>
              </div>
              <div className="viewer-security-bar">
                <span>
                  🔒 Zero-Footprint Stream: No Cache · No LocalStorage ·
                  Ephemeral Decryption
                </span>
                <span>
                  Date:{" "}
                  {formatDate(
                    activeViewerDoc.documentDate ?? activeViewerDoc.createdAt,
                  )}
                </span>
              </div>
              <div className="viewer-body">
                <iframe
                  className="viewer-frame"
                  src={`/api/v1/vault/${activeViewerDoc.id}/stream`}
                  title="Document Viewer"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
