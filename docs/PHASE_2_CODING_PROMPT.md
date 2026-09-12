You are implementing Phase 2 — Backend Configuration, Validation and Error Infrastructure of the Personal Calorie Tracker.

Implement and verify ONLY Phase 2, then stop.

## 1. Read and inspect first

Read the original assignment, project analysis, approved PRD.md/HLD.md/LLD.md, REQUIREMENT_TRACEABILITY.md, IMPLEMENTATION_ROADMAP.md, README.md, docs/PHASE_1_VERIFICATION.md and applicable repository instructions. Locate supplied documents without changing them.

Inspect actual code, scripts, dependencies, Git status and recent commits before editing. The user's reported baseline is:

- Repository: /home/rakeshnaidu/rakesh_linux/NutriTrack, in WSL.
- Current branch: main; Phase 1 commit: 9cf0f3e, chore: establish phase 1 foundation.
- Node v24.16.0; npm 11.13.0.
- Separate React/Vite and Express packages with lockfiles.
- Import-safe app, graceful lifecycle, validated PORT, responsive root route.
- Server tests: 5 passed; client tests: 1 passed; lint/build/browser checks passed.
- Planning documents remain unchanged and untracked; nothing was pushed remotely.
- WSL Chromium was available for browser checks; desktop helpers failed. PTY watch-supervisor termination had an issue, but targeted application SIGTERM and port release passed.

These are reported facts to verify against the repository, not permission to assume file contents. Do not reset to the reported commit if newer work exists. Preserve current work, the branch and untracked planning documents. Do not rewrite history, stage unrelated documents, push remotely or create a branch merely for this phase.

Original assignment and fixed decisions govern; approved designs supersede older recommendations. Comments are REQUIRED. If an essential document is missing, report it rather than inventing its contract. Resolve ordinary implementation details simply; explain genuine conflicts.

## 2. Objective and requirement coverage

Extend the passing foundation with validated configuration, safe HTTP errors, server-generated request IDs, configured CORS/Helmet, bounded JSON parsing, reusable Zod request validation and deterministic calendar helpers.

Coverage: foundations for FR-015/017/018; NFR-001/002/006/008; continuing clean/modular code, documentation and comments under NFR-003/004/005.

No database connection or business feature is completed in this phase.

## 3. Implement in order

### A. Capture the baseline

Run existing server/client tests and lint, and inspect the Phase 1 evidence. Record pre-existing failures separately. Preserve the import-safe app/process boundary and working lifecycle.

### B. Extend configuration

Use Zod 4 and focused functions in server/src/config/env.js. Read process environment at startup, not as an import-time requirement of reusable modules. Pass validated configuration to app composition. Tests supply isolated objects; do not mutate global process.env across concurrent tests.

Core configuration:
- PORT: preserve Phase 1 default 3000 and strict integer range 1–65535.
- NODE_ENV: development by default; allow development/test/production.
- CLIENT_ORIGIN: required single http(s) origin; reject credentials, meaningful paths, query, fragment, wildcard and lists. Normalize an optional root slash consistently.
- TRUST_PROXY_HOPS: default 0; nonnegative integer; reject blank/invalid values. Configure Express accordingly; never enable unrestricted trust proxy.
- DATABASE_URL: required, valid PostgreSQL URI with hostname and database name. Accept postgres: or postgresql:. Reject conflicting SSL query options that can override explicit TLS, including sslmode, sslcert, sslkey and sslrootcert. Do not log the URI or credentials.
- PG_CA_CERT_PATH: required nonempty path configuration.

Staged boundary: Phase 2 validates database configuration syntax only. Reading/parsing the CA, verifying TLS, opening the pool and proving connectivity belong to Phase 3. Document this distinction explicitly. Tests/startup checks may use a clearly identified synthetic PostgreSQL URI and placeholder CA path because no connection/file read occurs yet. This is not evidence of working Aiven integration. Do not add a skip-validation or skip-database mode.

Provider configuration is evaluated separately:
- Gemini pair: GEMINI_API_KEY and GEMINI_MODEL.
- Grok pair: XAI_API_KEY and GROK_MODEL.
- Both absent: disabled.
- Both supplied and nonblank: configured locally; availability remains unverified.
- Partial or invalid pair: configuration-error state, without failing core startup.
- Never turn Grok into primary because Gemini configuration is absent/broken.
- Do not call providers, validate live model access or add provider SDKs now.
- Keep secrets backend-only. Do not expose the configuration object through HTTP.

Select only intended env keys before strict schema validation; unrelated operating-system environment variables must not make startup fail. Missing/invalid core settings cause a safe nonzero startup failure naming fields, never raw input values. Optional provider failure does not prevent the HTTP application from starting with valid core configuration.

Update server/.env.example and README with safe placeholders and the staged validation boundary. Do not overwrite an existing .env. Keep the client's public configuration unchanged unless a documented correction is necessary.

### C. Implement request IDs and centralized errors

Generate a fresh request ID server-side for each request. Do not trust/echo an inbound X-Request-ID. Return the ID in X-Request-ID and error JSON. Make IDs available to safe diagnostic logging.

Implement this LLD envelope:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the highlighted fields.",
    "details": [{"field": "example_field", "message": "Invalid value."}],
    "request_id": "server-generated-id"
  }
}

details is always an array. Field paths use dot notation; a whole-request error uses an empty field string. Avoid echoing rejected values in messages.

Implement the statuses exercised now:
- 400 MALFORMED_JSON.
- 404 ROUTE_NOT_FOUND.
- 413 REQUEST_TOO_LARGE.
- 422 VALIDATION_ERROR.
- 500 INTERNAL_ERROR for unexpected failures.

Use a small trusted application-error representation, not an elaborate exception hierarchy. Never expose an arbitrary error's message/status as a trusted client error. Map parser failures explicitly; malformed user JSON is not the same as an internal JSON parsing bug. Unexpected sync/async errors return a generic message. If headers are already sent, delegate appropriately rather than attempting another JSON response.

Diagnostics must not dump process.env, database URLs, SQL, keys, image bytes, complete request bodies or raw error objects that may contain them. Log request ID, safe code and bounded diagnostic context. Tests should verify response and logging redaction with synthetic sentinel secrets.

### D. Add HTTP infrastructure

Use focused cors and helmet dependencies with committed lockfile updates. Keep the order:
1. Request ID.
2. Helmet and configured CORS.
3. Bounded JSON parser on the /api/v1 JSON surface.
4. Route validation/handlers when mounted.
5. Unknown-route handler.
6. Central error handler.

Use a numeric JSON body limit of 100,000 bytes as this phase's documented implementation choice. It is separate from the later 10,000,000-byte multipart image-file limit. Do not parse multipart bodies as JSON or implement uploads now.

CORS:
- Emit Access-Control-Allow-Origin only for the configured browser origin.
- Handle allowed-origin OPTIONS preflight.
- Support the planned GET/POST/PUT/DELETE/OPTIONS methods and Content-Type.
- Expose X-Request-ID to the allowed frontend origin.
- Do not enable cookie credentials; there is no authentication.
- Requests from disallowed origins receive no CORS permission headers; do not invent an unapproved 403 error contract solely for CORS.
- Requests without Origin remain usable by curl/server clients.
- CORS is a browser response-reading policy, not private-data access control.

Do not add public debug, echo, crash or health routes. Keep the frontend root page unchanged.

### E. Add reusable request validation

Implement a small schema-driven helper for body/query/params using strict Zod object schemas. Keep validated output in a clear location such as res.locals.validated. Do not assign to Express 5's getter-only req.query.

Validation failures produce 422 with safe field details and do not call the next business handler. Successful validation supplies parsed data. Internal schema/programming failures must become 500, not be mislabeled user mistakes.

Do not blanket-coerce body numbers: null, empty strings and numeric strings must not become valid numeric values accidentally. Where a schema explicitly permits null, preserve it; preserve zero separately. Query-string parsing must be explicit in the schema. Do not build meal, goal, paging, report or AI feature schemas yet.

### F. Implement shared calendar helpers

Use server/src/utils/calendar.js with small pure functions and explicit inputs. Implement:
- Strict real YYYY-MM-DD Gregorian date validation for years 1900–9999.
- Calendar-day comparison/arithmetic and inclusive range length.
- Reversed-range rejection.
- Monday/Sunday week bounds.
- Derivation of today from an injected instant and supplied IANA timezone using Intl date parts.
- A reusable check for consumption date <= captured today.

Capture the instant once per operation. In this phase timezone is a helper input; test Asia/Kolkata as the approved initial profile timezone. Persisted profile lookup and its API belong to Phase 3. Do not add a timezone env setting, fake profile or database dependency.

Use UTC only as a date-arithmetic container when helpful; do not reinterpret a diary date as a consumption timestamp. Reject invalid rollover dates. Do not depend on process timezone, browser timezone, locale string formatting or database CURRENT_DATE.

Queries may include future bounds; only the separate consumed-date check prohibits future consumption. Do not apply a global future-date prohibition to range validation. If arithmetic exceeds the supported date domain, fail explicitly instead of wrapping/truncating.

Add comments explaining timezone derivation, date-only arithmetic, inclusive endpoints and why future range bounds differ from future consumption.

## 4. Expected files

Adapt actual existing paths; do not duplicate equivalent modules:
- server/src/config/env.js and a small constants.js if used.
- server/src/app.js and server/src/server.js.
- server/src/utils/errors.js and calendar.js.
- Focused server/src/middleware/ files for request IDs, request validation, not-found and centralized errors.
- server/tests/ configuration, middleware/error, calendar and startup checks, with test-only helpers as necessary.
- server/package.json/package-lock.json, server/.env.example.
- README.md and docs/PHASE_2_VERIFICATION.md.

Do not modify unrelated client files or approved planning documents. Do not create empty future feature modules.

## 5. Required tests and exact expectations

Use Node's test runner and Supertest already present. Test real production middleware in a test-only Express harness with fixture routes for validation and sync/async errors. Ensure the harness uses the same middleware composition/order as the application. Fixture routes must never be reachable in the shipped app, even under NODE_ENV=test. Prefer a small ordinary composition boundary over a generic dependency-injection framework.

Configuration cases:
- Defaults and valid overrides; all earlier PORT boundaries.
- Missing/invalid core settings and conflicting SSL URI options.
- Unrelated process env keys do not break parsing.
- No provider pairs, valid pairs and partial/blank pairs.
- Valid core startup works with absent or invalid provider configuration.
- No import-time listener, filesystem CA read, DB connection or provider call.

HTTP cases:
- Unknown actual API route -> 404 ROUTE_NOT_FOUND JSON.
- Body request_id equals response X-Request-ID; incoming forged ID is replaced.
- Malformed JSON -> 400; oversized JSON -> 413.
- Strict schema failure -> 422; rejected handler is not called.
- Valid fixture payload preserves null versus zero and supplies parsed data.
- Unknown keys, wrong types and repeated query values fail when the fixture schema disallows them.
- Sync throw and rejected async handler -> generic 500 with no sensitive leakage.
- Helmet headers present; X-Powered-By absent.
- Allowed-origin actual request/preflight includes correct CORS headers.
- Disallowed origin has no Access-Control-Allow-Origin; no-Origin request still works.
- JSON parser respects the byte limit, including multibyte input, and does not parse multipart as JSON.
- Fixture/debug routes are absent from the production app.

Calendar fixtures:
- 2024-02-29 valid; 2025-02-29, 2026-02-30 and 2026-13-01 invalid.
- Malformed strings and years outside 1900–9999 invalid.
- 2026-09-12 through 2026-09-12 contains 1 inclusive day.
- 2026-09-07 through 2026-09-13 contains 7 days; reversed range fails.
- Sunday 2026-09-13 belongs to 2026-09-07 through 2026-09-13.
- Monday 2026-09-14 belongs to 2026-09-14 through 2026-09-20.
- Instant 2026-09-12T20:00:00Z in Asia/Kolkata yields today 2026-09-13.
- Leap-day, month/year transitions and invalid timezone handling.
- Under fixed today 2026-09-12, consumed date 2026-09-13 fails, while a query ending 2026-09-13 is valid.
- Explicit-timezone results are unchanged when process TZ changes; test via isolated child processes if necessary.

Do not claim meal persistence, report mathematics or actual provider fallback has been verified by these foundation tests.

## 6. Run and verify

Follow IMPLEMENT -> RUN -> TEST -> VERIFY -> FIX -> RE-TEST -> REPORT.

After installing current-phase dependencies, run from the repository root:

```bash
node --version
npm --version
npm --prefix server ci
npm --prefix client ci
npm --prefix server run lint
npm --prefix client run lint
npm --prefix server test
npm --prefix client test
npm --prefix client run build
git diff --check
git status --short
```

Use valid Phase 2 core configuration in an isolated environment for startup checks. Do not overwrite existing .env or disclose real settings. Document a safe synthetic setup in the verification report. The former PORT-only startup expectation intentionally evolves into full core configuration validation; missing required core settings now fails, while optional AI settings remain nonblocking.

Run server dev/start separately, stopping each before reusing the port. With server running:

```bash
curl -i http://localhost:3000/api/v1/phase-2-unknown
curl -i -H 'Origin: http://localhost:5173' http://localhost:3000/api/v1/phase-2-unknown
curl -i -H 'Origin: https://unapproved.example' http://localhost:3000/api/v1/phase-2-unknown
curl -i -X OPTIONS -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: Content-Type' http://localhost:3000/api/v1/phase-2-unknown
curl -i -X POST -H 'Content-Type: application/json' --data-binary '{' http://localhost:3000/api/v1/phase-2-unknown
```

Use CLIENT_ORIGIN=http://localhost:5173 for these checks. Expected: unknown route JSON 404, correct allowed/disallowed-origin behavior, successful allowed preflight and malformed JSON 400 before the not-found handler. Verify 413 and fixture validation/errors in automated tests without adding production test endpoints.

With otherwise valid core config, repeat invalid PORT, custom port, occupied port and clean SIGTERM checks. Verify missing core config fails safely and absent/partial AI pairs do not stop startup. Use the known WSL Chromium path if appropriate for frontend dev/preview regression checks; record real outcomes. Do not kill unrelated processes or conflate a watch-supervisor PTY failure with an application shutdown result.

Fix failures and rerun affected checks. Keep the previous browser page, build, lint and import/lifecycle behavior passing. Update earlier tests only for intended contract evolution, such as JSON 404 and required core configuration; do not delete assertions to hide regressions.

## 7. Scope, quality and completion rules

- Only this phase; no pg installation/pool, migrations, DB queries, profile endpoint, CRUD, paging, goals, reports, uploads or AI integrations.
- No mandatory authentication, bonuses, queues, ORM or unnecessary framework.
- Clean names, focused modules and readable functions that the author can explain.
- Comments must explain important decisions; README must match working commands and staged capabilities.
- Secrets stay backend-only and out of responses/logs/reports/commits.
- No fixed target test count or fake coverage; report actual tests and outcomes.
- No Phase 3 implementation or coding prompt.

Write docs/PHASE_2_VERIFICATION.md. Phase 2 passes only when required checks have actual passing evidence and no unresolved mandatory blocker. If a required environment/tool check is unavailable, continue useful authorized work, identify what remains unverified and do not claim a passed phase.

## 8. Final response format

1. Changes made: files and purpose.
2. Verification performed: action, expected result, actual result and PASS/FAIL for each check; identify blocked checks.
3. Tests: passed/failed/skipped totals for server and client.
4. Problems found.
5. Fixes applied.
6. Deviations: explain genuine deviations; write None. if none. Record intentional staged changes separately.
7. Phase status: exactly PHASE 2 PASSED or PHASE 2 FAILED. If failed, list blockers.

Report branch and commit state truthfully; do not claim a commit/push happened unless it did. STOP after Phase 2.

Technical references for implementation-time checks: [Express 5 migration guidance](https://expressjs.com/en/guide/migrating-5/) documents req.query and async error behavior; [CORS middleware guidance](https://expressjs.com/en/resources/middleware/cors/) documents origin configuration and the browser enforcement boundary.
