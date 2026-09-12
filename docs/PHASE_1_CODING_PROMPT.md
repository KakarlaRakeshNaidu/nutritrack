You are implementing **Phase 1 — Repository Foundation** of the Personal Calorie Tracker take-home assignment. Implement and verify ONLY this phase, then stop.

## Read and inspect first

Before changing files, read the ORIGINAL TAKE-HOME ASSIGNMENT, project analysis, approved PRD.md, HLD.md, LLD.md, REQUIREMENT_TRACEABILITY.md, IMPLEMENTATION_ROADMAP.md and PHASE_1_SPECIFICATION.md. Inspect the current repository, its applicable instructions, Git status, existing files, dependencies, scripts and tests. Documents may be at the root, under docs/, or supplied with this task; locate the actual files rather than assuming paths.

Do not immediately scaffold over existing work. Preserve supplied documents and working functionality. The original assignment and fixed user decisions govern; approved designs supersede older suggestions about ownership, goal history and PATCH. Comments are required. If an essential approved document is missing, report that prerequisite instead of fabricating its contents. Identify genuine contradictions explicitly; choose routine unspecified details using the simplest design-consistent solution.

## Objective and requirements

Deliver separate runnable React/Vite and Express packages, minimal validated startup configuration, real lint/test/build checks, safe environment templates, a clear README and verification evidence. This provides foundations for FR-015/018 and NFR-001/002/003/004/005/006/007. Do not claim that whole-product requirements are complete because the scaffold passes.

## Implement

1. Establish client/ and server/ as separate npm packages, unless the repository already has an approved compatible structure. Use JavaScript ES modules/JSX and Node 24. Record actual Node/npm versions, select compatible dependency versions and commit both package-lock.json files. Install only packages used in this phase.
2. Add/update .nvmrc, .editorconfig and .gitignore. Ignore node_modules, dist, coverage, logs, real .env files and private credentials/key/certificate material. Allow .env.example files and lockfiles. Preserve unrelated existing rules/files.
3. In server/src/app.js compose and export the Express 5 app. Importing it must not listen on a port, connect to a database or call any external provider. Put listening and shutdown in server/src/server.js. Handle startup/listen errors safely and terminate cleanly.
4. In server/src/config/env.js use Zod to validate only the Phase 1 PORT setting: absent defaults to 3000; valid integer range 1–65535; reject empty/whitespace, nonnumeric, zero, negative, fractional and out-of-range inputs. Accept a supplied config object for deterministic tests. Do not require database/provider configuration yet. Phase 2 will extend this module without a bypass flag.
5. Use native Node loading of an optional server .env in dev/start. Add server/.env.example containing PORT=3000. Add client/.env.example containing the public VITE_API_BASE_URL=http://localhost:3000/api/v1; document that real API use follows later. Never expose backend secrets via VITE_ variables.
6. Create client/index.html, src/main.jsx, src/App.jsx and src/styles/global.css. Use React and React Router for one root route with the heading “Personal Calorie Tracker” and a short truthful description. Make it semantic and readable on narrow/wide screens. Do not add fake data, charts, feature screens or nonfunctional navigation.
7. Configure ESLint in both packages, Node's test runner with Supertest on the server, and Vitest with React Testing Library and a DOM environment on the client. Add real behavior tests for backend unknown-route 404, PORT validation and rendering the root route through the router. Test importing the app without a fixed-port listener. Do not add pass-with-no-tests, empty tests or tests merely mirroring trivial implementation lines.
8. Use these scripts exactly unless existing approved equivalents need preservation:
   - server dev: node --env-file-if-exists=.env --watch src/server.js
   - server start: node --env-file-if-exists=.env src/server.js
   - server test: node --test
   - server lint: eslint .
   - client dev: vite
   - client build: vite build
   - client preview: vite preview
   - client test: vitest run
   - client lint: eslint .
   Configure Vite dev port 5173 and preview port 4173 with strict-port behavior. Do not add a fake db:migrate script.
9. Write meaningful comments explaining non-obvious decisions, especially separation of Express composition from process startup. Keep names, functions and module responsibilities easy to understand and explain. Do not comment every obvious line or introduce abstract frameworks.
10. Write an accurate README: overview, fixed stack, Node/npm prerequisites, actual scripts/working directories, dependency installation, env templates, separate startup, tests, lint, build/preview, implemented scope and remaining prerequisites. Keep current functionality distinct from planned features. Preserve approved design documents; copy provided references under docs/ only when needed.
11. Write docs/PHASE_1_VERIFICATION.md with real verification evidence, versions, changes, problems/fixes and deviations. Do not claim checks were run when they were only planned.

Expected files: root README/.gitignore/.nvmrc/.editorconfig; server package/lock/env/lint files, src/app.js, src/server.js, src/config/env.js, tests/app.test.js and tests/env.test.js; client package/lock/env/index/Vite/lint files, src/main.jsx, src/App.jsx, src/styles/global.css, tests/setup.js and tests/App.test.jsx; docs/PHASE_1_VERIFICATION.md. Adapt existing equivalent files rather than duplicating them. This list is not permission for unrelated changes.

## Architecture and scope boundaries

Implement only the foundation. No database pool, SQL, migrations, profile, meals, goals, history, reports, frontend API client, uploads, AI adapters or AI calls. No full API error infrastructure/CORS/Helmet layer yet; that is Phase 2. A standard Express 404 is sufficient now; the JSON error contract follows in Phase 2. Do not add a health endpoint solely for scaffold testing.

Do not add authentication, ownership, chat, PDF import or bonus features. No ORM, Redis, queue, Docker requirement, microservices, global state library, generic CRUD layer or empty future modules. Do not install pg, provider SDKs, Recharts or form packages until their functionality is implemented.

Preserve future contracts without implementing them: one backend-only shared pg.Pool, parameterized SQL, DATE consumption dates, backend timezone rules, complete-dataset reporting independent of paging, NULL distinct from zero, Gemini primary/Grok eligible fallback, validated AI drafts and explicit normal meal saving. The Phase 1 database-free startup is staged construction, not permission to add SKIP_DB or weaken later required configuration.

## Verification: IMPLEMENT → RUN → TEST → VERIFY → FIX → RE-TEST → REPORT

After initial dependency installation creates the lockfiles, run these from the repository root:

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

Expect Node v24.x, successful reproducible installs, zero lint errors, nonempty passing suites that exit, and a successful client production build. Record actual outcomes and test counts.

Run server/client dev in separate terminals:

```bash
npm --prefix server run dev
npm --prefix client run dev
curl -i http://localhost:3000/api/v1/phase-1-unknown
```

Expect HTTP 404 from the actual backend. Open http://localhost:5173/ in a real browser; verify the root heading, refresh, narrow/wide layouts and no uncaught console errors. No domain API request is needed in this phase. Curl alone cannot verify React rendering.

Stop the owned server dev process before running server start on the same port. Verify ordinary startup and the built frontend:

```bash
npm --prefix server start
npm --prefix client run preview
```

Repeat the backend 404 request and inspect http://localhost:4173/ in a browser. Stop owned processes cleanly afterward. Do not kill unrelated processes or overwrite an existing .env file to free the test environment.

Verify safe startup failures in Bash:

```bash
PORT=abc npm --prefix server start
PORT=0 npm --prefix server start
PORT=65536 npm --prefix server start
```

Each must exit nonzero with a safe explanation. Cover blank, whitespace, negative and fractional values in the test suite. Check a valid custom port such as 3100, default startup without .env, loading the example .env in a disposable check, and an occupied-port failure without silently switching ports. Inspect app imports for listener/external-service side effects.

Run relevant pre-existing tests. Where Git exists, run git diff --check, review git status/diff and verify secret/generated files are ignored while env examples/lockfiles are trackable. Do not print secrets or the complete process environment. Fix defects and rerun affected checks; broaden regression checks only for concrete risk.

## Required completion behavior

Both apps must genuinely run. Tests, lint, build and preview must genuinely pass. README commands must match scripts. Required comments must be present. The foundation must work with no database/provider credentials because these integrations are not implemented yet. No future functionality or unrelated rewrite may be introduced.

If required verification cannot be completed because of package access, runtime, browser availability or another blocker, state exactly what is unverified. Do not silently skip it or claim success. Continue all safe useful work in this phase; use PHASE 1 FAILED if a required gate remains failed or blocked.

## Final response format

Return:

1. **Changes made:** files created/modified and purpose.
2. **Verification performed:** for every command/test/manual check, action, expected result, actual result and PASS/FAIL. Explain blocked checks explicitly.
3. **Tests:** total passed/failed and any skipped tests, separated by server/client where available.
4. **Problems found:** issues encountered, or None.
5. **Fixes applied:** corrections, or None.
6. **Deviations:** deviations from approved documents and reasons; write `None.` if none.
7. **Phase status:** exactly `PHASE 1 PASSED` or `PHASE 1 FAILED`. If failed, list remaining blockers.

STOP after Phase 1. Do not implement Phase 2, generate its coding prompt or begin bonus work. The user will supply this result and the current repository state before requesting the next phase.
