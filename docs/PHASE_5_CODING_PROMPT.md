You are implementing Phase 5 — Persisted Goal Management API of
the Personal Calorie Tracker take-home assignment.

Implement and verify ONLY Phase 5, then stop.

1. READ AND INSPECT FIRST

Read:
- Original assignment.
- Approved PRD.md, HLD.md and LLD.md.
- REQUIREMENT_TRACEABILITY.md.
- IMPLEMENTATION_ROADMAP.md.
- README.md.
- Phase 3 and Phase 4 verification reports.
- Applicable repository instructions.

Inspect actual files, package scripts, dependencies, Git status and
relevant working-tree changes before editing.

Reported baseline:
- Repository: /home/rakeshnaidu/rakesh_linux/NutriTrack, WSL.
- Branch main; HEAD 285a822.
- Phase 3 and Phase 4 work remains uncommitted.
- Server tests: 89 passed.
- PostgreSQL integration tests: 13 passed.
- Carried-forward client tests: 1 passed.
- Phase 4 reported PASSED.
- Meal CRUD, filtering, pagination, date validation, shared pool,
  migrations, profile API, centralized errors and security middleware
  already work.
- Meal mutation JSON limit: 65,536 bytes.
- Unrelated API JSON limit: 100,000 bytes.
- Leading-zero paging values are accepted and normalized.
- Tests use existing server/.env and randomized owned schemas.
- certs/ and the unrelated personal .gitignore entry must be preserved.
- server/.env.example was sanitized after credential-shaped values
  were discovered.
- No remote push occurred.

Treat this as reported evidence, not permission to assume unseen code.
Do not reset to HEAD and erase the uncommitted implementation.

Preserve existing work, environment files, approved documents and
unrelated changes. Do not switch branches, rewrite history, stage
unrelated hunks or push remotely.

Comments are REQUIRED. Code must remain easy to understand and explain.

2. OBJECTIVE AND REQUIREMENTS

Implement reading and replacing the current persisted nutrition and
weight goals through two backend endpoints.

Requirements:
- FR-001: goal management.
- FR-016: database persistence.
- NFR-001/002: authoritative validation and reliable errors.
- NFR-003/004/005: clean modular code, documentation and comments.
- Preserve existing security and database boundaries.

This phase implements goal APIs only.
The goals UI belongs to Phase 6.

3. REUSE THE EXISTING DATABASE MODEL

Use the existing goals singleton row with id = 1.

Fields:
- daily_calories_kcal
- daily_protein_g
- daily_carbs_g
- daily_fat_g
- target_weight_kg
- Existing server-owned timestamps.

The row already exists from the migration, initially with all five
targets NULL.

Do not:
- Add a new table or migration without demonstrating a real defect.
- Modify an applied migration.
- Reset or reseed application goals.
- Add goal history, effective dates, ownership or account fields.
- Add actual weight measurements or weight-progress calculations.

Use the existing shared pg.Pool, parameterized SQL and safe
database-error handling.

4. EXACT INPUT CONTRACT

PUT requires all five keys:

{
  "daily_calories_kcal": 2000,
  "daily_protein_g": 120,
  "daily_carbs_g": 250,
  "daily_fat_g": 65,
  "target_weight_kg": 70
}

Every field is required but nullable.

Validation:
- daily_calories_kcal:
  null or a finite number greater than 0 and <= 1,000,000.
- target_weight_kg:
  null or a finite number greater than 0 and <= 1,000,000.
- Protein/carbohydrate/fat goals:
  null or a finite number between 0 and 1,000,000 inclusive.
- Numeric values permit at most four decimal places.
- Strict object: reject unknown fields and missing keys.
- Reject client-supplied id, timestamps, owner IDs and history fields.
- Reject numeric strings, blank strings, booleans, arrays and objects
  where numbers/null are expected.
- Do not coerce null or blanks to zero.
- Reject excess precision before PostgreSQL rounds it.

Reuse the proven numeric validation from Phase 4 where appropriate.
Do not create a second inconsistent precision policy or a generic
validation framework.

Units:
- Calories: kcal.
- Protein/carbohydrates/fat: grams.
- Target weight: kilograms.

All-null input is valid and means no goals configured:

{
  "daily_calories_kcal": null,
  "daily_protein_g": null,
  "daily_carbs_g": null,
  "daily_fat_g": null,
  "target_weight_kg": null
}

Zero macro targets are valid and distinct from null.
Zero calorie or weight targets are invalid.

Do not calculate recommended targets, infer weight loss, or enforce
a calorie-versus-macro formula.

5. API CONTRACT

GET /api/v1/goals

- No query parameters or application request body.
- Return 200, including before goals have first been configured.
- Unexpected query/body data follows the existing 422 rejection policy.
- Reading must not change timestamps or data.

PUT /api/v1/goals

- No query parameters.
- Require application/json, including ordinary charset parameters.
- Validate the complete five-field body.
- Replace all five targets in one atomic UPDATE.
- Set updated_at using the established database timestamp approach.
- Preserve id and created_at.
- Return 200 for both the first setting and later replacements.
- Explicit null clears a target.
- Missing fields fail; do not implement partial-update semantics.

Success response for both endpoints:

{
  "data": {
    "daily_calories_kcal": 2000,
    "daily_protein_g": 120,
    "daily_carbs_g": 250,
    "daily_fat_g": 65,
    "target_weight_kg": 70,
    "updated_at": "<actual UTC ISO timestamp>"
  }
}

Return exactly the five goal values plus updated_at inside data.
Do not expose the singleton ID, created_at or database details.

Serialize PostgreSQL NUMERIC values as finite JSON numbers while
preserving null. Reuse appropriate existing mapping helpers.

This is one current configuration:
- No POST, PATCH or DELETE goal API.
- No /goals/:id route.
- No list or history endpoint.
- No pagination for this singleton resource.
- No upsert or silent repair if the migrated row disappears.

A missing singleton is an internal persistent-state problem:
return safe 500 INTERNAL_ERROR and log bounded diagnostic context.
Do not synthesize a successful default response.

Use UPDATE ... WHERE id = $1 RETURNING ... with bound values.
No existence precheck or extra transaction is needed around one
atomic UPDATE.

Concurrent complete updates use last-committed-write behavior;
do not add versioning or collaborative locking.

6. ERRORS AND BODY PARSING

Reuse existing validation, request IDs and central error handling:

- 400 MALFORMED_JSON.
- 413 REQUEST_TOO_LARGE.
- 415 UNSUPPORTED_MEDIA_TYPE.
- 422 VALIDATION_ERROR.
- Identified database unavailability/timeout: established 503 codes.
- Missing singleton/unexpected failures: 500 INTERNAL_ERROR.

Do not expose SQL, connection URLs, credentials or raw errors.

Goals use the existing 100,000-byte JSON limit.
The meal-specific 65,536-byte limit remains unchanged.

Inspect parser order before mounting the routes.
Do not accidentally apply the meal limit to goals or reparse an
already-consumed request stream.

Correctly typed empty bodies fail required-input validation.
Unsupported media types fail appropriately.
Preserve established malformed-JSON behavior.

7. EXPECTED FILES AND IMPLEMENTATION ORDER

Expected focused files under server/src/modules/goals/:
- goal.routes.js
- goal.controller.js
- goal.service.js
- goal.repository.js
- goal.schemas.js

Adapt existing repository naming conventions.

A thin layer is acceptable when it has a clear responsibility;
do not add redundant wrappers solely to fill this list.

Modify:
- Existing app composition to mount goal routes.
- Focused tests and existing integration harness where necessary.
- README.md.
- docs/PHASE_5_VERIFICATION.md.

No new dependency or migration is expected.

Implementation order:
1. Inspect baseline and run relevant existing checks.
2. Implement goal schema and numeric/null serialization.
3. Implement parameterized singleton read/update.
4. Wire service/controller/routes and parser/validation behavior.
5. Add unit and real PostgreSQL integration coverage.
6. Run live isolated API checks and regressions.
7. Fix failures, update documentation and record evidence.

Required comments should explain:
- Why null differs from zero.
- Why PUT requires all five fields.
- Why the existing singleton is updated rather than recreated.
- Any non-obvious numeric serialization.

Keep comments meaningful and functions readable.

8. DATABASE TEST CONFIGURATION

Use existing server/.env as explicitly requested by the user.

Do not require:
- .env.test.
- TEST_DATABASE_URL.
- TEST_PG_CA_CERT_PATH.
- A differently named database.

Retain the existing randomized owned-schema harness:
- Every connection and test-server process uses the owned schema.
- No fallback to ordinary application tables.
- No test fixture writes to the actual diary or goals.
- Preserve application before/after protection checks.
- Stop owned processes and release clients before cleanup.
- Remove only schemas owned by the test run.

Do not weaken TLS or cleanup safeguards.

9. REQUIRED VERIFICATION

Unit/API validation:
- Valid five-field payload.
- All-null payload.
- Individual null clearing.
- Zero macro targets accepted.
- Zero calorie/weight targets rejected.
- Negative/out-of-range values rejected.
- Valid four-decimal values accepted; excess precision rejected.
- Numeric strings, blanks and booleans rejected.
- Every omitted required key rejected.
- Extra/server-owned keys rejected.
- Unexpected queries and GET bodies rejected.
- Malformed JSON and incorrect media type.
- Exact body-size boundary:
  valid JSON padded to 100,000 bytes accepted;
  100,001 bytes rejected.
- Existing meal 65,536-byte limit still enforced.
- Safe errors and request IDs preserved.

Real PostgreSQL integration:
1. Fresh owned schema yields one all-null goals row.
2. GET returns 200 with null fields and real updated_at.
3. PUT sets all five values and returns 200.
4. A later GET and independent DB read return the saved values.
5. Full replacement changes values and updates updated_at while
   preserving id/created_at.
6. Mixed null/numeric replacement clears only the explicitly
   null-valued targets in that complete payload.
7. All-null replacement clears all targets.
8. Invalid PUT leaves every stored field and timestamp unchanged.
9. GET does not modify timestamps.
10. Valid repeated PUTs keep exactly one row.
11. Restart the isolated application and verify persisted values
    remain; startup does not reset goals.
12. Test missing singleton in an isolated fixture: safe 500,
    no automatic insert. Restore/isolate the fixture afterward.
13. Ordinary application tables remain unchanged and all owned
    schemas/connections are cleaned up.

Use deterministic fixtures; do not add arbitrary sleeps to make
timestamp assertions pass.

Regression:
- Meal CRUD, filters, paging, date rules and limits remain intact.
- Profile API and timezone context remain intact.
- Shared-pool lifecycle, TLS, errors and security headers remain intact.
- Goal operations work without AI credentials.
- Do not implement reports to test future goal comparisons now.

10. COMMANDS AND LIVE PROBES

Follow:
IMPLEMENT → RUN → TEST → VERIFY → FIX → RE-TEST → REPORT

From repository root:

npm --prefix server run lint
npm --prefix server test
npm --prefix server run test:db
git diff --check
git status --short

Run dependency installation checks if manifests/lockfiles change.
Carry forward unchanged client checks explicitly; do not describe
them as freshly executed.

Against a disposable server routed to the owned test schema:
- GET goals.
- PUT the valid example.
- GET and verify.
- PUT mixed null/zero values.
- GET and verify.
- Submit an invalid PUT and confirm persistence is unchanged.
- PUT all-null goals.
- Restart the isolated server and GET again.

Record actual status codes, response fields and persistence evidence.

Ordinary application GET /api/v1/goals may verify live read wiring.
Do not overwrite actual application goals with test values.

No new frontend/browser workflow is required in Phase 5.
Unavailable Windows browser helpers alone are not a blocker for
this backend-only phase.

11. CREDENTIAL EXPOSURE FOLLOW-UP

The previous report identifies possible real credentials in a tracked
example file. Sanitizing the file is not credential rotation.

Keep this security item visible:
- Do not copy real values into examples, logs, reports or chat.
- Do not claim rotation occurred without provider/account evidence.
- Use established authorized credential-management access if available
  for the user's requested rotation.
- If that access is unavailable, report the required account-side action
  precisely rather than inventing replacement keys.
- Update ignored runtime configuration when authorized replacement
  credentials are available; do not overwrite unrelated settings.
- Verify affected connectivity after an actual rotation.
- Do not rewrite Git history without authorization.

This follow-up must not turn into an unrelated application redesign.
Report its status separately from goal API implementation evidence.

12. COMPLETION AND FINAL RESPONSE

Update README with:
- GET and PUT endpoints.
- Exact request/response examples.
- Full replacement semantics.
- Null versus zero rules.
- Units, bounds and precision.
- Current-only goals and no weight-history feature.
- Existing parser limit and safe isolated test workflow.

Write docs/PHASE_5_VERIFICATION.md.

Return:
1. Changes made: actual files and purpose.
2. Verification performed: action, expected, actual, PASS/FAIL;
   distinguish new, carried-forward and blocked checks.
3. Tests: actual passed/failed/skipped totals by suite.
4. Problems found.
5. Fixes applied.
6. Deviations: explanation or None.
7. Credential-rotation status: verified, outstanding or blocked,
   without exposing secret values.
8. Phase status: exactly PHASE 5 PASSED or PHASE 5 FAILED.

Only mark the phase passed when required goal API and regression
checks have actual passing evidence. Do not equate a phase pass with
final submission readiness while security follow-up remains open.

Preserve existing uncommitted work and unrelated .gitignore changes.
Report Git state truthfully; do not push remotely.

STOP after Phase 5.
Do not implement Phase 6 or generate its coding prompt.