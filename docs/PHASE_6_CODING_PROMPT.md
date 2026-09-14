You are implementing Phase 6 — Manual Diary and Goals Web Workflows
of the Personal Calorie Tracker take-home assignment.

Implement and verify ONLY Phase 6, then stop.

1. READ AND INSPECT FIRST

Read:
- Original assignment.
- Approved PRD.md, HLD.md and LLD.md.
- REQUIREMENT_TRACEABILITY.md.
- IMPLEMENTATION_ROADMAP.md.
- README.md.
- Phase 3, 4 and 5 verification reports.
- Latest instructions about using existing .env configuration.
- Applicable repository instructions.

Inspect actual frontend/backend code, API responses, dependencies,
scripts, Git status and relevant working-tree changes before editing.

Reported baseline:
- Repository: /home/rakeshnaidu/rakesh_linux/NutriTrack, WSL.
- Branch main; base HEAD 285a822.
- Phase 3–5 implementation remains uncommitted.
- Server tests: 105 passed.
- PostgreSQL integration tests: 14 passed.
- Client tests: 1 passed.
- Client lint/build and repository whitespace checks passed.
- Phase 5 reported PASSED.
- All meal CRUD/list, goals GET/PUT and profile APIs exist.
- Shared numeric validation and database mapping utilities exist.
- Meal JSON mutation limit: 65,536 bytes.
- Goals/unrelated JSON limit: 100,000 bytes.
- Tests reuse server/.env through randomized owned schemas.
- Ordinary application data remained unchanged.
- Credential examples were sanitized; actual credential rotation
  remains unverified because provider account management access
  was unavailable.
- No branch, commit or push was created for the latest work.

Treat these as reported facts. Verify actual implementation before
depending on it.

Do not reset to HEAD and erase the uncommitted features.
Preserve existing work, real environment files, certs/ exclusions
and unrelated personal .gitignore changes.
Do not switch branches, rewrite history, stage unrelated changes
or push remotely.

Comments are REQUIRED.
Code must remain clean, modular, readable and easy to explain.

2. OBJECTIVE AND REQUIREMENT COVERAGE

Build working browser interfaces for:
- Creating meals manually.
- Viewing and filtering meal history.
- Navigating backend pagination.
- Reading and editing existing meals.
- Deleting meals with confirmation.
- Reading, setting, replacing and clearing goals.

Every application-data operation must use the existing backend APIs.

Coverage:
- FR-001–007: goals, meal CRUD, filtering and pagination.
- FR-015/016/018: API separation, persisted data and single-user scope.
- NFR-001/002/007: validation, reliable errors and usable interfaces.
- Continuing NFR-003/004/005/006: clean code, documentation,
  required comments and security boundaries.

This phase must complete the manual browser-to-database workflow
before AI work begins.

3. ROUTES AND VISIBLE SCOPE

Implement:
- /meals
- /meals/new
- /meals/:id/edit
- /goals

Update the existing / page with working navigation into these
manual workflows. The report-driven dashboard belongs to Phase 8.

Use the existing React Router structure.
Support direct entry, refresh and normal browser Back/Forward
behavior for implemented routes.
Provide a useful frontend not-found state for unsupported routes.

Do not add:
- Reports/charts.
- Fake dashboard statistics.
- Image upload or AI entry.
- Login/signup.
- Chat or PDF import.
- Links/buttons for features that do not exist yet.

Do not add a separate meal-detail route merely because an edit page
already needs to load a meal. History may expose additional meal
details inline when useful.

Keep styling cohesive with the existing application.
Use readable spacing, labels, units and responsive layouts.
No new design system, UI framework or decorative dependency is
required.

4. FRONTEND DEPENDENCIES AND STRUCTURE

Use:
- Existing React/Vite/React Router.
- React Hook Form for forms.
- Zod for useful client-side validation.
- A compatible form resolver if needed.

Inspect installed versions first.
Add only dependencies required for this phase, with compatible
locked versions and updated package-lock.json.

Do not install Recharts yet.
Do not add Redux, a generic form framework, an unnecessary global
store or a new CSS framework.

Expected files, adapted to existing naming conventions:

client/src/api/
- client.js
- meals.js
- goals.js
- profile.js

client/src/pages/
- MealHistory.jsx
- MealEditor.jsx
- Goals.jsx

client/src/components/
- MealForm.jsx
- GoalForm.jsx
- MealFilters.jsx
- PaginationControls.jsx
- Reusable loading/empty/error components where actual reuse exists.

client/src/validation/
- Meal and goal schemas/serialization.

client/src/utils/
- Nutrition field names/units.
- Date-only presentation helpers when needed.

Also update:
- Existing app routes/navigation/styles.
- Client tests.
- README.md.
- docs/PHASE_6_VERIFICATION.md.

Do not duplicate equivalent existing files.
A small reusable hook is acceptable when it solves actual repeated
behavior; do not create speculative hooks/context providers.

5. CENTRAL FRONTEND API CLIENT

Use VITE_API_BASE_URL as the public backend API base.

Implement one shared request/error boundary and small endpoint
wrappers for:

GET /profile
GET /meals
GET /meals/:id
POST /meals
PUT /meals/:id
DELETE /meals/:id
GET /goals
PUT /goals

These paths are relative to the configured /api/v1 base.

Requirements:
- Application data comes exclusively through HTTP APIs.
- Never import server modules into browser code.
- Never use pg, database credentials or provider keys in the client.
- No authentication-token or cookie-credential logic.
- Set application/json for JSON request bodies.
- Handle 204 without attempting JSON parsing.
- Parse the backend error envelope once.
- Expose safe code/message/details/request_id to callers.
- Handle non-JSON proxy errors and network failures safely.
- Preserve list pagination metadata exactly.
- Avoid inconsistent extra response wrapping between endpoints.
- Support AbortController for stale read requests.
- Never automatically retry POST, PUT or DELETE.
- No browser localStorage database or persistent draft requirement.

Do not implement multipart extraction or AI timeout behavior yet.

6. PROFILE AND DATE CONTEXT

Use GET /profile for:
- timezone
- today
- week_start
- week_end

Do not derive authoritative today from the browser clock.

Refresh date context on app/page entry and relevant focus or
submission events as described by the LLD.
Use existing backend date semantics:
- YYYY-MM-DD calendar dates.
- Initial persisted timezone Asia/Kolkata.
- Future consumption prohibited.
- Inclusive history filters.
- Monday–Sunday weeks.

For new meals, use backend today as the initial date once available.
Do not overwrite a user's selected date or other dirty inputs when
profile data refreshes.

If profile loading fails:
- Show a useful retry/error state.
- Do not invent today or silently use the browser timezone.
- Avoid blocking unrelated goals/history functionality unnecessarily.

Client validation uses the latest available backend today.
Backend rejection remains authoritative if the date context changes
between form load and save.

Preserve date-only strings when displaying/editing them.
Avoid timezone shifts caused by treating them as local timestamps.

7. SHARED MEAL FORM

Use one MealForm for both create and edit.
Design it for later reuse with an image draft without implementing
image extraction or incomplete-draft behavior now.

Fields:
- Food name.
- Meal type: Breakfast, Lunch, Dinner, Snacks.
- Consumption date.
- Consumed quantity.
- Quantity unit: g, ml, serving, piece.
- Calories in kcal.
- Protein/carbohydrates/fat in grams.
- Sodium/calcium/iron/potassium/vitamin C in mg.
- Vitamin D in mcg.
- Source/estimate metadata consistent with the existing API.

Display near the nutritional inputs:
“Nutrition values are totals for the consumed amount.
Review these totals when changing quantity.”

Never automatically multiply nutrition when quantity changes.
Never derive calories from macros.

New manual entries default to:
- entry_source: manual
- is_estimate: false

For editing:
- Preserve loaded provenance and estimate values.
- Make source/estimate state visible.
- If the user changes provenance, enforce food_plate implies
  is_estimate=true.
- Do not silently turn an estimated plate entry into a manual
  non-estimated entry.
- Do not add provider terminology or an image-upload workflow.

Client validation mirrors the server contract:
- Food name trimmed, nonblank, maximum 200.
- Quantity >0 and <=1,000,000.
- Core nutrients >=0 and <=1,000,000.
- Numeric precision at most four decimal places.
- Supported enums and valid real dates.
- All required fields must be supplied.

Input normalization:
- Blank optional micronutrient input -> null.
- Explicit "0" -> numeric 0.
- Blank required core nutrition -> validation error.
- Convert nonblank numeric input only after checking it.
- Do not use Number("") or Number(null) as normalization.
- Do not silently round invalid precision.

Always submit every required writable field and all six micro keys.
Do not spread an API response into the request and accidentally
submit id/created_at/updated_at.

Provide inline errors tied to labeled fields.
Map backend detail paths, including micronutrients.field_name,
to the correct form inputs.
Show whole-form errors when no field mapping applies.

8. CREATE AND EDIT WORKFLOWS

Create:
- Load required date context.
- Collect complete manual data.
- Validate and POST once.
- Disable repeated submission while pending.
- Show success only after confirmed API success.
- Navigate to history or another clear saved-entry state.
- Ensure subsequent history reads use committed backend data.

Do not claim a newly saved entry must be visible on the current
filtered history page if its date/category is outside those filters.

Edit:
- Load the individual meal through GET /meals/:id.
- Show loading, missing-record and error states.
- Populate the form once the correct record is loaded.
- Do not overwrite dirty edits during an incidental refetch.
- PUT the complete writable representation.
- Preserve server-owned fields by excluding them from the payload.
- Refresh affected views after confirmed success.

Failed saves:
- Preserve all entered values.
- Display usable validation or request errors.
- Re-enable appropriate controls.
- Do not navigate as if the save succeeded.

For an ambiguous mutation failure, such as the network failing
after a possible commit, explain:
“Could not confirm the save. Check history before submitting again.”

Do not automatically retry or claim the backend definitely did not
save the entry.

9. HISTORY, FILTERS AND PAGINATION

History must use the paginated GET /meals API.

Display useful entry information:
- Consumption date and meal type.
- Food name.
- Quantity/unit.
- Calories and macros with units.
- Access to micronutrients/source/estimate details.
- Working edit/delete actions.

Unknown micronutrients must display Unknown or equivalent,
not a fabricated zero.

Use a responsive presentation.
Do not force a wide desktop table to become unusable on a phone.

Filters:
- Optional start date.
- Optional end date.
- Meal type with an All option that omits the API parameter.
- Validate reversed/invalid ranges.
- Allow one-sided bounds and future query bounds.
- Do not apply the report-only 366-day restriction to history.

Use URL search parameters for applied filters and paging so
refresh and Back/Forward restore the view.

Pagination:
- Default page 1 and page_size 20.
- Use backend metadata for counts/pages/navigation.
- Do not download all records and paginate in the browser.
- Applying/resetting filters resets page to 1.
- Preserve filters while navigating pages.
- Handle empty results and valid out-of-range pages honestly.
- Do not silently turn invalid URL query values into arbitrary
  valid ones; show a useful correction/reset path.

Abort or disregard stale reads when filters/pages change.
An older response must never overwrite a newer result.
Ensure effect dependencies do not create request loops.

10. DELETE WORKFLOW

Provide a simple accessible confirmation identifying the meal.
A browser confirmation or small dialog is sufficient.

On confirmation:
- Send DELETE once.
- Disable repeated action while pending.
- Treat 204 as successful without JSON parsing.
- Refetch history using current filters.
- Update count/page state from backend metadata.

If deleting the last item makes the current page exceed the new
last page, navigate to a valid page and refetch.
For an empty result set, show the empty state on page 1.

On failure:
- Keep the visible record until its state is confirmed.
- Show an appropriate error/recovery path.
- Do not claim deletion succeeded.
- Do not automatically retry.

11. GOALS PAGE

Load GET /goals and render all five targets:
- Daily calories, kcal.
- Daily protein, g.
- Daily carbohydrates, g.
- Daily fat, g.
- Target weight, kg.

Use GoalForm with complete PUT replacement.

Rules:
- Every request contains all five keys.
- Blank input -> null.
- Explicit zero macro target -> 0.
- Zero calorie/weight target -> validation error.
- Respect server numeric bounds and four-decimal precision.
- All-null submission is valid and clears all goals.

Show useful loading, unconfigured, success and error states.
Preserve input after failed saves.
Disable repeated submit while pending.
Initialize/refill from confirmed data without clobbering dirty edits.

Identify these as current targets.
Do not add goal history, weight measurements, weight-progress
charts or recommended dietary targets.

12. ACCESSIBILITY AND UI STATES

Implemented pages must provide:
- Semantic navigation and headings.
- Explicit field labels and visible units.
- Keyboard-operable controls.
- Visible focus.
- Errors associated with inputs.
- Status feedback accessible to assistive technology.
- Loading, empty, error and success states where applicable.
- Responsive layouts at narrow and desktop widths.
- Text rendering of food names; do not render user content as HTML.

Do not rely on color alone for errors or estimate status.
Keep implementation details out of ordinary user-facing copy.

13. TESTING

Use Vitest and React Testing Library already established.
Use realistic backend-contract fixtures for frontend tests.

API-client tests:
- Correct base URL/path/query construction.
- Correct JSON body/header behavior.
- Single-resource versus collection responses.
- 204 handling.
- Backend field errors/request IDs.
- Non-JSON errors and network failures.
- No automatic mutation retries.
- Stale read cancellation/ignored late responses.

Form tests:
- Blank micros/goals -> null.
- Explicit zero retained.
- Blank core nutrition rejected.
- Correct numeric precision/bounds.
- Complete POST/PUT payload without server-owned fields.
- Backend-derived date validation.
- Quantity change does not rescale nutrition.
- Edit retains source/estimate values.
- Failed save preserves values.
- Pending submit cannot trigger duplicate requests.
- Goal setting, replacement and all-null clearing.

History tests:
- Filters reset page.
- Page navigation preserves filters.
- Backend metadata drives navigation.
- Empty and out-of-range states.
- Late old response cannot overwrite new results.
- Delete confirmation/cancel.
- Successful delete handles 204 and refetches.
- Last-item deletion moves to a valid page.
- Failed delete does not show false success.

Do not add tests that merely duplicate every component line.
Prioritize these behavioral risks.

14. REAL BROWSER AND DATABASE VERIFICATION

Unlike the backend-only phases, Phase 6 requires fresh browser
verification of the actual manual workflows.

Reuse server/.env and the existing randomized owned-schema harness.
Launch a real backend HTTP server routed entirely to its test schema.

Configure the test frontend's public API base URL to point to that
disposable backend without overwriting existing environment files.

Ensure CORS matches the actual browser origin:
- Vite development and production preview may use different ports.
- Configure the isolated backend appropriately for each check.
- Do not disable CORS or add unrestricted origins to make tests pass.

No disposable browser mutation may reach ordinary application tables.

Use available WSL Chromium/browser automation if desktop helpers fail.
DOM tests alone do not prove the full browser-to-database workflow.

Verify:
1. Open the app and navigate to New Meal.
2. Create a meal with known zero and unknown micro values.
3. Confirm success and find it through history/filtering.
4. Refresh and confirm persistence.
5. Edit quantity and explicitly supplied nutrient totals.
6. Confirm saved values match the submitted totals.
7. Exercise date and meal-type filters.
8. Navigate history across more than 20 fixture meals.
9. Delete with confirmation; verify the entry is absent.
10. Set goals, reload and verify persistence.
11. Replace goals and clear them to all-null.
12. Exercise invalid input and simulated failed-save recovery.
13. Confirm manual operation without AI credentials.
14. Check direct route refresh and Back/Forward.
15. Check desktop and narrow widths, keyboard operation and console.
16. Build and preview the frontend with the correct test API base,
    then verify key routes/workflows again.
17. Confirm ordinary application data remains unchanged.
18. Stop owned processes and remove only owned test schemas.

If a browser truly cannot be used, complete all other useful work
and report the browser gate as blocked. Do not claim Phase 6 passed
solely from a Vite build or mocked component tests.

15. COMMANDS AND REGRESSION

Follow:
IMPLEMENT → RUN → TEST → VERIFY → FIX → RE-TEST → REPORT

From repository root:

npm --prefix client ci
npm --prefix client run lint
npm --prefix client test
npm --prefix client run build
npm --prefix server run lint
npm --prefix server test
npm --prefix server run test:db
git diff --check
git status --short

Run the existing dev/preview scripts with the isolated verification
configuration and record actual browser evidence.

Keep backend changes minimal. If a real API defect blocks the UI,
demonstrate it, make the smallest contract-consistent fix and rerun
affected backend checks.

Do not change API contracts merely to simplify the frontend.
Do not weaken schema isolation, TLS or existing validation.
Do not reintroduce .env.test or separate credential requirements.

16. DOCUMENTATION, COMMENTS AND SCOPE

Update README with:
- Frontend setup and VITE_API_BASE_URL.
- CORS/origin coordination for dev and preview.
- Implemented routes and manual workflows.
- Form units and consumed-total semantics.
- Null versus zero behavior.
- Filter/pagination behavior.
- Tests and safe browser verification.
- Current scope and remaining features.

Comments must explain non-obvious behavior:
- Blank/null/zero serialization.
- Date-only/backend-today handling.
- Stale-response protection.
- Complete PUT payload construction.
- Ambiguous save outcomes and no automatic retry.

Keep credential rotation recorded as outstanding unless verified.
Do not repeat real credentials in examples, reports or fixtures.
Do not claim final submission readiness while that follow-up is open.

Out of scope:
- Reporting APIs and calculations.
- Charts and report-driven dashboard.
- Image upload/AI extraction or provider calls.
- Authentication, chat or PDF import.
- Extra infrastructure and Phase 7 work.

17. COMPLETION AND FINAL RESPONSE

Write docs/PHASE_6_VERIFICATION.md.

Return:
1. Changes made: actual files and purpose.
2. Verification performed:
   action, expected result, actual result and PASS/FAIL;
   distinguish automated, browser and carried-forward evidence.
3. Tests:
   client/server/database passed, failed and skipped totals.
4. Browser workflows:
   routes, viewport sizes, real API/database target isolation,
   results and any unavailable checks.
5. Problems found.
6. Fixes applied.
7. Deviations: reasons or None.
8. Outstanding security follow-up.
9. Phase status:
   exactly PHASE 6 PASSED or PHASE 6 FAILED.

Only mark Phase 6 passed when the complete manual browser workflow,
required form/error behavior and relevant regressions are verified.

Report actual Git/working-tree state.
Preserve existing uncommitted work and unrelated changes.
Do not push remotely.

STOP after Phase 6.
Do not implement Phase 7 or generate its coding prompt.