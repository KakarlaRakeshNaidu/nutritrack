# Personal Calorie Tracker

Personal Calorie Tracker is a staged full-stack application for recording meals
and understanding personal nutrition. Phase 1 provides a runnable repository
foundation: a React/Vite browser application and a separate Express API process.
Meal, goal, report, database, and image-analysis features are planned for later
phases and are not represented as working here.

## Stack and prerequisites

- Node.js 24.x (verified with 24.16.0)
- npm 11.x (verified with 11.13.0)
- React 19.3.0, Vite 8.3.0, and React Router 7.18.3
- Express 5.2.1 and Zod 4.6.2
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

The backend loads an optional `server/.env` through Node's native environment
file support. Its only Phase 1 setting is:

```dotenv
PORT=3000
```

Copy `server/.env.example` to `server/.env` only when a local override is
needed. If the file is absent, the server uses port 3000. PORT must be a decimal
integer from 1 through 65535.

`client/.env.example` documents:

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

That public value is reserved for frontend API access added in a later phase;
the Phase 1 page makes no API request. Never place database credentials,
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

The API listens at <http://localhost:3000>. Phase 1 intentionally defines no
domain endpoints, so an unknown URL such as
`/api/v1/phase-1-unknown` receives Express's standard 404 response.

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

Server tests cover the default, valid, malformed, and boundary PORT behavior,
the unknown-route 404, and importing the Express app without starting a
listener. The client test renders the root route through React Router and checks
the visible product introduction.

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
- Validated minimal PORT configuration with safe startup messages.
- Graceful HTTP listener shutdown for SIGINT and SIGTERM.
- One semantic, responsive React Router root route without fake product data or
  nonfunctional navigation.
- Real lint, server HTTP/configuration tests, client DOM tests, and production
  build.
- Safe environment templates and repository ignore rules.

## Planned prerequisites and functionality

Later phases will add backend validation/error infrastructure, Aiven PostgreSQL
configuration and migrations, the persisted singleton profile, current goals,
meal CRUD/history, backend pagination, complete-data reports, browser workflows,
and validated Gemini-first/Grok-fallback image extraction. Those phases require
their corresponding database, TLS certificate, and provider configuration.

Phase 1 does not connect to a database or provider and needs no credentials. It
does not implement authentication, account ownership, uploads, charts, health
endpoints, CORS/Helmet, or a migration runner. The mandatory design remains a
single-user application; authentication, chat, and PDF import are separate
bonus scope.

See `docs/PHASE_1_VERIFICATION.md` for recorded implementation evidence.
