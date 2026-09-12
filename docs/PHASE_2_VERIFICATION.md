# Phase 2 Verification

Status: **PHASE 2 PASSED**

Verified on 2026-09-12 in WSL Ubuntu 24.04 with Node.js 24.16.0 and
npm 11.13.0.

## Repository organization

Product requirements, architecture, detailed design, review, traceability,
roadmap, requirements analysis, and phase prompts are organized as Markdown
files under `docs/`. The root README remains the entry point.

## Implemented scope

- Strict startup validation for `PORT`, `NODE_ENV`, `CLIENT_ORIGIN`,
  `TRUST_PROXY_HOPS`, `DATABASE_URL`, and `PG_CA_CERT_PATH`.
- Optional Gemini and Grok key/model pairs represented as `disabled`,
  `configured`, or nonblocking `configuration_error` states.
- Server-generated UUID request IDs returned through `X-Request-ID` and the
  JSON error envelope.
- Central handling for malformed JSON (400), unknown routes (404), oversized
  JSON (413), request validation (422), and unexpected failures (500).
- Helmet defaults, disabled Express branding, exact-origin CORS, documented
  proxy trust, and a numeric 100,000-byte JSON limit.
- Generic strict Zod middleware for body, query, and params. Parsed data is
  placed in `res.locals.validated`; Express request objects are not mutated.
- Pure strict calendar-date utilities for validation, comparison, arithmetic,
  inclusive day counts, Monday-Sunday bounds, IANA-timezone today, and
  consumption-date checks.
- Import-safe application composition and process startup, safe failure
  messages, optional-provider warnings, and graceful shutdown.

## Reproducibility

Clean installs from both lockfiles completed successfully:

- Server: 170 packages audited, 0 vulnerabilities reported.
- Client: 183 packages audited, 0 vulnerabilities reported.

The installed direct server versions were:

- Express 5.2.1
- Zod 4.6.2
- Helmet 8.3.0
- CORS 2.8.6
- Supertest 7.2.2
- ESLint 10.10.0

## Automated verification

All final commands passed:

- `npm --prefix server run lint`
- `npm --prefix client run lint`
- `npm --prefix server test`: 35 passed, 0 failed, 0 skipped.
- `npm --prefix client test`: 1 passed, 0 failed.
- `npm --prefix client run build`: 24 modules transformed.
- `git diff --check -- README.md server`

The server suite covers configuration boundaries and redaction, provider
states, request-ID replacement, error status/code mapping, byte-accurate body
limits including multibyte input, strict validation, repeated and unknown query
values, valid and invalid UUID params, internal-error redaction, security
headers, CORS/preflight, headers-already-sent delegation, multipart behavior,
calendar/timezone cases, import safety, startup, and graceful shutdown.

## Live verification

Ordinary production startup succeeded on a nondefault port with synthetic
configuration, a nonexistent CA path, and an intentionally unreachable
PostgreSQL host. This confirms Phase 2 neither reads the CA file nor attempts a
database connection.

Live HTTP probes confirmed:

- Unknown API routes return 404 `ROUTE_NOT_FOUND` JSON.
- Malformed JSON returns 400 `MALFORMED_JSON`.
- Responses include server-generated UUID `X-Request-ID` values.
- The configured browser origin receives its exact
  `Access-Control-Allow-Origin` value.
- Helmet security headers are present and `X-Powered-By` is absent.
- SIGTERM closes the HTTP listener cleanly.

The built frontend was served by Vite preview on port 4173 and loaded through
the existing WSL Chromium binary. The root route rendered the expected
`Personal Calorie Tracker` heading with no JavaScript runtime-error
signatures.

## Startup failure checks

Missing core settings, malformed and out-of-range ports, unsupported
`NODE_ENV`, blank CA paths, invalid origins, malformed database URLs, and
database URL TLS overrides all fail before the listener opens. Errors report
field names without printing supplied values. Partial provider pairs warn
without exposing values and do not block startup.

## Scope boundary

Phase 2 does not create a PostgreSQL pool, read a certificate, connect to a
database or provider, run migrations, or add profile, goal, meal, report,
upload, or other domain endpoints. Those remain deferred to their specified
later phases.

## Environment note

The Node.js 24 watch supervisor in this WSL environment can assert if its
supervisor process is forcibly interrupted by the PTY. The application child
handles SIGTERM cleanly and releases its listener; ordinary `npm start`,
automated tests, production build, and Vite preview are unaffected.
