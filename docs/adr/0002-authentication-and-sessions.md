# ADR 0002: Authentication and Session Strategy

## Status

Accepted

## Date

2026-10-04

## Context

MediQR has distinct identity and assurance requirements for patients and
healthcare staff. Patient sign-in uses a phone-based one-time password, while
clinicians and staff require managed identity, stronger authentication, and
centralized MFA policy. Access must be revocable before a short-lived access
token expires.

## Decision

1. **Patients** authenticate through the API using phone OTP. The API stores
   session state server-side and checks that state on every authenticated
   request. Refresh-token values are stored only as hashes; logout and
   logout-everywhere revoke sessions immediately.
2. **Clinicians, facility administrators, pharmacy staff, and platform
   administrators** authenticate through Keycloak OIDC. Staff sign-in requires
   MFA (TOTP or WebAuthn) through a Keycloak authentication flow or required
   action.
3. The API validates staff access-token signatures using the realm JWKS and
   accepts only RS256. It validates issuer, audience or authorized party, and
   token time claims. JWKS keys are cached and refreshed to support rotation.
4. Keycloak role claims are not the authorization source of truth. The API
   resolves the local user, role, account status, and verification state from
   the database, then applies the central policy layer. Clinician patient-data
   access remains denied until the required consent capability is implemented.
5. OIDC access tokens and patient application tokens are carried only in
   secure, HttpOnly, SameSite=Strict cookies. Tokens are never stored in
   browser local storage.

## Consequences

- Patient session revocation takes effect on the next API request, independent
  of access-token expiry.
- Staff authentication is administered centrally by Keycloak, while local
  database and policy checks remain authoritative for MediQR permissions.
- Keycloak availability and correct realm/JWKS configuration are required for
  staff authentication; policy failures continue to deny access.
- Patient OTP and staff OIDC flows remain distinct and can be tested
  independently against their respective identity services.
