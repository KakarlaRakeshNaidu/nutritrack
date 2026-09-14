# Phase 8 coding-agent prompt — Nutrition Reports and Dashboard UI

Copy everything below the divider into the coding agent working in NutriTrack.

---

Implement **Phase 8: Nutrition Reports and Dashboard UI** in the existing NutriTrack repository. Phases 1–7 and the TypeScript migration are completed. Use strict TypeScript/TSX throughout new application code. Implement, run, verify, fix observed problems, and report the result. Stop after Phase 8; do not start Phase 9.

## 1. Starting state and repository inspection

Expected repository: `/home/rakeshnaidu/rakesh_linux/NutriTrack`. Inspect the actual current checkout before editing.

Read applicable `AGENTS.md`, README, package manifests/lockfiles, current architecture/roadmap, Phase 6 and Phase 7 verification, and `docs/TYPESCRIPT_MIGRATION_VERIFICATION.md`. Inspect the report endpoint's actual TypeScript schemas, output types, fixtures, and tests; these define the integration contract. Inspect the existing router, API client, profile/date context, forms, pagination, error components, and isolated browser launcher.

The supplied migration report dated 2026-09-13 records:

- Strict TypeScript/TSX application, tests, database helpers, and browser launcher.
- Node 24.16.0, npm 11.13.0, TypeScript 5.9.3.
- Server NodeNext/ES2022 compilation; production runs emitted `dist/server.js` without a TypeScript loader.
- Fresh baseline: 126 server tests, 18 real PostgreSQL tests, 27 client tests; total 171 passed, none failed or skipped.
- All 21 report-focused server tests and real-database report regressions preserved.
- Development and production-preview browser workflows passed using Chrome for Testing 151.
- `main` at `285a8221be047944864be7729e6851fe36f738d9`, with earlier work and migration intentionally uncommitted.

Treat these as supplied historical results and verify the current state; do not invent a new baseline or claim to have rerun checks you have not executed. Earlier documents prescribing JavaScript are superseded by the completed migration.

Preserve all existing changes and unrelated personal ignore rules. Do not reset, clean, stash, discard, change branches, commit, push, or deploy. Existing application behavior and stored data must remain intact. Routine implementation and safe verification are authorized; proceed without repeated permission requests.

## 2. Objective, requirements, and scope

Deliver real API-backed dashboard and report screens covering:

| Requirement | Phase 8 deliverable |
| --- | --- |
| FR-008 | Daily calorie trend across a selected Monday–Sunday week, including dates without entries. |
| FR-009 | Protein, carbohydrates, and fat displayed independently by day or calendar week. |
| FR-010 | Six-micronutrient summary with units and known/unknown coverage. |
| FR-011 | Logged intake versus current calorie/macro targets over the same elapsed dates; saved weight goal without invented actual progress. |
| FR-015 | Browser application data comes exclusively from backend APIs. |
| NFR-002/007 | Recoverable errors, fresh committed data, responsive layouts, keyboard access, and textual alternatives to graphs. |

Implement `/` as the dashboard and add `/reports`. Preserve all existing meal, goals, and not-found routes. Add clear navigation to Reports while retaining manual entry/history/goals access.

This is primarily frontend work. Reuse the completed report API; no new endpoint, database migration, persistence table, report formula, or report cache is expected. If integration exposes a concrete existing defect, make only the necessary documented fix with focused regression coverage. Do not change established API contracts to simplify chart code.

Do not add AI/image workflows, provider calls, food search, authentication, chat, import/export, reminders, actual-weight tracking, target history, or later-phase features.

## 3. Code quality and implementation structure

Code must be easy to read and explain. Use descriptive names, focused functions, ordinary types, and small components with clear responsibilities. Retain strict compiler/lint settings and runtime validation. No blanket `any`, unchecked double assertions, `@ts-nocheck`, or broad lint suppressions.

Reuse the current structure. Reasonable responsibilities include a typed report API wrapper, report query validation, a report-loading hook, Dashboard/Reports pages, and reusable CalorieTrendChart, MacroBreakdownChart, MicronutrientSummary, GoalComparisonChart, and report table components. Adapt names to actual conventions. Do not create a generic chart framework, global state store, or elaborate shared package.

Use the planned Recharts library if not already installed. Select and lock a version compatible with the existing React/TypeScript setup; verify peer dependencies and official documentation for that version. Add only justified dependencies. Keep current runtime/build tooling and separate frontend/backend packages.

Comments are required around non-obvious decisions: full-range summaries versus chart pages, future/unlogged buckets, null-versus-zero values, current-target scope, date-only formatting, and stale request handling. Explain why, without narrating obvious JSX.

## 4. Report API integration and types

Use the central API client and existing public API base URL. Implement a named wrapper for `GET /api/v1/reports/nutrition` supporting cancellation and the existing normalized error contract.

Accepted query fields:

- `start_date` and `end_date`: both present or both absent; valid inclusive calendar dates within the existing backend year bounds, start no later than end, maximum 366 inclusive dates.
- Both absent: backend resolves the current Monday–Sunday week.
- `group_by`: `day` or `week`, default `day`.
- `page`: default 1; `page_size`: default 20, maximum 100, following existing syntax and numeric bounds.
- No `meal_type` filter is supported for reports.

The successful response is the root object containing `range`, `summary`, `goal_snapshot`, `goal_comparison`, `items`, and `pagination`; do not incorrectly unwrap `.data`.

Type the actual transport response, including nullable fields, using existing definitions where practical. Keep backend runtime imports out of the browser. Follow existing API boundary validation practices; do not treat a TypeScript cast as validation or silently replace malformed data with zero.

Use the response as the authoritative source:

- `range` supplies resolved dates, grouping, timezone, and today.
- `summary` covers the entire selected range, independent of bucket page.
- `goal_snapshot` is the current goal configuration used by that report.
- `goal_comparison` covers the selected elapsed dates, using that same snapshot.
- `items` contains only the requested page of calendar buckets.
- `pagination.total_items` counts calendar buckets, not meal records.

Do not fetch all meal pages to calculate totals, sum the current bucket page into full-range cards, reconstruct goal arithmetic in React, or combine report actuals with a separately fetched newer goals response.

## 5. Dashboard at `/`

Replace the foundation home content with a useful dashboard while retaining prominent Log meal, Meal history, Goals, and Reports navigation.

Load a current-week daily report using backend defaults. Show the resolved week and application timezone. The dashboard must include:

- Current-week logged calorie and three macro totals from `summary`, with kcal/g units.
- Logged entry count and distinct logged-day count, labeled accurately.
- Seven-day calorie trend, including unlogged and future dates.
- Current-week macro breakdown using the shared chart.
- Compact six-micronutrient summary with coverage.
- Current-week elapsed-period goal comparison using the report comparison object.
- Saved target weight in kg when configured; otherwise an unset state. No actual weight, weight-change curve, or completion percentage.
- A link to open the same resolved week in `/reports`.

Label weekly totals as weekly. If today's figures are additionally shown, use the returned day bucket matching `range.today`; never label the weekly summary as today.

When there are no meals, show helpful empty-state copy and a Log meal action while preserving useful date context and unset-goal guidance. Zero logged nutrients do not prove zero consumption. Report failure must leave the manual navigation usable.

## 6. Reports page and URL-backed controls

Provide labeled start/end date controls, Day/Week grouping, Apply, a current-week reset, and controls for selecting previous/next Monday–Sunday weeks. Use existing date-only utilities or small tested helpers. Do not derive today from the browser timezone or format a date-only string in a way that shifts its calendar day.

Keep applied range, grouping, page, and page size in URL search parameters. Back/Forward, direct links, and refresh must restore the applied view. Distinguish draft input from applied query state. Applying a new range/grouping/page size resets the page to 1; navigating pages preserves other applied settings.

Default `/reports` resolves to the current week. Populate date controls from authoritative resolved context. Explicit dates in a shared URL remain explicit dates on later visits; the current-week reset resolves fresh backend date context. Future ranges are valid.

Validate complete ranges, actual calendar dates, leap-day boundaries, the 366-day limit, grouping, and pagination. Preserve entered values on errors. Invalid URL parameters must produce a clear correction/reset state, rather than silently displaying a different valid report. Follow existing strict query conventions, including duplicate-key handling. Do not send unknown URL keys to the API.

Display full-range summary and micronutrient/goal panels separately from paginated bucket charts. Place a clear scope label beside chart controls, such as “Showing 21–40 of 60 days”; use weeks for weekly grouping. Page-size controls may offer 20, 50, and 100. Use backend metadata; do not automatically fetch every page.

An out-of-range page with empty `items` must retain full-range summary data and true pagination metadata. Show “No periods on this page” with a working first-page action. Do not describe this as an empty food diary or display impossible item-index ranges.

## 7. Four report families and presentation rules

### A. Calorie trend

Render a line or bar chart of returned bucket `calories_kcal`, with readable calendar labels and kcal units. A selected full week in daily mode displays all seven dates. In weekly mode or longer selections, accurately label the chart's grouping and visible scope rather than calling every view a seven-day trend.

Keep empty calendar positions. Label past/current buckets with zero entries as “No meals logged”; future buckets as “Future.” Future plotted values may be visually omitted or muted, but the dates must remain identifiable and must not appear as successful zero intake. Use entry counts and temporal state to distinguish an explicitly logged zero from no entries. Do not interpolate invented values.

### B. Macronutrient breakdown

Render protein, carbs, and fat as distinct named series by the applied day/week grouping. Use grams, consistent series styling, readable legends, and exact textual values. Grouped or stacked bars are acceptable, but each macro must remain separately identifiable. Do not label grams as calorie share or derive calories using 4/4/9 conversion.

For weekly buckets, display canonical week bounds and clearly identify clipped coverage at selected-range edges. Show only returned covered values; do not imply a partial week contains seven full days of intake.

### C. Micronutrient summary

Show all six nutrients from the full-range summary:

- Sodium, calcium, iron, potassium, vitamin C: mg.
- Vitamin D: mcg.

For each show the known subtotal or “Unknown,” and “Known for X of Y entries,” including unknown counts or equivalent clear coverage information. A coverage bar may show known-entry coverage, explicitly labeled as data completeness. It is not dietary adequacy or a recommended-intake percentage.

Preserve known zero as `0`; all-unknown and no-entry totals remain unknown. Distinguish 0-of-0 no entries from 0-of-N unknown values. Avoid dividing by zero. Do not combine mg and mcg on a common quantitative axis or invent micronutrient targets. Cards with coverage bars and a semantic table satisfy this visual summary requirement.

### D. Goal versus actual

Use the API comparison values for calories, protein, carbs, and fat, including `actual`, `target`, `difference`, `percent`, scope dates, and day count. Render actual/target paired bars or equivalent comparison charts, with calories separate from gram-based measures. Four small labeled metric charts are a simple valid design.

Display “Compared with current targets,” the actual elapsed scope, and the number of compared days, including for historical views. Explain that future dates are excluded. If a partial week/range is selected, use the provided comparison instead of multiplying targets by seven or the visible page length.

Unset target: show “Not set” and no target/percentage graphic. Zero macro target: show target 0 and the provided difference, with percentage “Not applicable”; never divide by zero. Entirely future scope: show that no elapsed dates are available and no goal progress can yet be compared. Follow API null values precisely.

For a positive target, percentages above 100 remain visible and numeric values remain accurate. Do not silently cap displayed progress. Use neutral “above/below target” language; avoid moral or medical judgments about intake. Do not recompute or re-round backend percentages inconsistently.

## 8. Accessibility, formatting, and responsive behavior

Every chart needs a clear title, units, scope, legend where relevant, and an accessible textual/table representation containing its plotted values. Provide a keyboard-operable “View data” disclosure if a persistent table is too large. Do not make hover tooltips the only way to obtain values.

Use the installed chart version's accessibility support, appropriate labels, visible focus, and keyboard-operable controls. Do not depend solely on color. Respect reduced-motion preferences or disable chart animation. Avoid excessive tab stops per data point.

Ensure chart containers have real dimensions and resize correctly. Verify desktop and 375px-wide layouts. Dense chart labels may be reduced visually while complete labels remain in tooltips/tables; a locally scrollable table/chart is acceptable, but the page must not overflow horizontally or hide navigation.

Use a shared number formatter: preserve up to four decimal places for nutrient amounts in exact textual views and the API's percentage precision; do not expose floating-point artifacts, `NaN`, `Infinity`, or negative zero. Abbreviated axes are acceptable when exact values are available elsewhere. Aggregate values can exceed per-entry limits and must not be clamped or rejected by a reused meal-input schema.

## 9. Request lifecycle, freshness, and failures

Reuse the existing abort-plus-sequence protection so superseded requests cannot overwrite current range/group/page state. Clean up listeners and requests on unmount. Do not update state during render.

Provide distinct initial loading, successful data, empty diary, empty page, invalid query, and recoverable request-error states. Retry uses the current applied query. Do not replace failed requests with zero totals. If keeping an older result during refresh, clearly label it as previous data and retain its original scope; never present it under a new range heading.

Fetch dashboard/reports on route entry and refresh on relevant focus/visibility return. Successful meal creation, replacement, deletion, and goal saves must be reflected when returning to these views. Refresh profile context as appropriate, and handle midnight/week rollover using fresh backend context. Preserve user-selected explicit historical ranges. Avoid request loops, unnecessary duplicate loads, and new global polling infrastructure.

Do not alter the established no-automatic-mutation-retry behavior or form error retention. These screens are read-only except for navigation to existing editors.

## 10. Meaningful automated acceptance tests

Add focused TypeScript client tests for actual user-visible behavior and request lifecycle. Use contract-shaped fixtures based on the real Phase 7 output. Mock network responses for client tests, not the report's mathematics. Cover:

1. Correct endpoint/query serialization and root response envelope.
2. Default current week, applied controls, URL restoration, Back/Forward, page reset, and retained invalid input.
3. One-sided/reversed/invalid date ranges, 366 accepted versus 367 rejected, invalid grouping/page size, and future range acceptance.
4. Full-range totals stay unchanged across page sizes/pages: 25 meals × 10 kcal = 250, regardless of chart paging. Include a selection longer than 20 calendar days to exercise real bucket pagination; meal count alone does not create additional buckets.
5. Daily/weekly series, exact units, empty dates, future state, and clipped weeks.
6. Micro fixture 100/null/20/0 gives known total 120, known count 3 of 4; all-unknown, known-zero, and no-entry cases remain distinct.
7. Fixed backend today 2026-09-12, current week 2026-09-07 through 2026-09-13, daily calorie target 2000: six elapsed days, target 12000, actual 250, difference -11750, percent 2.08. Use that response directly and ensure Sunday is future. A fully elapsed week with the same daily target uses 14000.
8. Zero/unset targets, future-only comparisons, percentages above 100, and absence of invented actual-weight progress.
9. Scope 2026-09-10 through 2026-09-15 under the same fixed today: weekly coverage 10–13 and 14–15; four/two calendar days and three/zero elapsed days. Labels must not imply complete weeks.
10. Decimal 0.3 from the API displays without arithmetic artifacts; values exceeding 1,000,000 remain displayable.
11. A slow old response cannot replace a newer result; retry uses current parameters; errors do not become empty/zero success; out-of-range pages preserve summary data.
12. Refresh after meal/goal changes, accessible table controls, correct labels, and loading/error announcements.

Do not mock all chart components into empty placeholders and claim chart integration is verified. Use DOM tests for semantics and a real browser for dimensions, SVG rendering, interaction, and layout. Retain all existing tests; update old home-page assertions only where the dashboard intentionally changes the expected behavior.

## 11. Real database and browser verification

Reuse the ignored `server/.env` and existing verified-CA connection workflow. Do not require `.env.test`, new credentials, or a database-name change. All verification writes must use randomized owned schemas through the established isolated launcher. Enforce owned-schema routing on every connection/process with no ordinary-table fallback.

Take the existing ordinary-application before/after snapshots. Seed only isolated schemas with representative meals/goals. Clean up only owned schemas/processes in failure as well as success paths. No production migrations or ordinary-record mutations are needed.

Run fresh client lint, typecheck, full behavioral suite, and production build. Run server lint, typecheck, credential-free suite, build, and the existing real-database suite once to verify integration remains intact. Record actual counts; 171 is the supplied pre-Phase-8 baseline, not a required final total. Reproducibly install changed package dependencies from lockfiles.

Use a real installed browser against both Vite development and production preview with a real isolated backend, including compiled backend startup for the production-preview check. The existing cached Chrome/Playwright fallback is allowed if the desktop controller fails. Do not weaken checks or claim browser success from build output alone.

Verify:

- Dashboard and `/reports` direct navigation, reload, navigation links, and restored URLs.
- All four report families show fixture-backed values; charts actually render with nonzero dimensions, readable axes, and working accessible data views.
- Current week, historical week, custom daily/weekly range, future range, and more than 20 buckets with page changes.
- Full-range totals and micronutrient coverage remain correct across pagination; out-of-range page recovery works.
- Create a meal through the existing UI, return to reports, edit it, return, delete it, return: reports and dashboard reflect each committed state. Reload verifies persistence.
- Change/clear goals through the existing UI; refreshed comparisons use current goals while meal totals remain unchanged.
- Trigger a controlled read failure and retry; verify selection retention, no false zero totals, and no obsolete response overwrites.
- Keyboard controls and chart/table access; desktop around 1440×1000 and narrow 375×812 layouts; no unexpected console/page errors or persistent chart size warnings.
- No AI/provider calls, no exposed credentials, unchanged ordinary application snapshots, and no remaining owned schemas/listeners.

Retain reproducible test code or documented verification steps appropriate to the existing project. Remove disposable browser profiles and temporary processes. Save a small set of screenshots of populated/empty/mobile reports when practical; screenshots supplement numerical and behavioral evidence rather than replace it.

Run `git diff --check` and inspect the final diff for unrelated changes, generated output, secrets, and accidental JavaScript source regressions. Fix observed Phase 8 issues and rerun affected checks. Broaden verification only when a concrete risk justifies it; do not repeatedly rerun unrelated passing gates.

## 12. Documentation, completion criteria, and handoff

Archive this prompt as `docs/PHASE_8_CODING_PROMPT.md`. Update README with report routes, filters, grouping, pagination scope, timezone/week rules, current-target comparisons, unknown-data meaning, and chart/data-table usage. Document any new dependency and verification commands. Update current architecture/traceability only where Phase 8 changes them; preserve historical reports.

Create `docs/PHASE_8_VERIFICATION.md` with:

1. Changes and key files.
2. Requirements-to-implementation/evidence mapping.
3. Commands/checks, expected outcomes, actual outcomes, and pass/fail status.
4. Fresh automated totals separated into client, server, and database; explicitly identify any carried-forward evidence.
5. Browser workflows, exact fixture values checked, viewport/browser details, and screenshots if available.
6. Problems found and fixes, scope deviations, and any remaining blockers.
7. Isolation/cleanup and ordinary-data-preservation evidence.
8. Current branch/HEAD and uncommitted state; whether anything was pushed.

Required completion criteria: both screens work through real APIs; all four report families are correct and accessible; scope/null/zero/future/pagination semantics are preserved; saved meal/goal changes refresh correctly; strict TS/lint/build and relevant tests pass; both browser modes pass; documentation/comments are present; existing data and earlier behavior are intact.

If a required browser/database/access check cannot run, finish all remaining useful work and record the exact blocker. Do not mark an unavailable check as passed. The earlier provider credential-rotation follow-up remains separate unless new evidence resolves it; do not claim final submission readiness in Phase 8.

End the implementation handoff with **PHASE 8 PASSED** only when all required gates pass. Otherwise use **PHASE 8 FAILED** and list the remaining requirements precisely. Stop after Phase 8; do not generate or implement Phase 9.

## Reference documentation

Consult documentation appropriate to the installed Recharts version:

- [Recharts](https://recharts.github.io/)
- [ResponsiveContainer](https://recharts.github.io/en-US/api/ResponsiveContainer/)
- [Recharts accessibility and keyboard interaction](https://github.com/recharts/recharts/wiki/Recharts-and-accessibility)
