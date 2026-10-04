# MediQR Secure: project rules

Enterprise India-first digital health-record ACCESS platform for maternal and child healthcare. One QR-linked Health ID per patient; authorized, verified clinicians view the patient's EXISTING records with consent.

## Hard constraints
- Assistive, not diagnostic: no diagnosis, risk scores, triage, treatment advice, AI interpretation, or clinical decision support.
- No medical data or personal identifiers in the QR, URLs, logs, analytics, or error messages.
- Deny by default. Every record read goes through the central policy check (role, consent, scope, expiry) and writes an audit event in the same transaction.
- No hardcoded secrets, no placeholder crypto, no TODO security. Secrets come from env/secret files and are never committed.
- Dev shortcuts (fixed OTP, console OTP) must be impossible when NODE_ENV=production, enforced by a startup check and a test.
- Policy layer fails closed: if it errors or is unreachable, deny.
- Audit events hold opaque IDs only.

## Stack
pnpm + Turborepo monorepo, TypeScript strict. apps/web: Next.js App Router, Tailwind, shadcn/ui, TanStack Query, React Hook Form + Zod, next-intl (en, ta, hi). apps/api: NestJS on Fastify, modules per domain, REST + OpenAPI from Zod. PostgreSQL 16 with Drizzle, Redis + BullMQ, MinIO/S3 with ClamAV, Keycloak 24 (OIDC, PKCE), policy-as-code (Cerbos or equivalent), HL7 FHIR R4 for documents.

## Conventions
- Validate every boundary with Zod. Small modules, typed services, no `any`.
- Tokens only in httpOnly, Secure, SameSite=strict cookies; never localStorage. 
- Every endpoint declares its policy; a test fails the build if one doesn't.
- Write tests with the code: Vitest for units, Playwright for E2E. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before saying a task is done.
- Conventional commits, small diffs. Never log document contents, filenames, phone numbers, or names.
- Seed data is clearly fake. Never use real patient data.

## Design
Warm clinical editorial: deep plum #4A1D3F, coral #E8735A, blush #FBEAE6, ink #2B2230. Serif headings (Fraunces), humanist sans UI (Figtree). Calm, trustworthy, plain language; each permission screen says who, what, how long. WCAG 2.2 AA, 44px touch targets, works on slow connections. No purple-blue gradients, no emoji icons.