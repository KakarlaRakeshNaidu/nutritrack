# Phase 3 Verification

Status: Passed

Verified on 2026-09-12 in WSL Ubuntu 24.04 with Node.js 24.16.0 and npm 11.13.0.

## 1. Changes made

- Added exact pg 8.23.0 support with one process-owned pool, verified CA TLS,
  maximum five connections, bounded connection/idle/statement timeouts, safe
  idle-error diagnostics, and a startup SELECT 1.
- Preserved PostgreSQL DATE values as YYYY-MM-DD text while leaving NUMERIC
  values as lossless strings.
- Added same-client write and repeatable-read/read-only transaction helpers
  with commit, rollback, original-error preservation, and release/discard
  behavior.
- Added ordered numeric migration discovery, strict history reconciliation,
  bounded session advisory locking, per-file atomicity, and an explicit
  db:migrate command. API startup never runs migrations.
- Added 001_initial_schema.sql for tracker_profile, goals, meals, constraints,
  indexes, idempotent singleton seeds, and no sample meals.
- Added read-only GET /api/v1/profile with strict query validation, persisted
  timezone handling from one clock instant, safe profile-state failures, and
  narrow database timeout/availability mapping.
- Added graceful HTTP and shared-pool cleanup for signals, repeated shutdown,
  connectivity failure, and listen failure.
- Changed the real-database test workflow to deliberately reuse server/.env,
  as explicitly selected by the user. No .env.test or second credentials file
  is required.
- Added a loader that parses the selected server/.env directly so inherited
  shell values cannot redirect database tests.
- Hardened integration isolation: each run owns randomized
  nutritrack_test_* schemas, validates and quotes identifiers, applies and
  verifies an exact per-connection search_path with no public or $user
  fallback, snapshots ordinary application tables by count/hash, and removes
  only schemas whose creation this run recorded.
- Updated README setup and test-isolation guidance, and kept the supplied Phase
  3 prompt and verification material under docs/.

## 2. Verification performed

| Provenance | Action | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| Carried forward | Node/npm versions | Declared toolchain | 24.16.0 / 11.13.0 | PASS |
| Carried forward | Clean server/client installs | Lockfiles install cleanly | Server 0 vulnerabilities; client 0 vulnerabilities | PASS |
| Continuation | npm --prefix server run lint | No ESLint findings after loader/isolation edits | Exited zero | PASS |
| Continuation | npm --prefix server test | Credential-free regressions | 67 passed, 0 failed, 0 skipped | PASS |
| Continuation | npm --prefix server run test:db | Real verified-TLS isolated PostgreSQL suite | 10 passed, 0 failed, 0 skipped | PASS |
| Continuation | Test isolation preconditions | Owned schema exists; exact search_path; no fallback | Verified on every checked-out test connection before mutation | PASS |
| Continuation | Application-data protection | Fixtures and cleanup do not alter normal tables | Before/after snapshots matched; normal tables remained absent during the isolated suite | PASS |
| Continuation | Post-suite schema inventory | No generated test schemas remain | 0 matching nutritrack_test_* schemas | PASS |
| Continuation | Configured database preflight | Exact configured target, verified TLS, no conflicting Phase 3 state | Database matched DATABASE_URL; approved tables/history were absent | PASS |
| Continuation | First db:migrate | Apply pending version 1 once | Applied 001_initial_schema.sql | PASS |
| Continuation | Second db:migrate | No SQL replay | Reported database schema already current | PASS |
| Continuation | Migration value/timestamp comparison | Singleton rows and migration metadata unchanged | All four table hashes, row counts, version, name, and applied_at matched | PASS |
| Continuation | GET /api/v1/profile | 200 and persisted timezone calendar context | 200; 2026-09-12, week 2026-09-07 through 2026-09-13 | PASS |
| Continuation | Unexpected profile query | Stable validation envelope | 422 VALIDATION_ERROR for unexpected | PASS |
| Continuation | Unknown API route | Stable route envelope | 404 ROUTE_NOT_FOUND | PASS |
| Continuation | Live headers | Request ID and security headers | Present on all three responses | PASS |
| Continuation | Owned-server shutdown | Close HTTP and database resources | SIGINT handled and both resources closed | PASS |
| Continuation | git diff --check | No whitespace errors | Exited zero | PASS |
| Carried forward | Client lint/test/build | No regression in unchanged client | Lint/build passed; 1 test passed | PASS |
| Carried forward | WSL preview HTTP probes | Index and generated JavaScript load | Both returned successfully | PASS |
| Carried forward | Windows browser render | Browser helper available | Helper failed to initialize after reset/retry | BLOCKED |

The browser-helper limitation is not a Phase 3 database/API acceptance blocker:
the client was unchanged, and its lint, test, build, and WSL preview probes were
already successful.

## 3. Tests

- Continuation server unit/HTTP suite: 67 passed, 0 failed, 0 skipped.
- Continuation real-database integration suite: 10 passed, 0 failed, 0 skipped.
- Carried-forward client suite: 1 passed, 0 failed.
- Total current evidence: 78 passed, 0 failed, 0 skipped.

The 10 database cases executed real migrations and verified TLS rejection with
an unrelated CA, exact schema shape, seeds and idempotence, DATE/NUMERIC
behavior, constraints, migration rollback and concurrency, transactions,
profile behavior, statement-timeout recovery, cleanup, and persistence across
two application restarts. The restart case confirmed profile, goals, meals,
and migration state survive unchanged and that API startup does not migrate,
reseed, or reset data.

## 4. Problems found

- The historical database suite required server/.env.test even though the user
  explicitly selected the already configured server/.env connection.
- Reusing one connection required stronger proof that integration fixtures
  could not reach ordinary application tables.
- One continuation lint run found the new database-test loader was referenced
  without its import.
- The provider-native database name is not app-branded. A read-only preflight
  nevertheless proved the connected database exactly matched DATABASE_URL,
  and the user explicitly designated that existing configuration as the
  application target.
- The Windows browser-control helper remained unavailable from the carried
  Phase 3 UI check.

No credential, connection URI, certificate content, or private environment
value was printed.

## 5. Fixes applied

- Replaced the obsolete .env.test requirement with deliberate loading of the
  exact existing server/.env file; removed the generated secondary test-env
  example.
- Replaced the old database-difference guard with concrete isolation checks:
  randomized strict identifiers, ownership recorded only after CREATE SCHEMA,
  exact per-client search_path verification, no public/$user fallback, and
  application-table before/after hashes.
- Ensured migrations, fixtures, concurrent migration checks, profile requests,
  timeout checks, and both restart launches all use the owned test schema.
- Made cleanup stop owned servers, release work, drop only recorded generated
  schemas, compare the normal application snapshot, and close the pool even
  when cleanup reports an error.
- Added the missing loader import and reran the affected lint/unit checks.
- Applied the approved application migration once and confirmed the second run
  was a no-op without changing seeded values or timestamps.
- Added certs/ to .gitignore as separately requested while preserving the
  user's unrelated ignore entry.

## 6. Deviations

- The unchanged frontend was not rerun in the continuation because the prompt
  said not to rerun passing suites without a concrete source/config reason.
  Its prior lint, one test, production build, and WSL preview results are
  carried forward with provenance.
- The Windows browser helper remained blocked. No browser-render claim is made;
  this does not affect the completed Phase 3 server/database scope.
- The configured provider database uses a provider-native name rather than a
  NutriTrack-labelled name. Exact URL-to-connection matching, absence of
  conflicting Phase 3 objects, and the user's explicit existing-.env target
  instruction were used to establish the authorized target.
- No Phase 4 endpoint, UI, debug route, health route, database reset, public
  schema drop, application fixture, or TLS bypass was added.
- Branch main remains checked out at HEAD 285a822. Phase 3 changes are
  uncommitted and no push is claimed. The unrelated user-owned .gitignore
  entry remains present.

## 7. Phase status

**PHASE 3 PASSED**
