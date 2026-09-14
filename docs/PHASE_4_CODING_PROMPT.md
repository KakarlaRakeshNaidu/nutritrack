You are implementing Phase 4 — Meal CRUD, Filtering and Pagination APIs of the Personal Calorie Tracker take-home assignment.

Implement and verify ONLY Phase 4, then stop.

## 1. Read and inspect before editing

Read the original assignment, approved PRD.md/HLD.md/LLD.md, REQUIREMENT_TRACEABILITY.md, IMPLEMENTATION_ROADMAP.md, README.md, Phase 1–3 verification reports, latest Phase 3 continuation instructions and applicable repository instructions. Inspect actual source, package scripts, lockfiles, Git status and the entire relevant working-tree diff.

Reported baseline, which you must verify against the actual repository:
- Repository: /home/rakeshnaidu/rakesh_linux/NutriTrack in WSL; branch main.
- HEAD remains 285a822. Phase 3 implementation is present as uncommitted changes, not absent merely because HEAD still identifies Phase 2.
- Phase 3 reported PASSED: server 67, real PostgreSQL integration 10, carried-forward client 1; 78 passed, 0 failed, 0 skipped.
- Existing infrastructure: strict env configuration, request IDs, safe errors, Helmet/CORS, res.locals validation, calendar helpers, verified Aiven TLS, shared pg.Pool, transaction helpers, migrations and read-only profile API.
- Application migration ran once; second run was a no-op. Singleton values/timestamps and migration metadata remained unchanged.
- Live profile/status/security/date checks, restart persistence and cleanup passed; no test schemas remained.
- Tests now intentionally reuse server/.env, with randomized owned-schema routing on every connection and application-table protection checks.
- certs/ is ignored. Preserve the unrelated personal .gitignore entry and all other existing work.
- Provider database name is not app-branded but matches the user-designated DATABASE_URL; its name is not a reason to reject or rename it.
- Client checks were carried forward. Windows browser helper was unavailable; earlier client lint/test/build and WSL preview passed. Do not claim a new browser verification from those earlier results.
- No remote push; do not reset, clean, overwrite, amend, switch branch or stage unrelated hunks.

Follow the latest explicit user instruction: use the existing .env and isolated test schemas. Do not reintroduce a mandatory .env.test, TEST_DATABASE_URL, TEST_PG_CA_CERT_PATH or separate-database requirement. Do not print secrets or overwrite environment files.

The original assignment and fixed decisions govern. Comments are REQUIRED. Preserve working modules and reuse established patterns. Resolve ordinary unspecified implementation details simply; explain genuine contradictions instead of silently redesigning.

## 2. Objective and requirements

Implement the complete meal REST API with authoritative validation, persisted consumed-total nutrition, full replacement updates, physical deletion, inclusive date/meal-type filtering and deterministic backend pagination.

Coverage: FR-002/003/004/005/006/007/016; NFR-001/002/006/008; continuing clean/modular code, README and required comments under NFR-003/004/005.

Deliver only backend meal workflows. The goals table and profile API already exist, but goal management, frontend meal workflows, reports and AI remain later phases.

## 3. Inspect and preserve the database boundary

Reuse the existing meals table and migration. Do not recreate tables, reseed singletons, edit an applied migration or reset real data. Read LLD sections 2–4, 8, 10–11, 18 and 25 for authoritative contracts.

Use one shared pool supplied by the current app composition. No repository/controller may create another pool. Keep verified TLS, DATE string parsing, same-client transactions, safe errors and graceful shutdown intact.

The existing schema should support this phase without a new migration. If a real schema defect is discovered, demonstrate it first, explain the minimal correction, and use a new forward migration if necessary; never rewrite applied history.

All integration fixtures and mutation probes must use the existing owned-schema test harness on the configured connection, not ordinary application tables. Route every test connection, migration and spawned test server to its owned schema; preserve before/after checks and strict cleanup.

## 4. Exact writable meal contract

POST and PUT require ALL top-level fields shown below and ALL six micronutrient keys. Only the six micronutrient amounts may be null. Do not insert implicit defaults for omitted writable fields.

```json
{
  "food_name": "Example yogurt",
  "meal_type": "breakfast",
  "consumption_date": "2026-09-10",
  "consumed_quantity": 150,
  "quantity_unit": "g",
  "calories_kcal": 180,
  "protein_g": 9,
  "carbs_g": 27,
  "fat_g": 3,
  "micronutrients": {
    "sodium_mg": 0,
    "calcium_mg": 120,
    "iron_mg": null,
    "potassium_mg": null,
    "vitamin_c_mg": null,
    "vitamin_d_mcg": null
  },
  "entry_source": "manual",
  "is_estimate": false
}
```

Validation:
- Strict Zod objects: reject unknown top-level/nested keys, client-supplied id/created_at/updated_at, missing required keys and wrong JSON types.
- food_name: trim; nonblank; maximum 200; retain ordinary Unicode and punctuation.
- meal_type: breakfast/lunch/dinner/snacks.
- consumption_date: real YYYY-MM-DD Gregorian date, supported years 1900–9999; no silent rollover or timestamp acceptance.
- consumed_quantity: actual finite JSON number, >0, <=1,000,000, at most four decimal places.
- quantity_unit: g/ml/serving/piece.
- calories_kcal/protein_g/carbs_g/fat_g: actual finite JSON numbers, 0–1,000,000, at most four decimal places.
- Every micronutrient: explicit null or number with the same nonnegative bounds/precision.
- entry_source: manual/nutrition_label/food_plate.
- is_estimate: actual boolean; food_plate requires true.
- Provenance is user-confirmed metadata, not cryptographic proof or permission to call AI now.

Do not coerce null, empty strings, booleans or numeric strings into numbers. Reject excess precision before PostgreSQL rounds it. Use a small reliable precision check or verified existing Zod behavior; test legitimate four-decimal values and avoid a naive floating-point multiplication check that rejects valid amounts.

Nutrition amounts are already TOTALS for the entire consumed quantity. Saving 150 g with 180 kcal stores 180 kcal. Updating quantity to 300 while explicitly submitting 180 kcal still stores 180 kcal. Do not multiply, derive calories from macros, infer density or silently convert units.

Known zero remains zero; unknown remains NULL. Response Meal equals the complete writable representation plus server-owned id, created_at and updated_at. Explicitly map flat database micronutrient columns to the nested API object. Serialize supported NUMERIC values as finite JSON numbers without changing NULL into zero; preserve DATE strings and serialize timestamps as UTC ISO values.

## 5. Implement routes and domain behavior

| Method/path | Success | Required behavior |
| --- | --- | --- |
| POST /api/v1/meals | 201, {data: Meal} | Insert complete validated meal; Location identifies /api/v1/meals/{id}. |
| GET /api/v1/meals | 200, {items: Meal[], pagination: ...} | Inclusive filters before count/page, stable ordering, validated backend pagination. |
| GET /api/v1/meals/:id | 200, {data: Meal} | Validate UUID and read one row. |
| PUT /api/v1/meals/:id | 200, {data: Meal} | Full replacement of all writable fields; preserve id/created_at and set updated_at. |
| DELETE /api/v1/meals/:id | 204, empty body | Physically delete one matching row. |

Validate UUID params with the existing Zod version; valid missing UUID -> 404 MEAL_NOT_FOUND, malformed UUID -> 422 VALIDATION_ERROR. PUT never upserts. Repeated DELETE returns 404. No PATCH, bulk delete, auth or ownership fields.

Reject unexpected query keys on create/read-one/update/delete; list accepts only the filters/paging below. Read/list/delete do not accept application body data; use a clear consistent 422 validation response for an unexpected parsed body. Preserve established parser errors for malformed/oversized input.

POST and PUT dynamically check consumption_date <= today using the persisted profile timezone and an injected/current backend clock. Capture the instant/today once for the operation; reuse Phase 2 calendar helpers and Phase 3 profile access rather than calculating a competing today. Invalid/missing profile configuration fails safely. Do not use browser time, process local date, created_at or PostgreSQL CURRENT_DATE.

Future query bounds remain valid. Only consumption writes prohibit future dates. No date check is needed merely to delete an existing meal.

Use parameterized INSERT/SELECT/UPDATE/DELETE and RETURNING as appropriate. Update/delete by one atomic statement; do not add a race-prone existence precheck. No transaction is needed merely to wrap one atomic meal write. Last-committed full update wins; no collaborative locking/version feature is required.

Keep errors in the existing envelope with request IDs: 400 MALFORMED_JSON, 404 MEAL_NOT_FOUND/ROUTE_NOT_FOUND, 413 REQUEST_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 422 VALIDATION_ERROR, identified DB unavailable/timeout 503, and unexpected bugs 500. Map only genuine known failures; do not convert all SQL errors to 422 or 503. Never expose SQL, credentials or raw diagnostic objects.

## 6. Resolve the meal JSON limit correctly

LLD section 8 requires meal JSON mutations to use application/json and a 64 KiB limit: 65,536 bytes. Phase 2 established a broader 100,000-byte JSON infrastructure limit. Enforce the stricter meal-specific requirement while preserving the documented broader behavior where it still applies.

- POST/PUT accept application/json, including ordinary charset parameters. Unsupported or missing content type on a body-bearing mutation -> 415; a correctly typed empty body fails required-body validation.
- The meal-specific parser must enforce its limit BEFORE a broader parser has consumed the request stream. A second express.json after the broader parser, or only checking Content-Length, does not enforce the requirement.
- Count bytes, not string characters. Test exactly 65,536 and 65,537 bytes, including actual body reads without reliance on a declared Content-Length.
- Valid JSON padded with whitespace can exercise the exact accepted boundary without violating the meal schema.
- Preserve malformed JSON 400, request IDs/security headers and existing global-parser tests.
- Do not add multipart handling; the future 10,000,000-byte image-file limit is separate.

Document this narrower route contract as an intended refinement, not an unexplained change to every endpoint's parser limit.

## 7. Filtering and pagination contract

GET /api/v1/meals accepts only:
- start_date: optional inclusive lower bound.
- end_date: optional inclusive upper bound.
- meal_type: optional enum; omission means all categories.
- page: default 1; decimal integer string, positive, maximum 2,147,483,647.
- page_size: default 20; decimal integer string, 1–100.

One date bound alone is valid. If both exist, require start <= end. History has no 366-day report-range cap. Future bounds are allowed. Reject repeated keys/arrays, unknown keys, blanks, signs, fractional/exponential numeric strings and invalid dates. Accept omission as the default, not an empty parameter. Reject page_size=101 instead of capping it. Document any otherwise unspecified leading-zero normalization consistently.

Build one shared parameterized WHERE clause/value sequence for both count and data queries. Filter by consumption_date, not created_at. Sort:
consumption_date DESC, created_at DESC, id DESC.

Use the existing short REPEATABLE READ READ ONLY transaction for separate count and page queries, on the SAME checked-out client. A full-range count must remain available even when the requested page contains no rows. Do not depend solely on a window count attached to returned rows.

Return:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 0,
    "total_pages": 0
  }
}
```

offset = (page - 1) * page_size; total_pages = ceil(total_items / page_size), or 0 for no matches. Convert PostgreSQL count output to a safe JSON number. Avoid 32-bit coercion/casts for large valid offsets. A page beyond the end returns empty items and the TRUE filtered total_items/total_pages.

Parameterize filter values, limit and offset. Never concatenate raw query input into SQL. Pagination operates in the database; do not download all meals and slice them in JavaScript. Do not implement report calculations in this phase.

## 8. Files and implementation order

Expected additions under server/src/modules/meals/:
- meal.routes.js
- meal.controller.js
- meal.service.js
- meal.repository.js
- meal.schemas.js

Use an existing/focused numeric mapping helper if it has a shared responsibility. Do not add a generic CRUD framework, redundant wrapper layers or another pool. Wire routes through the existing app composition and reuse validation/error/profile/transaction helpers. Adapt actual paths rather than duplicating equivalent files.

Order:
1. Inspect and record the passing baseline and existing uncommitted work.
2. Implement/test meal body, ID and list-query schemas.
3. Implement row mapping and parameterized repository functions.
4. Implement service rules, profile-based write-date checks and full-update semantics.
5. Wire HTTP routes, media-type handling and correct parser ordering.
6. Add real API/database integration tests using owned schemas.
7. Fix defects, verify regressions, update README and docs/PHASE_4_VERIFICATION.md.

Comments must explain consumed totals, NULL-aware mapping, full PUT, timezone-derived future checks, shared filter construction and same-snapshot count/page reads. Keep names/functions easy to understand and explain. Use dependencies already installed; no new package is expected without a demonstrated need.

## 9. Required automated verification

Use the existing Node test runner/Supertest, fixed-clock composition and real PostgreSQL integration harness. Do not mutate ordinary application data. Ensure each fixture's HTTP server uses the same owned schema as its fixture setup; stop servers before cleanup and prove no schema/connection leaks.

CRUD/serialization:
- POST example -> 201, correct Location, generated UUID/timestamps, exact consumed totals and nested micronutrients; read/list return the same values.
- Unicode and apostrophe/SQL-looking food names are stored as data without altering schema.
- All four meal types and supported units work.
- Repeated identical meals receive distinct IDs.
- PUT changes all writable fields, preserves id/created_at, updates updated_at, clears a known micro with null and preserves known zero.
- Changing quantity alone in an otherwise complete submitted payload does not rescale nutrients.
- Incomplete PUT, unknown/server-owned fields and invalid updates fail without modifying the existing row.
- DELETE -> empty 204; subsequent read/delete/valid PUT -> 404; list/count exclude the deleted row.

Validation:
- Blank/overlong food name; unsupported enums; string/boolean/null core values; missing micro keys; extra nested keys.
- Quantity zero/negative; negative nutrients; upper bounds; nonfinite numeric inputs where representable/through schema tests.
- Four-decimal values such as 1.0001 accepted; 1.00001 rejected; valid values near bounds preserved. Do not round rejected precision into validity.
- food_plate with is_estimate=false rejected; boolean strings rejected.
- Real/invalid/leap dates, year bounds and malformed UUIDs.
- Under fixed today 2026-09-12, future 2026-09-13 fails both POST and PUT; date 2026-09-12 succeeds. Under instant 2026-09-12T20:00:00Z with Asia/Kolkata, today is 2026-09-13 and that date succeeds.
- Malformed JSON 400; incompatible media type 415; byte-accurate 64 KiB boundary 413 only above the limit; field errors 422; safe DB/internal errors with request IDs.

History/pagination:
- At least 25 matching meals: default page returns 20, page 2 returns 5, and total remains 25. With page_size=10, pages contain 10/10/5.
- page_size=100 accepted; 101, page=0, negative/fractional/exponential values, blanks, repeated and unknown keys fail. Maximum page parses safely and a value above it fails.
- Inclusive start/end matches, one-sided bounds, same-day range, reversed range, meal-type combination, no match and future query bounds.
- Filters apply before count/page; metadata describes filtered matches.
- Deterministic tie order: fixtures share consumption_date and created_at, with known UUID ordering; no missing/duplicated rows across pages in a stable dataset.
- Backdated consumption is listed by consumption_date despite newer created_at.
- Out-of-range page returns empty items with correct nonzero totals; empty match gives total_pages 0.
- Count/page use the same repeatable-read snapshot. Reuse existing transaction verification and, where needed, a deterministic synchronized concurrent-write fixture; do not use flaky timing sleeps or production test hooks.
- Update/delete changes subsequent history/filter results and totals.

Regression/isolation:
- Existing 67 server and 10 database checks remain passing or have an explicitly justified contract update; do not remove failures or target a fixed final count.
- Profile API/date context, TLS, migration idempotence, startup/shutdown, parser/security/error behavior and owned-schema cleanup remain intact.
- Prove ordinary application tables are unchanged by integration fixture writes/cleanup.
- No meal mutation requires AI credentials.
- Report effects will be tested when reports exist; do not invent a report endpoint now to satisfy future tests.

## 10. Commands and manual HTTP verification

Follow IMPLEMENT -> RUN -> TEST -> VERIFY -> FIX -> RE-TEST -> REPORT.

From repository root, using the existing scripts:

```bash
npm --prefix server run lint
npm --prefix server test
npm --prefix server run test:db
git diff --check
git status --short
```

If dependency files change, run the corresponding npm ci and verify lockfile reproducibility. Client checks may be carried forward if client/dependency/build configuration is unchanged; identify them honestly as carried forward. Run additional checks when a change creates a concrete regression risk, not simply to inflate evidence.

Perform HTTP mutation probes against a test server launched by the owned-schema harness, with a recorded disposable base URL/port. Exercise POST -> GET -> PUT -> filtered list -> DELETE -> GET 404 with the complete example payload and invalid variants. Supply a date valid for the injected clock. Show actual statuses, response fields and database persistence in the verification report. Never point disposable CRUD probes at the normal application diary by default.

An ordinary application startup/read-only GET /api/v1/meals and GET /api/v1/profile may verify live wiring without inserting test records. Preserve existing user data. No new frontend or browser workflow is required in this backend-only phase, so unavailable Windows browser helpers alone are not a Phase 4 blocker.

Fix defects and rerun affected checks. Do not reintroduce missing-.env.test or non-app-branded-database-name blockers. If actual permissions, connectivity or isolation fail, report the precise cause and continue useful safe work; never weaken TLS or test routing.

## 11. Completion and response

README must document all five meal endpoints, complete POST/PUT example, response/error shapes, consumed totals, NULL/zero, date rules, filters/paging, 64 KiB JSON mutations and safe existing-.env/owned-schema tests. Keep documentation/comments truthful and focused. Do not modify approved design documents simply to match accidental implementation behavior.

Out of scope: goal APIs/UI, frontend meal forms/history, reports/charts, uploads/AI, authentication, chat/PDF bonuses, extra infrastructure and Phase 5 work. Do not reset the schema, add unnecessary migrations or expose test/debug endpoints.

Write docs/PHASE_4_VERIFICATION.md with evidence, then return:
1. Changes made: actual files and responsibilities.
2. Verification performed: action, expected, actual, PASS/FAIL; separate new, carried-forward and blocked checks.
3. Tests: actual unit/database/client passed, failed and skipped totals; distinguish executed and carried-forward counts.
4. Problems found.
5. Fixes applied.
6. Deviations: reasons or None.; explicitly document the approved narrower meal parser limit.
7. Phase status: exactly PHASE 4 PASSED or PHASE 4 FAILED. A required unresolved check prevents PASSED; list blockers precisely.

Report actual branch, commit and uncommitted state. Preserve all pre-existing work and unrelated .gitignore changes; no remote push. STOP after Phase 4. Do not implement Phase 5 or generate its coding prompt.
