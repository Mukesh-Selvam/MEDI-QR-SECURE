"use client";

import { useState, useCallback } from "react";

type DocumentType = "scan" | "lab" | "prescription" | "vaccination" | "discharge";

const DOC_TYPE_META: Record<DocumentType, { label: string; icon: string; color: string }> = {
  lab: { label: "Lab Report", icon: "🧪", color: "#38bdf8" },
  scan: { label: "Scan / Imaging", icon: "🩻", color: "#a78bfa" },
  prescription: { label: "Prescription", icon: "💊", color: "#34d399" },
  vaccination: { label: "Vaccination", icon: "💉", color: "#fb923c" },
  discharge: { label: "Discharge Summary", icon: "🏥", color: "#f472b6" },
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<DocumentType>("lab");
  const [docDate, setDocDate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ id: string; status: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) validateAndSetFile(dropped);
  }, []);

  const validateAndSetFile = (f: File) => {
    const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
    if (!ALLOWED.includes(f.type)) {
      setError("Only PDF, JPEG, and PNG files are allowed.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("documentType", docType);
      form.append("uploadSource", "patient-uploaded");
      // patientId would come from session in production
      form.append("patientId", "00000000-0000-0000-0000-000000000001");
      if (docDate) form.append("documentDate", new Date(docDate).toISOString());

      const res = await fetch("/api/v1/vault/upload", {
        method: "POST",
        body: form,
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `Upload failed (${res.status})`);
      }

      const data = await res.json() as { id: string; status: string; message: string };
      setResult(data);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; }
        .page { min-height: 100vh; background: #0a0f1e; color: #e2e8f0; padding: 2rem; display: flex; align-items: center; justify-content: center; }
        .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 1.5rem; padding: 2.5rem; width: 100%; max-width: 560px; backdrop-filter: blur(12px); box-shadow: 0 25px 60px rgba(0,0,0,0.4); }
        .logo { display: flex; align-items: center; gap: .6rem; margin-bottom: 2rem; }
        .logo-icon { width: 2.2rem; height: 2.2rem; background: linear-gradient(135deg, #38bdf8, #818cf8); border-radius: .5rem; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
        .logo-text { font-size: 1.25rem; font-weight: 700; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: .35rem; }
        .subtitle { color: #94a3b8; font-size: .875rem; margin-bottom: 2rem; }
        label { display: block; font-size: .8rem; font-weight: 500; color: #94a3b8; margin-bottom: .4rem; text-transform: uppercase; letter-spacing: .05em; }
        .type-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-bottom: 1.5rem; }
        .type-btn { background: rgba(255,255,255,0.04); border: 1.5px solid rgba(255,255,255,0.08); border-radius: .75rem; padding: .7rem .5rem; cursor: pointer; text-align: center; transition: all .2s; color: #e2e8f0; font-size: .8rem; font-family: inherit; }
        .type-btn:hover { border-color: rgba(56,189,248,0.4); background: rgba(56,189,248,0.06); }
        .type-btn.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
        .type-icon { font-size: 1.3rem; display: block; margin-bottom: .2rem; }
        .dropzone { border: 2px dashed rgba(255,255,255,0.12); border-radius: 1rem; padding: 2.5rem 1rem; text-align: center; cursor: pointer; transition: all .25s; margin-bottom: 1.25rem; position: relative; }
        .dropzone.dragging { border-color: #38bdf8; background: rgba(56,189,248,0.06); }
        .dropzone.has-file { border-style: solid; border-color: rgba(52,211,153,0.5); background: rgba(52,211,153,0.05); }
        .dropzone-icon { font-size: 2.5rem; margin-bottom: .75rem; }
        .dropzone-text { font-size: .9rem; color: #64748b; }
        .dropzone-text strong { color: #e2e8f0; }
        .file-name { font-size: .85rem; color: #34d399; font-weight: 500; margin-top: .4rem; }
        input[type=file] { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
        .input { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: .6rem; padding: .65rem 1rem; color: #e2e8f0; font-size: .875rem; font-family: inherit; width: 100%; outline: none; transition: border-color .2s; margin-bottom: 1.5rem; }
        .input:focus { border-color: #38bdf8; }
        .btn { width: 100%; padding: .9rem; border: none; border-radius: .75rem; font-size: .95rem; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .2s; }
        .btn-primary { background: linear-gradient(135deg, #38bdf8, #818cf8); color: white; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(56,189,248,0.3); }
        .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: .6rem; padding: .75rem 1rem; font-size: .85rem; color: #f87171; margin-bottom: 1rem; }
        .success { background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.3); border-radius: .75rem; padding: 1.25rem; margin-top: 1.25rem; }
        .success-title { font-weight: 600; color: #34d399; margin-bottom: .3rem; font-size: .95rem; }
        .success-id { font-size: .75rem; color: #64748b; font-family: monospace; margin-top: .4rem; }
        .success-msg { font-size: .825rem; color: #94a3b8; margin-top: .3rem; }
        .badge { display: inline-flex; align-items: center; gap: .3rem; background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.3); border-radius: 2rem; padding: .25rem .65rem; font-size: .73rem; color: #fbbf24; margin-bottom: 1.25rem; }
        .spinner { animation: spin 1s linear infinite; display: inline-block; margin-right: .5rem; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="page">
        <div className="card">
          <div className="logo">
            <div className="logo-icon">🏥</div>
            <span className="logo-text">MediQR Vault</span>
          </div>

          <h1>Upload Medical Document</h1>
          <p className="subtitle">Your document is encrypted end-to-end and scanned for viruses before entering your vault.</p>

          <div className="badge">
            🔒 End-to-end encrypted · AES-256-GCM · Virus scanned before access
          </div>

          <label>Document Type</label>
          <div className="type-grid" style={{ marginBottom: "1.5rem" }}>
            {(Object.entries(DOC_TYPE_META) as [DocumentType, (typeof DOC_TYPE_META)[DocumentType]][]).map(([type, m]) => (
              <button
                key={type}
                className={`type-btn ${docType === type ? "selected" : ""}`}
                style={{ "--accent": m.color } as React.CSSProperties}
                onClick={() => setDocType(type)}
                type="button"
              >
                <span className="type-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>

          <label>Document Date (optional)</label>
          <input
            type="date"
            className="input"
            value={docDate}
            onChange={(e) => setDocDate(e.target.value)}
          />

          <label>Select File</label>
          <div
            className={`dropzone ${isDragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
          >
            <div className="dropzone-icon">
              {file ? "✅" : "📄"}
            </div>
            {file ? (
              <p className="file-name">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
            ) : (
              <p className="dropzone-text">
                <strong>Drag & drop</strong> or click to select<br />
                PDF, JPEG, PNG · Max 10 MB
              </p>
            )}
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => { if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]); }}
            />
          </div>

          {error && <div className="error">⚠️ {error}</div>}

          <button
            className="btn btn-primary"
            disabled={!file || uploading}
            onClick={handleUpload}
            type="button"
          >
            {uploading ? (
              <><span className="spinner">⏳</span>Uploading & Encrypting…</>
            ) : (
              `Upload ${DOC_TYPE_META[docType].icon} ${DOC_TYPE_META[docType].label}`
            )}
          </button>

          {result && (
            <div className="success">
              <p className="success-title">✅ Document staged for scanning</p>
              <p className="success-msg">{result.message}</p>
              <p className="success-id">ID: {result.id}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
