# Phase 1 verification

Date: 2026-09-12  
Environment: WSL 2, Ubuntu-24.04-Verify  
Branch: `main`

## Versions and dependencies

- Node.js `v24.16.0`
- npm `11.13.0`
- Server runtime: Express `5.2.1`, Zod `4.6.2`
- Server checks: ESLint `10.10.0`, Supertest `7.2.2`
- Client runtime: React/React DOM `19.3.0`, React Router DOM `7.18.3`
- Client checks/build: Vite `8.3.0`, Vitest `5.0.0`, React Testing
  Library `16.3.3`, jsdom `30.0.1`, ESLint `10.10.0`

Both package manifests save exact dependency versions. Each package has its own
`package-lock.json`.

## Files created

- Root: `.nvmrc`, `.editorconfig`, `.gitignore`, `README.md`
- Server package/config: `server/package.json`, `server/package-lock.json`,
  `server/.env.example`, `server/eslint.config.js`
- Server source: `server/src/app.js`, `server/src/server.js`,
  `server/src/config/env.js`
- Server tests: `server/tests/app.test.js`, `server/tests/env.test.js`
- Client package/config: `client/package.json`, `client/package-lock.json`,
  `client/.env.example`, `client/index.html`, `client/vite.config.js`,
  `client/eslint.config.js`
- Client source: `client/src/main.jsx`, `client/src/App.jsx`,
  `client/src/styles/global.css`
- Client tests: `client/tests/setup.js`, `client/tests/App.test.jsx`
- Evidence: `docs/PHASE_1_VERIFICATION.md`

Supplied planning and design documents were preserved unchanged.

## Automated verification

| Action | Expected | Actual | Result |
| --- | --- | --- | --- |
| `node --version` | Node 24.x | `v24.16.0` | PASS |
| `npm --version` | Available npm | `11.13.0` | PASS |
| `npm --prefix server ci` | Reproduce server install | 166 packages installed; audit reported 0 vulnerabilities | PASS |
| `npm --prefix client ci` | Reproduce client install | 182 packages installed; audit reported 0 vulnerabilities | PASS |
| `npm --prefix server run lint` | Zero lint errors | Exited 0 with no findings | PASS |
| `npm --prefix client run lint` | Zero lint errors | Exited 0 with no findings | PASS |
| `npm --prefix server test` | Nonempty passing suite | 5 passed, 0 failed/skipped/cancelled/todo | PASS |
| `npm --prefix client test` | Nonempty passing suite | 1 file/1 test passed, 0 failed/skipped | PASS |
| `npm --prefix client run build` | Production assets generated | Vite 8.3.0 built 24 modules into `client/dist` | PASS |

## Live server verification

| Action | Expected | Actual | Result |
| --- | --- | --- | --- |
| `npm --prefix server run dev` without `.env` | Watch process stays running on default 3000 | Server reported listening on 3000 | PASS |
| curl dev `/api/v1/phase-1-unknown` | HTTP 404 | HTTP 404 | PASS |
| `npm --prefix server start` without `.env` | Ordinary process listens on 3000 | Server reported listening on 3000 | PASS |
| curl start `/api/v1/phase-1-unknown` | HTTP 404 | HTTP 404 | PASS |
| `PORT=3100 npm --prefix server start` plus curl | Listen only on 3100; unknown route is 404 | Reported 3100; curl returned 404 | PASS |
| Start a second server while 3000 is occupied | Exit nonzero, do not change port, safe message | Nonzero with “configured port is already in use” | PASS |
| Load `server/.env.example` in a disposable command | Resolve PORT 3000 without creating/overwriting `.env` | Printed `3000` | PASS |
| `PORT=abc npm --prefix server start` | Nonzero safe validation failure | Nonzero; safe range message | PASS |
| `PORT=0 npm --prefix server start` | Nonzero safe validation failure | Nonzero; safe range message | PASS |
| `PORT=65536 npm --prefix server start` | Nonzero safe validation failure | Nonzero; safe range message | PASS |
| Stop owned app processes and inspect 3000/3100 | SIGINT/SIGTERM closes listener and ports are released | Shutdown handler ran; no listeners remained | PASS |

Blank, whitespace-only, negative, and fractional PORT values are included in
the passing server configuration suite. The app-import child-process test
exited normally within two seconds, demonstrating no listener or external
service side effect.

## Live client/browser verification

| Action | Expected | Actual | Result |
| --- | --- | --- | --- |
| `npm --prefix client run dev` | Vite stays on strict port 5173 | Vite 8.3.0 ready on 5173; HTTP 200 | PASS |
| Chromium render of dev root | React heading and description render | Rendered DOM contained the expected `h1` and truthful description | PASS |
| `npm --prefix client run preview` | Built app stays on strict port 4173 | Preview ready on 4173 | PASS |
| Chromium render and reload of preview root | Root survives direct load/reload | Two fresh real-browser renders contained the expected content | PASS |
| Wide and narrow browser renders | Readable at 1440×900 and 375×812 | Chromium generated valid PNG renders at both exact viewport sizes; responsive CSS applies a narrow breakpoint | PASS |
| Browser console check | No uncaught application errors | Chromium log contained 0 console-error/uncaught/type/reference-error lines | PASS |
| Stop owned frontend processes | Ports 5173/4173 released | No listeners remained | PASS |

The Codex desktop browser/image controller could not initialize because its
Windows sandbox helper returned `helper_unknown_error`. Existing WSL Chromium
was therefore used directly for real browser DOM, reload, console, and viewport
render checks. This did not block the required browser behavior checks.

## Repository review

- `git diff --check`: exited 0 with no whitespace errors.
- `git status --short`: reviewed; the repository began with supplied,
  untracked planning documents and no commits. Phase 1 files are also untracked
  pending the user's commit.
- Ignore checks matched real `.env` files, `node_modules`, `dist`, and
  private PEM material.
- Environment examples and both lockfiles are intended to remain trackable.
- No database, provider, authentication, domain API, health route, CORS/Helmet,
  upload, report, migration, or speculative future module was added.
- No secret value or complete process environment was printed.

## Problems and fixes

1. Node 24 was not initially installed in the selected WSL distribution. The
   existing nvm installation was used to install and select Node 24.16.0.
2. The built-in cross-filesystem patch helper could not write through the WSL
   UNC path. The same atomic patches were applied with `git apply` inside WSL.
3. Sending Ctrl+C through the automation PTY caused Node 24.16.0's watch
   supervisor to assert after the application child had already handled the
   signal. A targeted SIGTERM confirmed the app shutdown handler completed and
   released port 3000; the assertion remained isolated to the watcher/PTY
   environment. Ordinary start shutdown also released its port.
4. Desktop browser automation was unavailable as described above. Existing WSL
   Chromium completed the required browser checks.

## Deviations and blockers

Deviations: None. The alternate browser/patch mechanisms changed only the
verification tooling, not the approved application structure or behavior.

Blockers: None.

## Phase status

PHASE 1 PASSED
