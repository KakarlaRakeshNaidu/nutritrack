# Phase 1 — Repository Foundation

Status: **NOT STARTED**. This is a specification for later implementation. No application code is created by this planning deliverable.

## 1. Objective and reason for sequence

Create a small, runnable, reproducible foundation with separate client/server packages, an Express application that can be tested without opening a fixed port, a React/Router root page, real checks and a truthful README. This establishes the execution and review workflow before database access or product features introduce external dependencies.

Phase 1 needs the original assignment, approved PRD/HLD/LLD, the target repository, Node 24, npm/package access and browser access. It needs no Aiven account, CA file or AI credentials. Inspect the actual repository first and preserve existing work. If files already exist, adapt the foundation instead of overwriting them.

## 2. Requirements covered

| ID | Phase 1 contribution | Not yet claimed complete |
| --- | --- | --- |
| FR-015 | Separate frontend/backend packages and process entry points; no browser database/provider dependency. | Real application-data API communication arrives with features. |
| FR-018 | No mandatory authentication, account or ownership scaffolding. | Persisted single-user profile arrives in Phase 3. |
| NFR-001/002 | Validate startup PORT and report safe startup failures. | Full API validation and centralized errors arrive in Phase 2. |
| NFR-003 | Small focused modules, meaningful naming, linting, understandable scripts. | Continued code review in every phase. |
| NFR-004 | Accurate initial setup/check instructions and staged scope. | Full feature/database/provider README grows later. |
| NFR-005 | Required explanatory comments for app/process separation and other non-obvious foundation choices. | Domain comments added alongside later logic. |
| NFR-006 | Ignore credentials and local artifacts; client has only public configuration. | TLS, SQL, request protections and upload security follow relevant phases. |
| NFR-007 | Semantic, readable, responsive root page with no inaccessible decorative controls. | Complete workflow/loading/error/accessibility behavior follows UI phases. |

Passing Phase 1 means this foundation passes; it does not mean these whole-product requirements are fully satisfied.

## 3. Included scope

- Two independent npm packages at client/ and server/, each with its own committed package-lock.json. Do not introduce root workspaces or orchestration unless the existing repository already uses an approved compatible arrangement.
- Node 24 runtime declaration; JavaScript ES modules and JSX; compatible locked dependency versions.
- Express 5 composition in app.js, separate startup/shutdown in server.js, minimal Zod-backed PORT configuration in config/env.js.
- PORT defaults to 3000 when absent; accept only an integer in 1–65535. Empty, whitespace-only, nonnumeric, zero, negative, fractional and out-of-range values fail safely. Configuration functions can be tested with supplied values without mutating shared process state.
- Native Node environment-file loading for dev/start, making a missing .env acceptable in this phase. server/.env.example contains only PORT=3000; later configuration is added with the corresponding implementation. Native loading avoids an extra environment-file package. [Node environment-file guidance](https://nodejs.org/learn/command-line/how-to-read-environment-variables-from-nodejs)
- A real React/Vite/React Router root route showing “Personal Calorie Tracker” and a brief product description. Keep it readable on narrow/wide screens. No fake meals, targets, statistics, charts or nonfunctional navigation.
- client/.env.example with only the public VITE_API_BASE_URL=http://localhost:3000/api/v1. It is documented as the future API base; this phase does not need an API fetch.
- ESLint for both packages; Node test runner/Supertest for the server; Vitest/React Testing Library and a DOM test environment for the client.
- Initial README, preserved design references, required comments and a phase verification report.

The small PORT schema is intentionally the first part of config/env.js; Phase 2 extends it. Likewise the Phase 1 backend's ordinary Express 404 is a temporary scaffold behavior. The full JSON error contract is a Phase 2 responsibility. No health endpoint is added to the approved API inventory merely to test the scaffold.

## 4. Out of scope

No pg pool, database connection, SQL migrations, domain data or domain endpoints. No profile/meal/goal/report services. No full API error middleware, CORS/Helmet/request validation framework yet. No API client, real meal/goals/history/report/image pages, nutrition calculations, charts, forms or persistence. No provider SDKs, uploads, AI calls, fallback, authentication, chat or PDF import.

Do not add feature directories full of empty stubs, mocked product endpoints or scripts that report success without implementing their operation. Specifically do not add db:migrate until Phase 3 provides a real migration runner. Future database/provider requirements are deferred by construction, not hidden behind SKIP_DB or similar bypass flags.

## 5. Expected files

Paths are relative to the coding agent's repository root. Create only missing files; modify corresponding existing files only when necessary. Preserve supplied documents unchanged when placing copies under docs/. Do not fabricate missing approved documents.

| Area | Expected new files or existing files to update | Responsibility |
| --- | --- | --- |
| Root | README.md, .gitignore, .nvmrc, .editorconfig | Setup, safe exclusions, Node 24, consistent basic formatting. |
| Server package | server/package.json, server/package-lock.json, server/.env.example, server/eslint.config.js | Real scripts, locked dependencies, safe PORT example and linting. |
| Server code | server/src/app.js, server/src/server.js, server/src/config/env.js | Express composition, process lifecycle, minimal validated startup configuration. |
| Server tests | server/tests/app.test.js, server/tests/env.test.js | HTTP scaffold behavior and startup-configuration boundaries. |
| Client package | client/package.json, client/package-lock.json, client/.env.example, client/index.html, client/vite.config.js, client/eslint.config.js | Vite/React and test configuration, scripts and public configuration. |
| Client code | client/src/main.jsx, client/src/App.jsx, client/src/styles/global.css | React bootstrap, one root route and small responsive stylesheet. |
| Client tests | client/tests/setup.js, client/tests/App.test.jsx | DOM test setup and rendered root route behavior. |
| Documents | docs/PHASE_1_VERIFICATION.md; supplied assignment/PRD/HLD/LLD/traceability/review if not already present | Reusable references and actual implementation evidence. |

Avoid unrelated changes, duplicate configs, generated build files in version control and reformatting approved documents. If the repository already contains more functionality, preserve it and report the adapted file list.

## 6. Ordered implementation tasks

1. Read the original assignment, earlier analysis and approved designs; inspect repository instructions, status, tracked files, dependencies and existing scripts. Record existing functionality and any conflicts before edits.
2. Establish the two packages and Node 24 declaration. Select mutually compatible dependency versions, install only dependencies used now and generate both lockfiles. Record actual Node/npm/dependency versions; do not guess them in documentation.
3. Add safe ignore rules for node_modules, dist, coverage, logs, real .env files and private key/certificate material while explicitly allowing .env.example files. Keep lockfiles tracked.
4. Implement the importable Express app and separate process entry point. Importing app.js must not listen or access external services. Validate PORT, handle listen failures without logging secrets and stop cleanly on termination.
5. Create the React root route and minimal styles. Keep the page truthful and semantic; do not imply that unimplemented meal/report features work.
6. Add the minimal env templates, lint rules and test configurations. Node loads the optional server .env in dev/start; tests pass controlled config inputs and do not require local secrets.
7. Add meaningful automated checks for unknown-route 404, configuration defaults/valid override/invalid boundary cases, and rendering the root route through its router. Add no fake tests or snapshots solely to inflate coverage.
8. Add explanatory comments where the foundation makes non-obvious decisions, especially why Express composition is separate from process startup. Comments are mandatory; avoid restating obvious JSX or assignments.
9. Write README instructions for this phase, package scripts, environment examples, scope/assumptions and next prerequisites. Explicitly distinguish implemented foundation from planned functionality.
10. Install from the lockfiles, run both apps, run tests/lint, build and preview the client, check failures and browser behavior, fix defects and rerun affected checks. Preserve any pre-existing regression suite.
11. Record actual results in docs/PHASE_1_VERIFICATION.md and return the required phase status. Stop after Phase 1.

## 7. Exact package-script contract

| Package | Script | Command |
| --- | --- | --- |
| server | dev | node --env-file-if-exists=.env --watch src/server.js |
| server | start | node --env-file-if-exists=.env src/server.js |
| server | test | node --test |
| server | lint | eslint . |
| client | dev | vite |
| client | build | vite build |
| client | preview | vite preview |
| client | test | vitest run |
| client | lint | eslint . |

Configure client dev port 5173 and preview port 4173, both with strict-port behavior to avoid silently testing another port. Server defaults to 3000. Lint configuration must understand Node/browser/test environments without globally disabling useful rules. Test commands must discover and run real tests, finish with no watcher and fail on failing tests; do not enable pass-with-no-tests.

If existing approved package scripts differ, preserve equivalent working behavior and report the exact reconciliation. Never change a working repository's package strategy blindly.

## 8. Verification commands

Run from repository root unless marked otherwise. Initial implementation uses npm install inside each package to create lockfiles; the reviewer-style verification uses npm ci from those lockfiles.

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
```

Expected: Node v24.x, installs succeed without manual dependency edits, lint exits zero, nonempty test suites pass and exit zero, and client production assets build successfully. Record counts and versions; a command being listed is not evidence it ran.

Run these in separate terminals, or sequentially with clean shutdown between checks:

```bash
npm --prefix server run dev
npm --prefix client run dev
curl -i http://localhost:3000/api/v1/phase-1-unknown
```

Expected: both processes stay running; the actual backend request returns HTTP 404. Do not assert a permanent error-body contract in this phase. Open http://localhost:5173/ in a browser and verify the root page, refresh and browser console. The frontend does not need to request a non-existent domain API.

Stop the server dev process before testing start on the same port. Stop any conflicting preview process before preview:

```bash
npm --prefix server start
npm --prefix client run preview
```

Expected: ordinary backend startup works without watch; http://localhost:4173/ serves the production client. Repeat the backend 404 check against the start process. Stop owned processes cleanly after verification; do not terminate unrelated processes occupying a port.

These startup-negative commands use Bash syntax, override the default port and must each fail with a nonzero process exit:

```bash
PORT=abc npm --prefix server start
PORT=0 npm --prefix server start
PORT=65536 npm --prefix server start
```

Also test blank, fractional and negative values through the configuration suite, and a valid custom port such as 3100 in an isolated startup check. Test the .env example in a disposable check location or create a local .env only if absent; never overwrite an existing developer .env.

Where Git is available:

```bash
git diff --check
git status --short
git check-ignore --no-index server/.env client/.env server/node_modules/example client/dist/index.html
```

Review the actual diff for secrets and unrelated changes. Verify .env.example and package-lock.json files are not ignored. A missing Git repository is an environment fact to report, not permission for destructive reinitialization.

## 9. API, database, UI and edge-case verification

**API:** no domain API exists yet. Only verify real HTTP startup and unknown-route 404. Supertest imports app.js directly; no fixed-port listener, database or provider is started by that import.

**Database:** not applicable in Phase 1. Verify no database dependency/connection is introduced and the foundation runs with DATABASE_URL and provider keys absent. This is not a database health check.

**UI:** open the root route in dev and built preview; see the application title and description; refresh; check narrow/wide widths and semantic markup; observe no uncaught console errors, fake statistics or broken feature links. Merely fetching HTML with curl does not replace browser verification of React rendering.

**Edge cases:** missing .env uses defaults; valid PORT override works; malformed/blank/out-of-range PORT fails safely; occupied port fails rather than silently choosing a different one; unknown backend route returns 404; test imports do not start long-lived listeners; stopped processes release their ports. Avoid dumping process.env or sensitive paths during failure reporting.

**Regression:** there is no earlier phase baseline in an empty repository. If supplied code exists, run its relevant existing checks before/after and preserve working features. Lint/test/build success must remain intact after fixes and documentation/config changes that affect them.

## 10. Objective completion gate

Phase 1 passes only if all applicable items have evidence:

- Both dependency lockfiles reproduce installation on Node 24.
- Separate dev processes run; backend start and frontend production build/preview work.
- Importable app and separate server entry point satisfy the boundary; no external service is required.
- PORT default, valid override and invalid-input behavior are verified; startup errors are safe.
- HTTP 404 and browser root-route checks pass.
- Both nonempty automated test suites pass and exit; both lint commands pass.
- Required meaningful comments exist, modules are focused and the README commands match actual scripts.
- Secret files/generated artifacts are ignored; safe env templates and lockfiles remain trackable.
- No future feature, stub success script, unrequested infrastructure or unrelated rewrite is introduced.
- Existing applicable functionality remains working.
- Verification report includes actual commands, expected/actual results, test counts, fixes, deviations and any limitations.

The implementation agent must return exactly **PHASE 1 PASSED** or **PHASE 1 FAILED** as its phase status. If a required check is blocked, identify it and use FAILED; do not represent incomplete verification as success. This status is a progression gate, not an assessment of the author's effort.

Stop after this phase. Phase 2 will be specified only after the user supplies the Phase 1 result and current repository state.
