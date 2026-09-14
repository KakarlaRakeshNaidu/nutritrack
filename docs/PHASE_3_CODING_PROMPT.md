You are implementing Phase 3 — PostgreSQL Persistence, Migrations and Profile of the Personal Calorie Tracker take-home assignment.

Implement and verify ONLY Phase 3, then stop.

## 1. Read and inspect first

Read the original assignment, approved PRD.md, HLD.md, LLD.md, REQUIREMENT_TRACEABILITY.md, IMPLEMENTATION_ROADMAP.md, README.md, docs/PHASE_1_VERIFICATION.md, docs/PHASE_2_VERIFICATION.md and applicable repository instructions. Planning documents are now reported under docs/. Read existing database-related configuration and errors before extending them.

Inspect actual files, dependency versions, package scripts, Git status and recent commits before editing. User-reported baseline:

- Repository: /home/rakeshnaidu/rakesh_linux/NutriTrack, in WSL.
- Branch: main; Phase 2 commit: 285a822, feat: add phase 2 backend infrastructure.
- Earlier Phase 1 commit: 9cf0f3e.
- Node 24; last reported exact versions were Node v24.16.0 and npm 11.13.0. Verify current versions.
- Server tests: 35 passed; client tests: 1 passed; lint/install/build/live HTTP/browser checks passed.
- Configuration, redaction, server-generated request IDs, centralized errors, Helmet/CORS, byte-limited JSON parsing, res.locals validation and calendar helpers already exist.
- No database connection, migrations, domain endpoints or provider integration exists yet.
- Planning documents were organized into docs/; an unrelated .gitignore rule remains uncommitted.
- Nothing was pushed remotely. WSL Chromium is available; forced PTY interruption can trigger a Node watch-supervisor assertion, while the application child shuts down cleanly.

These are reported facts, not independently verified repository contents. Inspect before relying on them. Preserve existing work and the unrelated .gitignore change. Do not reset/amend history, discard changes, switch branches, stage unrelated hunks or push remotely. Do not reorganize approved documents again.

Use the original assignment and fixed decisions as authority; follow the approved LLD contracts. Comments are REQUIRED. Choose routine unspecified implementation details simply and document them. Identify genuine contradictions instead of silently redesigning.

## 2. Objective and coverage

Connect the backend to Aiven PostgreSQL with verified TLS, initialize one shared pg.Pool, implement explicit SQL migrations and transaction cleanup, create the approved schema/seeds, and expose the read-only profile/date-context API.

Coverage: FR-016/018; NFR-001/002/006/008; continuing NFR-003 clean/modular code, NFR-004 documentation and NFR-005 required comments.

This phase creates the meals and goals TABLES, but does not create their API or UI workflows. FR-016 receives persistence infrastructure and direct database verification; complete browser persistence follows later.

## 3. Prerequisites and boundaries

Real Aiven verification requires an authorized PostgreSQL connection URI and its actual CA certificate. Phase 2 synthetic URI/placeholder CA values are not sufficient anymore.

Use existing authorized environment configuration when available. Do not print credentials, put secrets into shell history/command arguments, overwrite a developer .env, invent working credentials or create paid services. Continue code, documentation and credential-free tests if external access is unavailable; record exact missing prerequisites and do not claim the phase passed.

Database integration tests require explicitly configured TEST_DATABASE_URL and TEST_PG_CA_CERT_PATH. These are test-runner variables, not new production settings. Never fall back silently to DATABASE_URL. Prefer a dedicated test database; in all cases use a fresh, uniquely named test schema and operate only on objects created by that test run. Use the same verified TLS policy for Aiven test connections.

Before migrations or tests, establish the target and inspect existing schema/migration state without exposing connection secrets. Do not drop, truncate, overwrite or reseed existing application data. Never run destructive tests in public or the application's ordinary schema. A local PostgreSQL test target, if used, must have its setup/security differences documented and cannot substitute for real Aiven TLS verification.

## 4. Implementation tasks

### A. Preserve the existing baseline

Run current server/client tests and lint. Inspect app composition, server lifecycle, env validation, error middleware and calendar helper contracts. Reuse these instead of creating competing implementations.

Install and lock a compatible exact pg dependency. No ORM or migration framework is needed.

### B. Complete CA/TLS configuration and shared pool setup

Extend Phase 2's syntax-only database configuration at the process bootstrap boundary:

- PG_CA_CERT_PATH must now point to a readable CA certificate file.
- Load and validate certificate material with standard Node facilities; handle missing/unreadable/invalid files safely.
- Configure pg with the explicit CA and rejectUnauthorized: true, using the actual service hostname.
- Preserve rejection of URI sslmode, sslcert, sslkey and sslrootcert options that override explicit TLS settings; reject other conflicting SSL overrides if encountered.
- Do not use rejectUnauthorized: false, NODE_TLS_REJECT_UNAUTHORIZED=0, ssl:false for the Aiven path, or hostname-verification bypasses.
- Test-only synthetic CA fixtures may test config parsing but are not live service trust evidence.

Implement server/src/db/pool.js as a focused setup boundary. Bootstrap initializes one shared pool per API process and supplies it to data-access modules. Importing app.js or reusable modules must not read secrets/CA files, construct a live pool or connect. A small initializer/factory is acceptable; do not introduce a global service container or build another pool in each repository/request.

Use LLD pool settings:
- max: 5.
- connectionTimeoutMillis: 5,000.
- idleTimeoutMillis: 30,000.
- normal PostgreSQL statement_timeout: 10,000 ms.

Use PostgreSQL's statement timeout for server-side query work; do not treat a Promise timeout as proof the database query was canceled. Handle idle pool errors using safe diagnostics. Pool exhaustion must not create an emergency replacement pool.

Configure PostgreSQL DATE decoding to preserve YYYY-MM-DD strings before queries execute. Do not globally convert NUMERIC to JavaScript Number; preserving decimal strings and NULL at the driver boundary avoids accidental coercion. TIMESTAMPTZ remains distinct from consumption DATE.

Perform a bounded SELECT 1 during production startup before accepting requests. If connection setup fails, exit safely and close resources. This is a connectivity check, not a migration or permission to create a health endpoint. API startup never applies migrations or resets data.

Extend existing SIGINT/SIGTERM cleanup to stop accepting requests, allow bounded in-flight cleanup and end the shared pool once. Close the pool on a listen failure after database initialization too. Do not add AI shutdown machinery before AI exists.

### C. Implement small transaction helpers

Use pool.query for an isolated statement. For a transaction:
1. Acquire one client.
2. BEGIN on that client.
3. Run every statement through that same client.
4. COMMIT on success; ROLLBACK on failure when possible.
5. Release in finally.

If acquisition fails, do not release a nonexistent client. Preserve the original failure if rollback also fails, and discard an unusable client rather than returning it as healthy. Do not mask errors or leak checked-out clients.

Support ordinary write transactions and a small explicit REPEATABLE READ READ ONLY option for later list/report snapshot use. Do not accept arbitrary request-supplied transaction SQL or build a generic unit-of-work framework. Test rollback, commit, acquisition/rollback failure cleanup and read-only behavior now; do not implement list/report features.

Comments must explain why transaction statements share one client and why finally-release is mandatory.

### D. Implement the explicit SQL migration runner

Create server/src/db/migrate.js and server/migrations/001_initial_schema.sql.

Add a real server db:migrate script:
node --env-file-if-exists=.env src/db/migrate.js

The CLI is a separate process with its own single pool, using the same configuration/TLS code. It may use a documented statement timeout of 60,000 ms for DDL, while normal API queries retain 10,000 ms. Close its pool on success and failure.

Migration behavior:
- Discover trusted repository SQL files with numeric versions and validate filenames/version uniqueness before SQL execution.
- Apply in numeric order.
- Maintain schema_migrations exactly as specified below.
- Apply each pending SQL migration and its version record in one transaction on the same client.
- The runner owns transaction boundaries; SQL migration files must not contain their own BEGIN/COMMIT that bypasses that boundary.
- Existing versions are not replayed; report an existing version/name mismatch instead of silently reconciling it.
- On failure, roll back that migration and do not record its version or run later migrations.
- Rerunning applied migrations must not update timestamps, recreate rows or overwrite user values.
- Serialize concurrent migration runners using a small PostgreSQL advisory-lock mechanism, with bounded waiting and cleanup; hold/release it on the same checked-out session. This avoids overlapping startup migrations without external infrastructure.
- Never seed or migrate on ordinary API startup.

Use bound parameters for metadata values. Migration SQL is trusted version-controlled code, not user input. Dynamic identifiers needed only for test isolation must be internally generated, strictly validated and correctly quoted; SQL placeholders cannot substitute identifiers. Do not interpolate user-provided table/schema names.

### E. Create exactly the approved schema

Read LLD section 2 for the authoritative column definitions, defaults, named constraints and timestamps. There are three domain tables plus migration metadata. No account/ownership tables, foreign keys, nutrient lookup tables or extra business tables.

tracker_profile:
- id SMALLINT PRIMARY KEY, default 1, CHECK id = 1.
- display_name VARCHAR(100), required, default 'Personal user', trimmed nonblank value.
- timezone VARCHAR(64), required, nonblank, default 'Asia/Kolkata'.
- created_at and updated_at TIMESTAMPTZ NOT NULL DEFAULT now().
- Seed row 1 once. IANA timezone validity is checked by the application when loaded.

goals:
- id SMALLINT PRIMARY KEY, default 1, CHECK id = 1.
- Nullable NUMERIC(12,4): daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg.
- Calorie and weight goals: NULL or >0 and <=1,000,000.
- Macro goals: NULL or >=0 and <=1,000,000.
- created_at and updated_at TIMESTAMPTZ NOT NULL DEFAULT now().
- Seed row 1 with all five targets NULL. No history rows or API in this phase.

meals:
- id UUID PRIMARY KEY DEFAULT gen_random_uuid().
- food_name VARCHAR(200), required, trimmed and nonblank; ordinary Unicode accepted.
- meal_type VARCHAR(10): breakfast/lunch/dinner/snacks.
- consumption_date DATE NOT NULL, between 1900-01-01 and 9999-12-31.
- consumed_quantity NUMERIC(12,4): >0 and <=1,000,000.
- quantity_unit VARCHAR(10): g/ml/serving/piece.
- Required NUMERIC(12,4), 0–1,000,000: calories_kcal, protein_g, carbs_g, fat_g.
- Nullable NUMERIC(12,4), NULL or 0–1,000,000: sodium_mg, calcium_mg, iron_mg, potassium_mg, vitamin_c_mg, vitamin_d_mcg.
- entry_source VARCHAR(20) NOT NULL DEFAULT 'manual': manual/nutrition_label/food_plate.
- is_estimate BOOLEAN NOT NULL DEFAULT false; food_plate requires true.
- created_at and updated_at TIMESTAMPTZ NOT NULL DEFAULT now().
- Index (consumption_date DESC, created_at DESC, id DESC).
- Index (meal_type, consumption_date DESC, created_at DESC, id DESC).
- No uniqueness constraint on food/date/category; repeated identical meals are legitimate.

schema_migrations:
- version INTEGER PRIMARY KEY, positive.
- name VARCHAR(200) NOT NULL UNIQUE, nonempty.
- applied_at TIMESTAMPTZ NOT NULL DEFAULT now().

Important semantics:
- NULL micronutrients remain unknown; known zero remains zero.
- Stored nutrition represents consumed totals; no scaling triggers or derived totals.
- Future consumption is prohibited at the authoritative API boundary in Phase 4. Do not add a process/session-timezone-dependent CURRENT_DATE database CHECK now or claim raw SQL enforces that later API rule.
- NUMERIC(12,4) stores four-decimal values and may round higher-scale raw SQL input; stricter request precision rejection belongs to later API schemas. Do not claim a database test rejects excess precision unless the actual schema does so.
- updated_at will be explicitly updated by later replacement statements. Do not add triggers or update endpoints in this phase.

### F. Add the read-only profile API

Implement GET /api/v1/profile with a focused route/schema/controller/service/repository arrangement following existing patterns. Avoid layers that have no responsibility.

- Repository reads singleton id 1 using parameterized SQL and the supplied shared pool.
- Reject unexpected query keys with the existing 422 validation envelope. No request data modifies the profile.
- Service checks the persisted timezone and calls the existing Phase 2 calendar helpers.
- Capture now once per operation; tests inject a fixed clock.
- Use the database profile timezone, not a hardcoded timezone or new environment setting.
- Do not silently synthesize/reset a missing profile. Missing row or invalid persisted timezone -> safe 500 INTERNAL_ERROR.
- A runtime connection outage -> 503 DATABASE_UNAVAILABLE; identified DB timeout -> 503 DATABASE_TIMEOUT.
- Map known transport/timeout cases narrowly. SQL syntax errors, unexpected schema errors and arbitrary programming exceptions are not automatically 503 or validation errors.
- Reuse existing request IDs, validation, CORS, Helmet and safe error envelope.

Success response is exactly this shape, with dynamic dates:

```json
{
  "data": {
    "display_name": "Personal user",
    "timezone": "Asia/Kolkata",
    "today": "2026-09-12",
    "week_start": "2026-09-07",
    "week_end": "2026-09-13"
  }
}
```

The date example assumes an injected instant of 2026-09-12T12:00:00Z. Do not hardcode it in live code. Do not expose row timestamps, IDs, connection details or configuration. This is a singleton resource, so pagination is not applicable. Do not add profile-edit, goal or meal endpoints.

## 5. Expected files

Adapt existing paths and preserve approved documents:
- server/src/db/pool.js, transaction.js, migrate.js and a focused migration implementation helper only if needed to separate CLI side effects.
- server/migrations/001_initial_schema.sql.
- server/src/modules/profile/ focused route/controller/service/repository/schema files.
- Existing server/src/config/env.js, app.js, server.js and error mapping where needed.
- Unit and isolated database integration tests with focused helpers.
- server/package.json/package-lock.json, server/.env.example and a safe test env example if useful.
- README.md and docs/PHASE_3_VERIFICATION.md.

Keep .gitignore's unrelated uncommitted change intact. If test-env exclusions require an additional edit, make only the necessary hunk and leave unrelated changes unstaged. Do not commit real environments, CA material, generated database dumps or test secrets.

## 6. Test design and isolation

Keep npm test usable for existing and new credential-free tests. Add an explicit server test:db script for real PostgreSQL integration tests. Configure test discovery so database tests are not silently skipped or accidentally pulled into the credential-free suite. The database command must fail clearly if its required configuration is missing; it must not report a skipped integration suite as success. Document exact scripts and file patterns chosen to fit this repository.

Database tests create a unique schema in the explicitly configured test target. Route every connection/query/migration to that schema, with no fallback to public. Cleanup only that run's owned schema after all queries/clients stop. Validate owned names before cleanup; never DROP DATABASE or broadly DROP public. Serialize shared-fixture tests or isolate each fixture, so temporary profile changes cannot race other cases. Use the same migration implementation as the real CLI.

Unit tests:
- Pool configuration/TLS arguments, DATE parser and import safety.
- Missing/unreadable/malformed CA material and conflicting SSL URI options.
- Exactly one pool supplied through application composition; no per-request construction.
- Transaction success/failure and finally-release, including acquisition/rollback errors and unusable-client disposal.
- Migration ordering/duplicate rejection and CLI cleanup.
- Profile clock/response validation, missing/invalid profile and narrow DB error mapping.
- Redaction of synthetic secret strings in responses/logs.

Real database tests:
1. Migrate a new isolated schema; inspect columns, types, nullability, defaults, indexes and named constraints against the LLD.
2. Confirm exactly one seeded profile and one all-null goals row, with no seeded meals.
3. Rerun migrations; version records and seed timestamps/values remain unchanged.
4. In the owned schema, modify synthetic profile/goals data and insert a valid synthetic meal using bound values. Rerun migrations and verify they remain unchanged.
5. Insert known zero and NULL micros and read them back distinctly. Assert consumption_date is a string and timestamps remain separate.
6. Duplicate identical meal content is allowed with distinct IDs. Invalid singleton IDs, blank names, enum values, numeric bounds, negative nutrients and non-estimated plate source fail the intended constraints.
7. Exercise a deliberate failing migration in a test-owned fixture directory. Verify its schema/data changes and version record roll back; previously committed migrations remain. Do not add failing SQL to the shipped migration directory.
8. Exercise concurrent runners against one owned schema; no duplicate seed/version application occurs.
9. Exercise rollback after a write, followed by a successful query; verify no data/client leak. Test read-only transaction rejection of writes and committed transaction persistence.
10. Call the real profile route against the migrated test database using a fixed clock. Verify singleton data, unexpected-query 422, invalid/missing profile 500 and restoration/isolation of fixtures.
11. Verify a real bounded PostgreSQL statement timeout and safe classification. Do not terminate a shared Aiven service or unrelated sessions to simulate failures.
12. Stop and restart the API on an explicitly isolated fixture target; verify synthetic profile/goal/meal rows survive and startup does not migrate/reseed/reset them. Compare meal IDs/values and migration state before/after.

Live Aiven evidence:
- Successful connection using the actual CA and hostname verification.
- SELECT 1 succeeds; inspect pg_stat_ssl for the current backend session where available, without exposing secrets. Encrypted transport alone is not proof certificate verification is enabled, so also review TLS configuration and test rejection of an unrelated CA.
- GET /api/v1/profile works after explicit migrations.
- Unit-test mocks and a local-only database do not satisfy this live Aiven gate.

## 7. Commands and live checks

Follow IMPLEMENT -> RUN -> TEST -> VERIFY -> FIX -> RE-TEST -> REPORT.

After dependency changes, from repository root:

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

With the intended authorized application database configured and inspected:

```bash
npm --prefix server run db:migrate
npm --prefix server run db:migrate
```

First run applies pending migrations; second run makes no schema/seed changes. Do not assume first run is an empty database if the target already contains data.

With explicit isolated test configuration:

```bash
npm --prefix server run test:db
```

Do not place secret URIs on command lines. Document safe environment-file loading for the integration command. Use only placeholder values in examples.

Start the backend with actual configuration:

```bash
npm --prefix server start
curl -i http://localhost:3000/api/v1/profile
curl -i 'http://localhost:3000/api/v1/profile?unexpected=1'
curl -i -H 'Origin: http://localhost:5173' http://localhost:3000/api/v1/profile
curl -i http://localhost:3000/api/v1/phase-3-unknown
```

Expected: profile 200 with real timezone-derived dates; unknown query 422; allowed-origin response carries CORS and request-ID headers; unknown route remains JSON 404.

Run dev separately after stopping start. Preserve custom/invalid/occupied-port behavior with otherwise valid database setup. Verify shutdown closes HTTP and pool resources, including startup/listen failures. Distinguish known WSL supervisor behavior from application failures and record exact evidence.

Use WSL Chromium for frontend dev/production-preview regression checks where appropriate. The unchanged root page must render without runtime errors. No profile UI is required yet.

Record commands, expected/actual results and test counts. Fix defects and rerun affected checks. Do not delete existing checks to hide failures; adapt them only for intended evolution from syntax-only database configuration to real connection startup.

## 8. Documentation, comments and completion

README must explain Aiven connection/CA setup, safe environment configuration, SQL migrations, first startup order, profile defaults, initial operator configuration of name/timezone, test isolation/test:db, ordinary startup without resets and how to diagnose missing config/CA/DB access safely. Explain that changing profile timezone changes today/week context but does not rewrite consumption DATE values.

Comments must explain pool ownership, same-client transactions, finally-release/discard, DATE parsing, migration atomicity, test-schema isolation and persisted-timezone handling. Keep modules and functions easy to understand and explain. No speculative abstractions, ORM, generic repository framework or extra infrastructure.

Out of scope: meal/goal CRUD APIs, filtered lists/pagination, reports/charts, frontend API integration, uploads, Gemini/Grok calls, authentication, chat, PDF import and Phase 4 work. No separate health endpoint. Do not add stubs that pretend these features exist.

Phase 3 passes only when relevant regression tests, real database tests, live Aiven TLS/profile checks, restart persistence, migration atomicity/idempotence and cleanup checks have actual passing evidence. Missing credentials, CA, privileges or connectivity is a blocker to that gate, not proof the implementation failed logically and not permission to claim success. Finish all useful authorized work and report the exact missing prerequisite if blocked.

Write docs/PHASE_3_VERIFICATION.md and return:
1. Changes made: files and purpose.
2. Verification performed: action, expected, actual, PASS/FAIL; identify blocked checks.
3. Tests: unit/database/client passed, failed and skipped totals separately.
4. Problems found.
5. Fixes applied.
6. Deviations: reasons, or None.; distinguish intended staged changes.
7. Phase status: exactly PHASE 3 PASSED or PHASE 3 FAILED; list blockers if failed.

Report branch/commit/working-tree state truthfully, including preservation of the unrelated .gitignore change. Do not claim remote pushes. STOP after Phase 3. Do not implement Phase 4 or generate its coding prompt.

Implementation references: [pg pooling](https://node-postgres.com/features/pooling), [pg transactions](https://node-postgres.com/features/transactions), [pg SSL configuration](https://node-postgres.com/features/ssl), [Aiven Node connection guidance](https://aiven.io/docs/products/postgresql/howto/connect-node). Follow the approved verified-CA policy even if an external example presents optional weaker TLS settings.
