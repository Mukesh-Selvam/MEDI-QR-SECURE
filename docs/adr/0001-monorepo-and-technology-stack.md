# ADR 0001: Monorepo Architecture & Core Technology Stack

## Status

Accepted

## Date

2026-10-03

## Context

MediQR Secure requires coordinated development across 5 portals (Patient PWA, Clinician Console, Facility Portal, Admin Console, and Public Site) and a high-performance, compliant API backend handling maternal and child health records. We need:

1. Strict type sharing (Zod schemas, FHIR R4 interfaces, DTOs) between API and Web clients.
2. High-throughput, non-blocking I/O for secure document streams and high concurrency OTP/QR access.
3. Fastify HTTP engine on NestJS for superior performance over Express.
4. Single source of truth for the "Warm Clinical Editorial" design tokens and accessible UI primitives.

## Decision

1. **Monorepo**: Turborepo with pnpm workspaces. Enforces atomic commits, shared dependency deduplication, and cached build pipelines.
2. **Web**: Next.js 15+ App Router, React 19, Tailwind CSS, TanStack Query, React Hook Form + Zod.
3. **API**: NestJS modular monolith on Fastify (`@nestjs/platform-fastify`), OpenAPI auto-generation.
4. **Data & Cache**: PostgreSQL 16 with Row-Level Security, Redis 7 for BullMQ queues and rate limiting, MinIO for S3-compatible envelope-encrypted storage.
5. **Security & Identity**: Keycloak OIDC with MFA, ClamAV antivirus scanning, Cerbos/RBAC consent-aware policy enforcement.

## Consequences

- Shared Zod schemas ensure runtime contract alignment between frontend and backend.
- Turborepo parallelizes build, lint, and test tasks with remote and local caching.
- Fastify provides 2-3x higher requests/sec compared to default Express setups.
