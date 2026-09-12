# Personal Calorie Tracker

Personal Calorie Tracker is a staged full-stack application for recording meals
and understanding personal nutrition. Phase 2 adds the backend infrastructure
needed by later domain work: strict startup configuration, safe JSON errors,
request correlation, security/CORS policy, reusable request validation, and
calendar-date utilities. Meal, goal, report, database, and image-analysis
features remain planned and are not represented as working here.

## Stack and prerequisites

- Node.js 24.x (verified with 24.16.0)
- npm 11.x (verified with 11.13.0)
- React 19.3.0, Vite 8.3.0, and React Router 7.18.3
- Express 5.2.1, Zod 4.6.2, Helmet 8.3.0, and CORS 2.8.6
- ESLint 10.10.0, Node's test runner/Supertest, and
  Vitest 5.0.0/React Testing Library

The repository uses independent npm packages rather than a root workspace.
With nvm installed, select the declared runtime from the repository root:

```bash
nvm install
nvm use
```

Install exactly the versions recorded in each lockfile:

```bash
npm --prefix server ci
npm --prefix client ci
```

## Environment

The backend loads `server/.env`, when present, through Node's native
environment-file support. Copy the safe template and replace its placeholders:

```bash
cp server/.env.example server/.env
```

Phase 2 validates these core settings before opening the HTTP listener:

- `PORT`: optional decimal integer from 1 through 65535; defaults to `3000`.
- `NODE_ENV`: optional `development`, `test`, or `production`; defaults
  to `development`.
- `CLIENT_ORIGIN`: one exact HTTP(S) browser origin, with no path, wildcard,
  credentials, query, fragment, or origin list.
- `TRUST_PROXY_HOPS`: optional nonnegative decimal integer; defaults to `0`.
- `DATABASE_URL`: a PostgreSQL URL with a host and one database path. TLS query
  overrides such as `sslmode` and `sslrootcert` are rejected.
- `PG_CA_CERT_PATH`: a nonblank CA-certificate path.

Database settings are syntax-checked only in Phase 2. Startup does not read the
certificate or connect to PostgreSQL; those actions belong to Phase 3.

Gemini and Grok settings are optional key/model pairs. A wholly absent pair is
disabled, a complete nonblank pair is configured, and a partial pair produces a
safe warning without blocking startup. Never commit real credentials.

`client/.env.example` documents:

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

That public value is reserved for frontend API access added in a later phase;
the current page makes no API request. Never place database credentials,
provider keys, or other backend secrets in variables prefixed with `VITE_`,
because Vite exposes those variables to browser code.

Real `.env` files and common private key/certificate formats are ignored.
The example files remain trackable.

## Run the applications

Run the backend and frontend in separate terminals from the repository root:

```bash
npm --prefix server run dev
npm --prefix client run dev
```

The API listens at <http://localhost:3000>. Phase 2 intentionally defines no
domain endpoints. Unknown routes return the standard JSON error envelope with a
server-generated `X-Request-ID`. API JSON bodies are capped at 100,000 bytes;
malformed, oversized, invalid, unknown-route, and internal failures are mapped
to stable JSON errors. CORS permits only the configured client origin, while
same-origin or non-browser requests without an `Origin` header remain usable.

The browser application is available at <http://localhost:5173>. Its single root
route is a truthful introduction to the staged product. Vite is configured to
fail instead of silently selecting another port when 5173 is occupied.

For ordinary backend startup without file watching:

```bash
npm --prefix server start
```

## Quality checks

Run lint and the nonempty test suites from the repository root:

```bash
npm --prefix server run lint
npm --prefix client run lint
npm --prefix server test
npm --prefix client test
```

Server tests cover strict core/provider configuration, startup safety, request
IDs, the JSON error contract, exact-origin CORS, Helmet, byte-accurate body
limits, reusable Zod validation for body/query/params, internal-error redaction,
and timezone-independent calendar arithmetic. Test-only routes are injected
into the application factory and cannot appear in production startup. The
client test renders the root route through React Router and checks the visible
product introduction.

## Production frontend

Build static production assets and serve them locally:

```bash
npm --prefix client run build
npm --prefix client run preview
```

Preview uses <http://localhost:4173> and strict-port behavior. Generated
`client/dist` files are intentionally ignored.

## Implemented foundation

- Separate locked client and server packages using JavaScript ES modules/JSX.
- Express application composition isolated from process listening.
- Strict, startup-time core configuration with redacted failures and nonblocking
  optional-provider state evaluation.
- Server-owned UUID request IDs and a stable JSON error envelope.
- Helmet defaults, exact-origin CORS, a numeric 100,000-byte JSON limit, and
  explicit middleware ordering.
- Reusable strict Zod validation for request body, query, and params, with
  parsed data stored in `res.locals.validated`.
- Pure calendar-date helpers for strict dates, comparison, addition, inclusive
  counts, Monday-to-Sunday bounds, IANA-timezone today, and future-date checks.
- Graceful HTTP listener shutdown for SIGINT and SIGTERM.
- One semantic, responsive React Router root route without fake product data or
  nonfunctional navigation.
- Real lint, server HTTP/configuration tests, client DOM tests, and production
  build.
- Safe environment templates and repository ignore rules.

## Documentation and next phase

Product, architecture, design, traceability, implementation-roadmap, and phase
prompts are organized under `docs/`. Verification evidence is recorded in:

- `docs/PHASE_1_VERIFICATION.md`
- `docs/PHASE_2_VERIFICATION.md`

Phase 3 may add the Aiven PostgreSQL connection, centralized TLS configuration,
migrations, and the first persistence layer. The current phase does not create
a pool, read the CA certificate, connect to a database/provider, run migrations,
or expose meal/profile/goal/report/upload endpoints. Authentication, chat, and
PDF import remain outside the mandatory single-user scope.
