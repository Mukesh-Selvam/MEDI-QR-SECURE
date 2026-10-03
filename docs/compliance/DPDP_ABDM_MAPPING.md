# MediQR Secure — DPDP Act 2023 & ABDM Compliance Matrix

> **Notice:** This document provides an engineering control mapping and verification checklist. It does not constitute formal legal advice.

---

## 1. Digital Personal Data Protection (DPDP) Act 2023 Mapping

| Section / Principle                          | DPDP Obligation                                                                             | MediQR Implementation & Technical Control                                                                                                                                                                      | Verification Status          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Section 5: Notice**                        | Clear, itemized notice accompanying or preceding consent request.                           | Consent modal explicitly details: (1) Requesting clinician & facility identity, (2) Medical purpose, (3) Requested document scope, (4) Duration / TTL, (5) Revocation rights. Trilingual support (EN, TA, HI). | Planned / Phase 1            |
| **Section 6: Consent**                       | Free, specific, informed, unconditional, and unambiguous consent with ease of withdrawal.   | Deny-by-default architecture. Patient/guardian can revoke consent anytime via patient app; policy layer immediately invalidates access token.                                                                  | Planned / Phase 2            |
| **Section 8: Safeguards**                    | Reasonable security safeguards to prevent personal data breach.                             | Envelope encryption (AES-256-GCM), field-level encryption, OWASP ASVS Level 2 compliance, ClamAV antivirus scanning, immutable audit trail.                                                                    | Enforced in Phase 0          |
| **Section 9: Processing of Children's Data** | Verifiable consent of parent or lawful guardian before processing personal data of a child. | Guardianship domain model (`guardianships` table) linking mothers/guardians to infants with relationship verification status.                                                                                  | Enforced in Phase 0 (Schema) |
| **Section 11-14: Data Principal Rights**     | Right to access, right to correction/erasure, right of grievance redressal.                 | Patient records vault allows export of access logs and documented history; grievance officer contact surfaced in trust center.                                                                                 | Documented                   |

---

## 2. Ayushman Bharat Digital Mission (ABDM) Integration Boundary

MediQR complements ABDM by serving as a high-speed, localized, maternal-and-child record access layer that bridges seamlessly into ABDM:

1. **Patient Identifier**: MediQR Health ID (`MQ-XXXX-XXXX-XXXX`) maps 1:1 with the patient's ABHA Number / ABHA Address.
2. **Clinical Artifacts**: All medical documents adhere to HL7 FHIR R4 specifications (`Patient` and `DocumentReference` profiles as defined by the National Resource Centre for EHR Standards in India).
3. **HIP / HIU Adapter Boundary**: Isolated service interfaces reserved in `apps/api/src/modules/identity/` and `documents/` for sandbox integration with ABDM Consent Managers and Health Information Provider/User APIs.
