# MediQR Secure — System Architecture

## 1. System Mission & Core Constraints

MediQR Secure is an enterprise-grade digital health-record access platform designed specifically for maternal and child healthcare in India. It enables mothers, infants, and patients to possess a single, portable, QR-linked Health ID.

### Hard Constraints

1. **Assistive, strictly non-diagnostic**: Zero clinical diagnosis, triage, risk scoring, treatment recommendation, or AI interpretation of medical data. MediQR surfaces existing, documented, verified records only.
2. **Zero PHI in QR and Logs**: The QR code encodes only an opaque, 128-bit random token hash. Zero medical or identifying personal data is stored in the QR, query parameters, URLs, logs, or telemetry.
3. **Deny-by-default Policy Layer**: Centralized policy enforcement (Cerbos / Policy Engine) evaluates role, active consent grant, purpose, scope, and TTL before permitting any document read.
4. **Tamper-Evident Audit Trail**: Every document access event writes an immutable audit record containing SHA-256 hash chaining (`prev_hash` + `hash`) within the exact same transaction.
5. **India Sovereign Hosting**: All services, databases, object vaults, and telemetry collectors reside strictly in India-region data centers (e.g., AWS `ap-south-1`). Zero third-party foreign SaaS data egress.

---

## 2. Component Topology

```mermaid
graph TD
    subgraph Client Portals
        PWA[Patient App PWA]
        ClinicianUI[Clinician Console]
        FacilityUI[Facility & Pharmacy Portal]
        AdminUI[Admin & Compliance Console]
    end

    subgraph Edge & Gateway
        Cloudflare[TLS 1.3 / Edge Security Gateway]
        Traefik[Reverse Proxy / Ingress]
    end

    subgraph Core Platform [NestJS Fastify Monolith]
        AuthModule[Identity & Auth Module]
        ConsentModule[Consent & Policy Engine]
        AccessModule[QR Token & Access Module]
        EmergencyModule[Emergency Break-Glass Module]
        DocModule[Document Vault & KMS Module]
        AuditModule[Hash-Chained Audit Module]
    end

    subgraph Sovereign Data Layer
        PG[(PostgreSQL 16 with RLS)]
        Redis[(Redis 7 BullMQ & Cache)]
        MinIO[(MinIO / S3 SSE-KMS)]
        ClamAV[ClamAV Scan Daemon]
    end

    Client Portals -->|HTTPS / WSS| Cloudflare
    Cloudflare --> Traefik
    Traefik --> Core Platform
    Core Platform --> PG
    Core Platform --> Redis
    Core Platform --> MinIO
    Core Platform --> ClamAV
```

---

## 3. Cryptographic Storage & Envelope Encryption

- **Master Key**: Retained in hardware HSM / KMS.
- **Envelope Encryption**: Each patient document is encrypted with a distinct AES-256-GCM data key ($DEK$). The $DEK$ is wrapped by the Master Key ($KEK$) and stored alongside the document metadata.
- **Field-Level Encryption**: Direct patient identifiers (Aadhaar virtual tokens, phone, guardian references) use authenticated AES-GCM field encryption in PostgreSQL.
- **Tamper-Evident Audit Chain**: Audit records form a Merkle-like chain:
  $$H_i = \text{SHA256}(H_{i-1} \parallel \text{timestamp} \parallel \text{actor} \parallel \text{action} \parallel \text{resource} \parallel \text{outcome})$$
