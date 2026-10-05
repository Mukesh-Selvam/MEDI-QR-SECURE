# Known security gaps

Last reviewed: 2026-10-04

## Runtime and key management

- The API's `LocalKmsAdapter` is development-only and fails startup in production. No cloud KMS adapter is implemented yet. Production deployment must wait until a managed KMS adapter, key rotation, and its integration tests are in place. See `apps/api/src/modules/vault/kms/local-kms.adapter.ts`.
- Production notification delivery is not implemented: production uses the `NoopNotificationEmailProvider`, and there is no SMS or push provider. Emergency-access delivery and the operational response to undelivered notifications must be implemented and tested before production use.

## Emergency access and affiliations

- Facility affiliation onboarding does not yet use named-staff invitations accepted by the invited staff member after a verified Keycloak MFA claim. The current affiliation flow associates existing user IDs and does not independently verify an observed MFA claim.
- Facility administration does not enforce last-administrator protection or require two active facility administrators before emergency eligibility.
- Suspending an affiliation makes subsequent emergency-summary authorization checks deny access, but does not persistently revoke existing grant rows or emit a grant-revocation audit event.
- Facility verification still needs an authoritative verification process and production evidence. A facility administrator cannot verify their own facility; verification status changes are restricted to platform administrators.
- Emergency-access abuse controls are incomplete: provider and patient rate caps, daily provider caps, anomaly detection (many patients, repeated attempts, and off-hours), and automatic suspension thresholds are not implemented.
- The admin console is incomplete: verification and break-glass review queues, review escalation, audit exploration, and audit-chain status visibility remain outstanding. Every grant must be reviewed within 24 hours; overdue escalation to a second platform administrator or compliance role is not yet implemented.
- Production end-to-end notification delivery, provider-side emergency-grant and summary E2E coverage, and operational verification of retry exhaustion remain required before production use.

## Dependency advisories

- `braces@3.0.3` remains a high-severity transitive development-dependency advisory (GHSA-vfj7-8cjw-p6xm). It is pulled in through development tooling such as Tailwind, `fast-glob`, and `lint-staged`; the package registry currently lists no patched release. Continue monitoring upstream and remove or replace affected dependency paths when a safe option is available.
- `pnpm audit` also reports three moderate advisories in development dependencies: vulnerable `esbuild@0.18.20` through Drizzle Kit's legacy ESM loader, and the API/schema test stack's `vitest@3.2.7` and `@vitest/mocker@3.2.7`. The production-only audit reports no advisories. Upgrade these toolchains when compatible patched versions are available and confirm the lockfile no longer resolves vulnerable versions.

## pnpm supply-chain policies

- `blockExoticSubdeps: true` is enabled. `minimumReleaseAge: 10080` was removed because frozen installation rejected 104 existing lockfile entries published inside the seven-day window. `trustPolicy: no-downgrade` was removed because it rejected three existing lockfile resolutions. These policies should be reconsidered after reviewing and refreshing the lockfile, rather than bypassing the verification failures.

## Static analysis

- The completed Semgrep scan found no production-code findings. Two `ERROR` findings are plaintext HTTP requests to loopback Mailpit endpoints in integration/browser tests: `apps/api/src/modules/auth/__tests__/otp-login.int.spec.ts:238` and `apps/web/e2e/auth.spec.ts:579`. These target local test infrastructure, not production endpoints; keep them loopback-only.
- Semgrep reports two `MEDIUM` configuration findings because the pnpm minimum-release-age and trust-policy settings are currently absent. Their remediation is tracked above.
- The workflow YAML parsed successfully, but `actionlint` was unavailable locally and its Docker image could not be pulled in this environment.

## Secret scanning

- The 31 historical Gitleaks matches were classified as test/example placeholders and ignored by exact finding fingerprints in `.gitleaksignore`. A rerun reports zero unignored historical matches. This does not suppress newly introduced findings at those paths or any other paths.
