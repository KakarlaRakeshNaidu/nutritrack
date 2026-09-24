# Multi-user production rollout

This is an operator runbook only. It was not executed while implementing the
feature.

## Before maintenance

1. Schedule a maintenance window that prevents the old server from writing
   while the ownership migration is applied.
2. Take and verify a restorable PostgreSQL backup.
3. Preserve the currently deployed application artifact and environment
   configuration for incident analysis; do not assume it can run on the new
   schema.
4. Generate an unpredictable JWT_SECRET of at least 32 characters and choose
   SESSION_TTL_HOURS (24 by default, accepted range 1-720).
5. Set CLIENT_ORIGIN to the exact browser origin and configure
   TRUST_PROXY_HOPS for the real proxy depth.
6. Decide the cookie topology. The implementation uses HttpOnly
   SameSite=Lax without Secure in development and HttpOnly Secure
   SameSite=None in production. Prefer serving the API same-site with the
   client, or route /api to the existing backend through a same-origin reverse
   proxy. Validate cookie behavior in the browsers you support.
7. Optionally configure all of SMTP_HOST, SMTP_PORT, SMTP_USER,
   SMTP_PASSWORD, and SMTP_FROM. Leaving all absent disables Nodemailer welcome
   messages. SMTP is not email verification.
8. Keep Gemini configuration unchanged. Never expose JWT, SMTP, database, or
   Gemini secrets through VITE-prefixed variables.

## Ordered rollout

1. Put the application in maintenance mode and stop the old server.
2. Confirm the backup and intended database target.
3. Install locked server/client dependencies and build the candidate.
4. Run `npm --prefix server run db:migrate` once, then a second time to
   confirm no pending migration. Migration 002 creates users and auth sessions,
   converts profile/goals/meals to per-user ownership, and assigns all existing
   records to the reserved non-login legacy owner.
5. Start the new server with JWT_SECRET, SESSION_TTL_HOURS, exact
   CLIENT_ORIGIN, database/TLS values, and optional complete SMTP settings.
6. Deploy the matching client with the intended API base URL or same-origin
   /api proxy.
7. Verify signup, login, /auth/me, one user-scoped read, logout, and a second
   user's empty diary. Confirm cookies, CORS, CSRF Origin checks, and proxy IP
   resolution from the public topology.
8. After an operator has created the intended account and before that account
   changes its default data, assign preserved records only if required:
   `npm --prefix server run db:assign-legacy -- user@example.com`.
   The command refuses a missing account or any target with changed profile,
   goals, or meals; it performs no merge.
9. Verify the assigned account and keep the backup through the acceptance
   period.

## Rollback and recovery

Migration 002 drops the old singleton ID columns and requires user ownership.
The old application was not verified against that schema and must not be
started after migration. A rollback therefore requires either:

- restoring the pre-migration database backup and redeploying the old
  application artifact; or
- keeping the new schema and deploying a separately tested forward-compatible
  corrective release.

Do not try to roll back only the application binary. Do not manually delete the
reserved legacy owner or bypass assignment preconditions. If SMTP fails, leave
accounts intact, correct SMTP separately, and do not imply that email ownership
was verified.

## Operations after rollout

Monitor safe request/error codes rather than request bodies or cookies. Session
rows expire logically at their timestamp and are revoked at logout; a later
housekeeping policy may delete old rows without changing authentication
semantics. Rotate JWT and SMTP secrets through the hosting provider's normal
secret-management process. Rotating JWT_SECRET invalidates all issued JWTs and
requires users to sign in again.
