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
<http://localhost:8080/realms/mediqr/.well-known/openid-configuration>.
Patients sign in with OTP. Staff sign in through Keycloak at
<http://localhost:3000/login/clinician>, with the realm's required MFA setup.

### Link a fake local clinician account

The API needs a local clinician profile linked to the Keycloak user's subject
before it can resolve staff access. For local development only, create a
Keycloak user in the `mediqr` realm, assign the `clinician` realm role, and
complete MFA enrollment. Use an email ending in `@mediqr.invalid`; do not use a
real clinician identity. In the Keycloak user details, copy the user's ID.

Set the copied ID and the fake email used on that Keycloak user in PowerShell,
then run the provisioning command:

```powershell
$env:DEV_CLINICIAN_KEYCLOAK_ID = "<Keycloak user ID>"
$env:DEV_CLINICIAN_EMAIL = "clinician.dev@mediqr.invalid"
pnpm --filter @mediqr/api provision:dev-clinician
Remove-Item Env:DEV_CLINICIAN_KEYCLOAK_ID
Remove-Item Env:DEV_CLINICIAN_EMAIL
```

The command creates or links an active local clinician user and a clearly fake,
unverified profile in one database transaction. It does not set or reset a
Keycloak password, create a login bypass, or mark the profile verified. It
refuses production, non-fake email addresses, account mismatches, and verified
profiles. It is safe to rerun for the same unverified account.

Now open <http://localhost:3000/login/clinician>, sign in with the Keycloak
username and password you created, and complete the MFA prompt. A successful
login for this development profile should show the pending-verification screen,
not patient records. Only a platform administrator can verify a clinician
through the application. Until that review is completed, the account must not
access patient data.

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
