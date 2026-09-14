# NutriTrack: JavaScript-to-TypeScript migration prompt

Copy everything below the divider into the coding agent working in the existing repository.

---

Implement a complete, behavior-preserving migration of the existing NutriTrack application from JavaScript to TypeScript. Phases 1–7 are already completed. This is a dedicated migration checkpoint after Phase 7 and before Phase 8; do not start Phase 8 or add new product features.

The user's language requirement is TypeScript. This instruction supersedes earlier planning instructions that selected JavaScript. Preserve the working application and migrate it incrementally; do not rebuild it from scratch.

## 1. Inspect the real repository first

Expected repository: `/home/rakeshnaidu/rakesh_linux/NutriTrack`. Use the actual current checkout if the workspace already points there.

Before editing:

- Read applicable `AGENTS.md`, package manifests, lockfiles, source layout, configuration, README, authoritative design documents, and existing phase prompts and verification reports, especially Phase 7.
- Inspect Git status, current branch and HEAD. Prior reports mentioned uncommitted work on `main` at `285a822`; this is historical context, not a claim about the current checkout.
- Inventory all application-owned JavaScript/JSX: server, client, tests, database runners, fixtures that execute code, browser verification harnesses, and scripts. Identify entrypoints, child-process launches, dynamic imports, source-file references, and SQL migration asset paths.
- Identify the actual Phase 7 report implementation and its contracts, precision rules, tests, and verification commands. Do not guess its current filenames or test counts.
- Record a baseline of existing checks using the documented safe environment and isolation workflow. Distinguish any pre-existing failure from a migration regression.

Preserve all existing uncommitted changes, planning documents, personal ignore rules, `certs/` exclusions, and ignored environment files. Do not reset, clean, discard, stash away, or overwrite unrelated work. Remain on the current branch. Do not create a commit, push, or deploy unless separately instructed.

Routine migration edits and verification are authorized. Continue autonomously through completion. If a real access blocker prevents a required check, finish the remaining useful work and report the exact blocker without claiming a pass.

## 2. Scope and non-negotiable quality requirements

Convert all production server code to `.ts`, React components to `.tsx`, and non-JSX client code to `.ts`. Convert application-owned tests and executable support scripts as well. SQL, CSS, HTML, static assets, generated JavaScript, and third-party code retain their appropriate formats. A tooling configuration may remain JavaScript when its loader makes that the simplest supported choice; document each such exception. Do not leave completed feature modules in JavaScript.

Maintain separate frontend and backend packages. The browser must continue communicating with the backend exclusively through APIs. Preserve React/Vite, Express, Zod, PostgreSQL, the current module structure, and installed runtime library versions unless a concrete compatibility problem requires a narrowly justified change.

Strictly follow these quality requirements:

1. **Clean, explainable code:** use descriptive names, straightforward functions, ordinary interfaces/type aliases, and simple unions. Prefer inference where explicit annotations add noise. Avoid clever type machinery and unnecessary abstractions.
2. **Modularity:** preserve coherent feature modules and shared utilities. Do not create a monolithic types file, new framework, shared workspace package, or generic repository architecture just for this migration.
3. **Documentation:** update setup, commands, build behavior, assumptions, and relevant source paths in the README and current architecture documentation.
4. **Error handling and validation:** retain runtime Zod validation, safe API errors, input retention, and graceful failure behavior. TypeScript is not runtime validation.
5. **Comments are required:** retain useful existing comments and add concise explanations around non-obvious decisions, such as Node ESM imports, raw versus parsed form values, exact decimal handling, and test-schema isolation. Explain why; do not comment every obvious line.

Do not introduce blanket `any`, file-wide TypeScript suppressions, unchecked double assertions, or non-null assertions to silence errors. Narrow `unknown` at external boundaries. Any unavoidable local third-party typing exception must be small, justified, and documented. Do not weaken validation or remove tests to satisfy the compiler.

## 3. Backend TypeScript setup

Use the project's Node 24 runtime and existing ES module approach. Verify compatible tooling against the installed versions; avoid a broad dependency upgrade.

Configure strict TypeScript with Node-compatible module semantics:

- `strict: true`.
- `module: "NodeNext"` and `moduleResolution: "NodeNext"`.
- An explicit target compatible with Node 24 and the existing BigInt/decimal logic; `ES2022` is sufficient unless the current code requires a newer target.
- `verbatimModuleSyntax: true` and explicit type-only imports where appropriate.
- Keep `"type": "module"`.

Use a type-check configuration covering source, tests, and executable application-owned helpers. Use a separate production build configuration that emits server source into `server/dist`, excludes tests, and refuses emission on compilation errors. Keep source/build roots deliberate so the documented server entrypoint actually exists.

For NodeNext ESM, relative imports in TypeScript source should use the runtime `.js` specifier when they will resolve to emitted JavaScript. Do not blindly convert every import suffix to `.ts`. Avoid path aliases that require an unimplemented runtime resolver.

Provide and document these capabilities using the repository's existing command names where possible:

- `npm run typecheck`: checks the server, tests, and owned helpers without emitting code.
- `npm run build`: checks types and emits a fresh production build.
- `npm run dev`: runs TypeScript source with watch/restart support and the existing safe environment-loading behavior.
- `npm start`: runs the compiled JavaScript with Node, without requiring a TypeScript development runner.
- `npm test`: runs all existing credential-free tests after migration.
- `npm run test:db`: runs the real PostgreSQL suite with the existing owned-schema safeguards.
- The existing migration command: executes the migrated migration runner with correct SQL asset resolution and a documented build prerequisite or an automatic build.

Use `tsx` as a development dependency for source execution if needed. Source execution or Node's native type stripping does not replace `tsc` checking. Do not make production startup depend on `tsx` or `ts-node`.

Clean only the known generated output directory before a fresh build; stale `.js` output must not make tests or startup appear successful. Do not run broad destructive cleanup commands.

Add only necessary compiler, runner, lint integration, and declaration packages. Match Node/Express/React declaration majors to the project. Do not add redundant `@types` packages for libraries that already provide types. Update lockfiles through the package manager.

Preserve the import-safe Express app: importing it must not start a listener, connect to PostgreSQL, load certificates, or perform external operations. Keep startup, shutdown, occupied-port failure, and pool lifecycle behavior intact.

## 4. Frontend TypeScript setup

Preserve the current React, Vite, React Router, React Hook Form, and Zod behavior.

- Use `.tsx` for JSX and `.ts` for other client modules.
- Update the HTML entrypoint and all source references.
- Use strict checking, bundler-compatible module resolution, React JSX support, appropriate DOM libraries, `isolatedModules`, and no TypeScript emission for the Vite-managed application.
- Cover client source, tests, and tooling configuration with suitable TypeScript configurations and environment types. Keep Node-only types out of browser assumptions where practical.
- Add the appropriate Vite client declarations. Type only the public environment variables actually used, including the existing API base URL configuration. Never expose database or AI/provider settings to the client.
- Add `npm run typecheck` and make the production build perform type checking as well as Vite bundling. Vite transpilation alone does not check types.
- Adapt the existing ESLint setup to TypeScript using compatible tooling. Retain meaningful checks instead of disabling lint rules wholesale.

Preserve the centralized API client, safe handling of 204 responses, normalized backend and network errors, cancellation, stale-response protection, and the absence of automatic mutation retries.

Model raw form inputs separately from parsed values. A blank string, numeric zero, and `null` are different states. Use `z.input`, `z.output`, or schema inference appropriately when Zod transforms input. React Hook Form's input/output types must agree with its resolver and actual submitted payloads. Do not force compatibility using blanket casts.

Keep accessible focus behavior, validation messages, loading/error/empty states, URL-backed filters and pagination, navigation, direct-route refresh, and retention of unsaved input after failures.

## 5. Domain and boundary types

Use the existing schemas and contracts as the source of truth. Derive types from Zod schemas where this avoids duplicate definitions. Keep independently meaningful database row and API response types distinct.

In particular:

- PostgreSQL `NUMERIC`, aggregate counts, dates, and timestamps must be typed according to the actual configured driver output. A generic row annotation does not transform a database string into a number.
- Preserve existing database-value conversion utilities and exact report arithmetic. Do not replace decimal-safe code with JavaScript floating-point accumulation.
- Keep nullable micronutrients and nullable goal values explicit. Do not turn unknown values into zero.
- Type meal types, quantity units, source values, report grouping, and temporal states with straightforward unions or schema inference.
- Type Express handlers and validated `res.locals` consistently with the current validation middleware. Preserve Express query handling and middleware ordering.
- Treat external JSON and caught errors as untrusted values. A typed API-client generic is not evidence of runtime validation; preserve existing checks and keep any necessary trust boundary centralized.
- Do not import server runtime modules into the frontend to reuse types. Preserve the separate package boundary; use simple transport definitions or type-only reuse only where the current build supports it without architectural expansion.
- Preserve negative tests that intentionally send invalid input. Exercise the HTTP or unknown-input boundary rather than weakening production types to make malformed fixtures assignable.

## 6. Preserve all Phase 1–7 contracts

Read the actual implementation and evidence for precise field names, response envelopes, status codes, and limits. Do not redesign them during migration. The following are particularly sensitive:

### Infrastructure and database

- Strict environment validation, safe redaction, request IDs, Helmet, CORS, JSON error envelopes, content-type checks, and exact byte limits.
- The meal mutation parser limit remains 65,536 bytes; goals/general JSON retain their existing 100,000-byte limit.
- Verified-CA PostgreSQL TLS, existing pool settings, parameterized SQL, transaction isolation, rollback, client release, and graceful shutdown.
- Existing SQL migration contents, identifiers, history, singleton rows, stored records, and timestamps. No new migration or schema redesign is required for a language conversion.
- Backend-authoritative calendar dates, profile timezone, leap dates, inclusive ranges, and Monday–Sunday weeks.

### Meals, goals, and manual workflows

- All five meal CRUD/list endpoints and both singleton goals endpoints.
- Complete PUT semantics, deterministic ordering, true filtered totals, page limits, empty out-of-range pages, and existing query normalization.
- Nutrition values represent consumed totals; quantity changes must not automatically rescale them.
- Four-decimal input behavior, numeric boundaries, physical deletion, and existing timestamp rules.
- Goal replacement and all-null clearing, including valid zero macro targets and the distinction between zero and unset.
- Meal future-date validation and allowed future query ranges.
- All completed diary/goal routes and failure behavior, including keeping a meal visible after a failed deletion.

### Completed Phase 7 nutrition reports

Preserve the complete implemented report endpoint and every existing Phase 7 regression case. This includes:

- Report date defaults, required date-pair rules, day/week grouping, inclusive range limits, and bucket pagination.
- Summary totals calculated over the entire selected range independently of the current bucket page or meal-list pagination.
- Missing-date buckets, clipped week coverage, ascending bucket order, and distinction between calendar days and elapsed days.
- Micronutrient units, known totals, known/unknown counts, and all-unknown versus known-zero behavior.
- Current goal snapshot semantics and goal comparison based on the correct elapsed scope, including unlogged days, future-only ranges, unset targets, and zero targets.
- Exact aggregate arithmetic, aggregate totals that can exceed per-entry limits, and established percentage rounding.
- A consistent database snapshot for report data and associated profile/goals.

Do not add charts, a dashboard, AI features, authentication, PDF import, or any other subsequent-phase capability. If the actual completed Phase 7 includes additional approved behavior, migrate and preserve that behavior too.

## 7. Database and credential safeguards

The existing ignored `server/.env` contains the connection and certificate configuration authorized by the user. Reuse the established environment loader and test workflow. Do not reintroduce a mandatory `.env.test`, separate test credentials, or a database-name-based blocker.

Every database mutation performed for verification must use the existing randomized, owned test schema. Enforce that schema on every connection and spawned verification process. Fail closed if isolation cannot be established; never fall back to ordinary application tables.

Use existing before/after snapshots to verify ordinary application data remains unchanged. Clean up only schemas and processes created by this verification run, including on failure. Do not drop or recreate the database or replay production migrations just to validate TypeScript.

Verify the compiled migration runner and SQL path resolution using an owned schema. Existing production migration history must remain untouched.

Never print credentials, copy live values into examples or fixtures, expose server settings through Vite, or modify the real environment/certificate files. Keep the previously reported credential-rotation follow-up separate: do not claim provider-side rotation occurred without evidence, and do not attempt history rewriting as part of this task.

## 8. Verification: fresh evidence required

Because the migration touches the entire application, run the relevant full regression checks fresh. Do not reuse Phase 6 or Phase 7 pass counts as proof of the migrated build.

1. Reproducible `npm ci` in both packages; inspect lockfile changes and avoid unrelated updates.
2. Server and client lint, strict type checking, and production builds.
3. All server credential-free tests, client behavioral tests, and real PostgreSQL integration tests, including Phase 7 reports.
4. Confirm test discovery includes the converted suites. Compare baseline and final suites/counts; explain any count change. A zero-test run or newly skipped regression is not a pass.
5. Start the compiled backend with Node and exercise it against an owned verification schema. Verify it does not depend on development-only TypeScript execution tools. Where useful, use a disposable production install to validate runtime dependencies without disturbing the working checkout.
6. Verify source development startup, compiled startup, invalid/occupied port failure, import safety, graceful shutdown, and release of owned resources. Update test child-process entrypoints and loader options rather than accidentally exercising stale JavaScript.
7. Exercise the compiled migration runner twice in an owned schema: first application and subsequent no-op. Verify SQL asset paths work from the supported invocation locations.
8. Verify the migrated backend report endpoint using the Phase 7 precision, pagination, timezone, goal-comparison, and micronutrient fixtures against real isolated PostgreSQL.
9. Run actual browser workflows in development and production preview against the isolated backend: meal create/list/filter/page/edit/delete, persistence, goal replacement/clearing, failure input retention, direct-route refresh, and browser navigation. Check desktop and narrow layouts, keyboard navigation, and unexpected console/page errors. Reuse an installed real browser if the desktop helper is unavailable; do not substitute a mocked DOM test for browser evidence.
10. Confirm no ordinary application records changed, no owned schemas/listeners remain, and no secrets entered tracked files or output.
11. Run `git diff --check`, inspect the final diff, and inventory remaining application-owned `.js`/`.jsx` files outside dependencies/generated output. Explain allowed tooling exceptions. Confirm old source files are removed only after their replacements and references are verified.

Prefer existing meaningful tests and fixtures. Add targeted tests only for concrete migration risks not already covered, such as compiled entrypoint or asset-path behavior. Do not create superficial tests that merely restate type definitions.

If a check fails, diagnose and fix the migration-related problem, then rerun affected checks. Do not repeatedly rerun unrelated passing checks without a reason. A missing environment, unavailable database, or browser blocker must be recorded as unverified, not silently skipped or reported as passing.

## 9. Documentation and final handoff

Save this instruction in `docs/TYPESCRIPT_MIGRATION_PROMPT.md` and create `docs/TYPESCRIPT_MIGRATION_VERIFICATION.md` with concrete commands, outcomes, test totals, production runtime evidence, isolation/cleanup evidence, and remaining limitations. Do not include credentials.

Update the README with exact setup, development, type-checking, build, production start, test, and migration commands; explain that source is TypeScript and backend production output is JavaScript. Document the existing `.env` and certificate requirements safely.

Update current authoritative language/tooling decisions and source-path examples in relevant design documents. Preserve historical phase prompts and verification reports as historical evidence; mark earlier JavaScript guidance superseded through a clear migration note instead of rewriting old results. Keep completed Phase 7 complete and retain the existing roadmap numbering.

Return:

1. Changes made, grouped by server, client, tooling/tests, and documentation.
2. Verification table with command/check, expected behavior, actual result, and status.
3. Fresh test counts, including Phase 7 coverage, and any baseline differences.
4. Problems found and fixes applied.
5. Remaining JavaScript configuration exceptions and their reasons.
6. Any deviations, limitations, and outstanding operator follow-ups.
7. Current branch/HEAD and whether changes are uncommitted; confirm whether anything was pushed.
8. Final status: `TYPESCRIPT MIGRATION PASSED` only when all required migration gates pass; otherwise `TYPESCRIPT MIGRATION FAILED` with exact remaining blockers.

Completion means strict TypeScript covers all completed application code, both packages build and run correctly, Phase 1–7 behavior is preserved with fresh evidence, and existing data and unrelated work are intact. Stop after this migration. Do not begin Phase 8.

## Technical references

Consult documentation matching the installed tool versions when resolving configuration details:

- TypeScript Node module resolution and emit: https://www.typescriptlang.org/docs/handbook/modules/reference.html
- TypeScript strict checking: https://www.typescriptlang.org/tsconfig/strict.html
- Vite TypeScript support and separate type checking: https://vite.dev/guide/features.html#typescript
- Node TypeScript execution limitations: https://nodejs.org/api/typescript.html
