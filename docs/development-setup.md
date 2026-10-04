# Local development setup

## Requirements

- Windows with Docker Desktop running (or Docker Engine on Linux/macOS)
- Node.js 22 and pnpm 12.8.1
- Git

## First-time setup

From the repository root:

```powershell
pnpm install
Copy-Item .env.example .env
```

Edit `.env` locally. Replace every `<replace-with: ...>` entry with a value of
the required format, and change the example database, Redis, and MinIO
credentials. Keep secrets in `.env`; do not paste them into chat, commit them,
or print them in build logs. For the database and Redis passwords, hexadecimal
random values are convenient because they are URL-safe:

```powershell
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24)).ToLowerInvariant()
```

`MASTER_ENCRYPTION_KEY` and `KMS_MASTER_KEY` must each be 64 hexadecimal
characters. Session, JWT, and HMAC secrets must meet the minimum lengths in
`apps/api/src/config/env.ts`. The imported `mediqr-web` Keycloak client is
configured as a public client using the authorization-code flow with PKCE; the
API does not use a Keycloak client secret or service account.
Patient approval creates a scoped clinician consent that expires after
`ACCESS_CONSENT_TTL_HOURS` (24 hours by default, configurable from 1 to 168).
Patients and verified guardians can review pending requests and revoke an
active consent from `/patient/access`. In-person approval codes expire after
two minutes and are single-use.

Start the development infrastructure, including Postgres, Redis, MinIO,
ClamAV, Mailpit, and Keycloak:

```powershell
pnpm infra:up
```

Wait until Postgres is healthy, then apply every pending Drizzle migration and
insert the idempotent, fake development user:

```powershell
pnpm db:setup
```

The command is safe to rerun. It does not create a patient with real personal
information; OTP login creates or resolves a local patient-role user when a
valid code is verified.

Start the API and web application:

```powershell
pnpm dev
```

Open <http://localhost:3000/login/patient>, request an OTP, and read the
development message at <http://localhost:8025>. The development mail provider
routes OTP messages to Mailpit; it does not send SMS to the phone number. Enter
the code before its five-minute expiration.

The Keycloak realm is imported and its discovery endpoint is available at
<http://localhost:8080/realms/mediqr/.well-known/openid-configuration>. The
current mobile OTP handler provisions the application user in Postgres and
issues the application session locally. The API validates its own locally
signed application tokens; it does not yet validate Keycloak staff tokens or
provision Keycloak users.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int
```

`pnpm test:int` requires the Postgres, Redis, MinIO, ClamAV, Mailpit, and
Keycloak containers to be running. The OTP integration test checks that the
facility relationship migration is present before it sends or verifies a
code, so a database with unapplied migrations fails the test.
