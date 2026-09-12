# Personal Calorie Tracker — LLD

Status: reviewed implementation specification. Follow the original assignment and fixed decisions represented in PRD/HLD. Comments are required for important logic/decisions. Everything below describes intended files, schemas, contracts, and tests; no application code, SQL migration files, or implementation phases are produced by this deliverable.

The mandatory application is single-user. Authentication, account management, and independent-user ownership are bonus-only and absent from this schema and request flow.

## 1. Repository structure

Use JavaScript ES modules, JSX, Node.js 24 LTS, Express 5, React/Vite, React Router, Recharts, React Hook Form, Zod, and `pg`. Commit dependency lockfiles during implementation. Supporting backend packages have specific jobs: `cors`, `helmet`, `express-rate-limit`, `multer`, `sharp`, and `@google/genai` for Gemini transport. Grok uses Node's native fetch. Use plain functions; no ORM, global service container, generic CRUD framework, or abstract provider class is needed.

| Intended path | Responsibility |
| --- | --- |
| `README.md` | Reproducible setup, run, validation, assumptions, and limitations. |
| `client/package.json`, `server/package.json` | Separate application dependencies and scripts. |
| `client/src/main.jsx`, `App.jsx` | React bootstrap and React Router routes. |
| `client/src/api/client.js` | Central JSON/multipart requests and error parsing. |
| `client/src/api/meals.js`, `goals.js`, `reports.js`, `nutrition.js`, `profile.js` | Small named endpoint wrappers. |
| `client/src/pages/` | Dashboard, MealHistory, MealEditor, Goals, Reports, ImageEntry. |
| `client/src/components/` | Reusable form, filter, pagination, chart, upload, and state components. |
| `client/src/validation/` | UX form schemas and blank/number conversion. |
| `client/src/utils/calendar.js`, `nutritionFields.js` | Date-only presentation helpers; fixed field labels/units. |
| `client/src/styles/` | Responsive styles and shared visual tokens. |
| `server/src/app.js`, `server.js` | Express composition separate from process startup/shutdown. |
| `server/src/config/env.js`, `constants.js` | Validated environment and fixed limits/enums. |
| `server/src/db/pool.js`, `transaction.js`, `migrate.js` | One pool, transaction lifetime, explicit migration runner. |
| `server/src/modules/meals/` | `meal.routes.js`, `meal.controller.js`, `meal.service.js`, `meal.repository.js`, `meal.schemas.js`. |
| `server/src/modules/goals/` | Corresponding focused goal files. |
| `server/src/modules/reports/` | Report route/controller/service/repository/schema files. |
| `server/src/modules/profile/` | Read-only singleton profile/date context; thin route/controller/service/repository files. |
| `server/src/modules/nutrition/` | Extraction route/controller, `ai.service.js`, `ai.schemas.js`, `image.js`, provider modules. |
| `server/src/modules/nutrition/providers/` | `gemini.provider.js`, `grok.provider.js`; vendor transport and response adaptation only. |
| `server/src/middleware/` | Validation, request ID, upload/rate limits, not-found, centralized errors. |
| `server/src/utils/calendar.js`, `errors.js`, `numbers.js` | Focused date, error, and validated serialization helpers. |
| `server/migrations/001_initial_schema.sql` | Intended initial schema and singleton seed, executed explicitly. |
| `server/tests/`, `client/tests/` | Focused tests from section 27. |
| `docs/` | PRD, HLD, LLD, traceability, and design review. |

A thin controller may contain only HTTP translation; do not create another service/repository layer when it has no separate responsibility. Shared calendar/validation policies have one authoritative backend implementation. The required client-side mirror is tested against contract fixtures.

## 2. Database schema

Three domain tables plus migration metadata. No authentication, credentials, sessions, account-management, or ownership columns. These independent singleton/resources require **no foreign keys**; do not invent relationships for future bonuses. Nutrient definitions are a fixed code configuration, not an extra table.

### 2.1 Common conventions

- `NUMERIC(12,4)` stores exact decimal inputs; API inputs allow at most four decimal places and maximum 1,000,000 unless a narrower rule is stated. These are computational bounds, not health recommendations.
- All `TIMESTAMPTZ` values serialize as UTC ISO timestamps; PostgreSQL DATE stays a calendar-date string.
- Use named CHECK constraints. `NOT NULL` is explicit where indicated.
- IDs and timestamps are server-owned; requests containing them are rejected.
- `updated_at` is assigned on every successful replacement by the update statement; `created_at` is preserved.

### 2.2 `tracker_profile`

| Column | PostgreSQL type | Null? | Default | Constraints |
| --- | --- | --- | --- | --- |
| `id` | SMALLINT | No | 1 | Primary key; CHECK id = 1; singleton. |
| `display_name` | VARCHAR(100) | No | 'Personal user' | Trimmed length 1–100. |
| `timezone` | VARCHAR(64) | No | 'Asia/Kolkata' | Nonempty; valid IANA timezone checked when loaded by the backend. |
| `created_at` | TIMESTAMPTZ | No | now() | Server-owned. |
| `updated_at` | TIMESTAMPTZ | No | now() | Server-owned. |

Seed row 1 during migration. This persists the single user's profile and date convention, satisfying user-data persistence without introducing accounts. It is read-only through the mandatory API. The README explains how an operator can set the initial display name/timezone before use. Changing timezone later changes the definition of today, not any stored consumption_date.

### 2.3 `goals`

| Column | PostgreSQL type | Null? | Default | Constraints |
| --- | --- | --- | --- | --- |
| `id` | SMALLINT | No | 1 | Primary key; CHECK id = 1. |
| `daily_calories_kcal` | NUMERIC(12,4) | Yes | NULL | NULL or > 0 and <= 1,000,000. |
| `daily_protein_g` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `daily_carbs_g` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `daily_fat_g` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `target_weight_kg` | NUMERIC(12,4) | Yes | NULL | NULL or > 0 and <= 1,000,000. |
| `created_at` | TIMESTAMPTZ | No | now() | Server-owned. |
| `updated_at` | TIMESTAMPTZ | No | now() | Set on replacement. |

Seed row 1 with all five targets NULL. No history/version rows. The primary-key index is sufficient; no additional unique constraints or indexes are needed. Initial setting and later editing use the same PUT resource.

### 2.4 `meals`

| Column | PostgreSQL type | Null? | Default | Constraints |
| --- | --- | --- | --- | --- |
| `id` | UUID | No | gen_random_uuid() | Primary key. |
| `food_name` | VARCHAR(200) | No | None | Trimmed length 1–200; Unicode accepted. |
| `meal_type` | VARCHAR(10) | No | None | breakfast, lunch, dinner, or snacks. |
| `consumption_date` | DATE | No | None | Valid supported calendar date; future check at authoritative API boundary, section 4. |
| `consumed_quantity` | NUMERIC(12,4) | No | None | > 0 and <= 1,000,000. |
| `quantity_unit` | VARCHAR(10) | No | None | g, ml, serving, or piece. |
| `calories_kcal` | NUMERIC(12,4) | No | None | 0–1,000,000. |
| `protein_g` | NUMERIC(12,4) | No | None | 0–1,000,000. |
| `carbs_g` | NUMERIC(12,4) | No | None | 0–1,000,000. |
| `fat_g` | NUMERIC(12,4) | No | None | 0–1,000,000. |
| `sodium_mg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `calcium_mg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `iron_mg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `potassium_mg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `vitamin_c_mg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `vitamin_d_mcg` | NUMERIC(12,4) | Yes | NULL | NULL or 0–1,000,000. |
| `entry_source` | VARCHAR(20) | No | 'manual' | manual, nutrition_label, or food_plate. |
| `is_estimate` | BOOLEAN | No | false | food_plate requires true. |
| `created_at` | TIMESTAMPTZ | No | now() | Server-owned. |
| `updated_at` | TIMESTAMPTZ | No | now() | Set on replacement. |

Indexes: `(consumption_date DESC, created_at DESC, id DESC)` and `(meal_type, consumption_date DESC, created_at DESC, id DESC)`. No uniqueness on food/date/category: repeated meals are legitimate. No other unique constraints. Add a supported-year CHECK from 1900-01-01 through 9999-12-31, consistently validated in the API. Do not use a timezone-dependent `CURRENT_DATE` CHECK for the future-date rule; the backend supplies the authoritative today.

`entry_source` describes user-confirmed provenance, not cryptographically verified origin. `is_estimate` remains visible in entry details after AI-assisted saving. Corrections may change its value except a plate source always remains identified as estimated.

### 2.5 `schema_migrations`

| Column | Type | Null? | Default | Constraints |
| --- | --- | --- | --- | --- |
| `version` | INTEGER | No | None | Primary key; > 0. |
| `name` | VARCHAR(200) | No | None | Unique, nonempty migration filename. |
| `applied_at` | TIMESTAMPTZ | No | now() | Server timestamp. |

No foreign keys or additional indexes. Apply each pending migration and its version record atomically. Existing migration versions are not replayed. Starting the API does not run a destructive seed/reset.

## 3. Meal entry model

All nutritional values represent the **entire consumed_quantity**. Example: if quantity is 150 g and calories_kcal is 180, the saved entry contributes 180 kcal. The backend does not multiply those totals again.

Use full `PUT`, not PATCH, for updates. `updateMealSchema` requires the complete writable representation, equal to createMealSchema. Missing fields are errors; explicit null micronutrients clear the corresponding stored value. This makes update behavior straightforward to explain and prevents accidental defaults from erasing omitted fields. ID and created_at stay unchanged; updated_at changes. Concurrent complete updates use last-committed-write semantics; collaborative editing is outside scope.

The quantity field and nutrition fields are independently supplied consumed facts. Quantity edits do not auto-rescale: the form displays “Nutrition values are totals for the consumed amount. Review these totals when changing quantity.” A changed recipe can legitimately have a different nutrient density. Any future portion calculator must produce an explicitly reviewed consumed-total payload rather than changing this API meaning.

### 3.1 Writable meal representation

All top-level keys below are required in POST and PUT. All six micronutrient keys are required and nullable. This JSON is an illustrative API payload, not application implementation.

```json
{
  "food_name": "Example yogurt",
  "meal_type": "breakfast",
  "consumption_date": "2026-09-10",
  "consumed_quantity": 150,
  "quantity_unit": "g",
  "calories_kcal": 180,
  "protein_g": 9,
  "carbs_g": 27,
  "fat_g": 3,
  "micronutrients": {
    "sodium_mg": 0,
    "calcium_mg": 120,
    "iron_mg": null,
    "potassium_mg": null,
    "vitamin_c_mg": null,
    "vitamin_d_mcg": null
  },
  "entry_source": "manual",
  "is_estimate": false
}
```

`Meal` response = these fields plus `id`, `created_at`, `updated_at`. A repository mapper flattens/nests the six micronutrients explicitly. Unknown keys are rejected. API numbers are JSON numbers, not numeric strings. PostgreSQL NUMERIC remains authoritative; explicitly serialize finite supported values to numbers without converting NULL. Display values can be rounded independently; stored snapshots retain up to four decimals. Report percentages are rounded to two decimals.

## 4. Date model

`consumption_date` is PostgreSQL `DATE`, never a timestamp. `created_at`/`updated_at` use TIMESTAMPTZ. At bootstrap configure `pg` DATE parsing to return the original `YYYY-MM-DD` string, avoiding its default local-time conversion. [pg date handling](https://node-postgres.com/features/types)

`getDateContext(now)` reads the singleton profile timezone and builds today's ISO calendar date from `Intl.DateTimeFormat` date parts for the injected/current instant. Do not depend on process timezone, browser timezone, locale-formatted display strings, or PostgreSQL session CURRENT_DATE. Validate the timezone through Intl when loading it; an invalid profile is a configuration error. Capture now/today once per request. Tests inject a fixed instant.

The schema first validates real Gregorian dates, including leap years, and the supported year range. The meal service then requires consumption_date <= captured today for POST and PUT. All database mutations are reachable only through this boundary. Do not store client-supplied timestamps or silently replace future dates with today.

Date-range comparisons use calendar dates directly: consumption_date >= start_date and <= end_date. Filter/report endpoints may include future bounds; the ban is on consumed records. This lets a current-week report include its upcoming Sunday. Relative dates are supplied by the profile/date-context API.

## 5. Reporting week

Weeks start Monday and end Sunday, inclusively. Use calendar arithmetic based on the DATE value, not created_at. Derive the ISO weekday; subtract weekday-1 days for Monday, then add six days for Sunday. A date-only helper may use UTC as an arithmetic container after parsing components; it must not reinterpret the diary date as an actual consumed timestamp.

For 2026-09-13 (Sunday), week_start is 2026-09-07; for 2026-09-14 (Monday), week_start is 2026-09-14. A weekly bucket intersecting a custom range retains its canonical Monday/Sunday plus clipped covered_start/covered_end. Totals and target day counts use the clipped inclusive coverage.

## 6. Nutrient representation

Core calorie/macronutrient fields are required nonnegative finite numbers for saved meals. Saved micros are nullable. Known zero counts as a known record. NULL is never a substitute for known zero, and zero is never a substitute for unknown.

Do not coerce body nulls or empty strings with a general number coercer. Zod body schemas accept actual numbers or explicit nullable micros only. Frontend blanks map to null only for nullable fields; blank core fields remain validation errors. Accept label calories even if they do not exactly equal the common macro-energy approximation. The mandatory macro charts show grams, avoiding unsupported energy-share claims.

## 7. Supported micronutrients

| API/DB field | Display name | Canonical unit |
| --- | --- | --- |
| sodium_mg | Sodium | mg |
| calcium_mg | Calcium | mg |
| iron_mg | Iron | mg |
| potassium_mg | Potassium | mg |
| vitamin_c_mg | Vitamin C | mg |
| vitamin_d_mcg | Vitamin D | mcg |

The fixed map is used for form labels, serialization, and report display. All six columns default to NULL. This is limited coverage. Percentage Daily Value is not a canonical quantity; if an image gives only a percentage and no reliable amount, retain an unknown field with a note instead of treating the percentage as mg.

## 8. Meal CRUD API

Prefix: `/api/v1`. JSON successes use `{ "data": ... }` for a single resource. Collections use `{ "items": [], "pagination": ... }`. All errors follow section 25. JSON mutation routes require application/json and reject oversized bodies above 64 KiB.

| Method/path | Purpose and request | Zod contract | Success | Errors |
| --- | --- | --- | --- | --- |
| POST `/api/v1/meals` | Create; complete writable meal body; no query | createMealSchema + dynamic date validation | 201, data: Meal; Location header identifies `/api/v1/meals/{id}` | 400 malformed JSON; 413 body too large; 415 content type; 422 fields/date; 503 DB unavailable; 500 unexpected |
| GET `/api/v1/meals` | Filter/list; queries in section 10; no body | mealListQuerySchema | 200, items: Meal[], pagination | 422 query; 503 DB unavailable; 500 unexpected |
| GET `/api/v1/meals/:id` | Read one; UUID path; no query/body | mealIdParamSchema | 200, data: Meal | 422 ID; 404 missing; 503 DB unavailable; 500 unexpected |
| PUT `/api/v1/meals/:id` | Full replacement; UUID plus complete writable body | mealIdParamSchema + updateMealSchema + dynamic date validation | 200, data: updated Meal | 400/413/415 body; 422 ID/fields/date; 404 missing; 503 DB unavailable; 500 unexpected |
| DELETE `/api/v1/meals/:id` | Delete one; UUID; no query/body | mealIdParamSchema | 204, no response body | 422 ID; 404 missing including repeat deletion; 503 DB unavailable; 500 unexpected |

No collection bulk deletion or upsert-on-missing PUT. A valid missing ID is 404. Rows are physically deleted because audit history is not required. Single statements use parameterized values and RETURNING where useful. UI confirmation precedes deletion; other ordinary actions do not require a confirmation ceremony.

## 9. Goal and profile APIs

`GoalInput` has five required nullable keys: daily_calories_kcal, daily_protein_g, daily_carbs_g, daily_fat_g, target_weight_kg. `Goals` response adds updated_at. No owner/user ID is accepted. All null means unconfigured.

| Method/path | Request/schema | Success | Errors |
| --- | --- | --- | --- |
| GET `/api/v1/goals` | No query/body; reject unknown queries | 200, data: Goals, including null fields before first setting | 422 unexpected query; 503 DB unavailable; 500 unexpected |
| PUT `/api/v1/goals` | Complete GoalInput; goalSchema | 200, data: Goals for both first setting and later replacement | 400/413/415 body; 422 values/missing keys; 503 DB unavailable; 500 unexpected |
| GET `/api/v1/profile` | No query/body | 200, data: {display_name, timezone, today, week_start, week_end} | 422 unexpected query; 503 DB unavailable; 500 invalid profile/unexpected |

The migrated singleton already exists, so no goal POST is necessary. PUT replaces all five target values and timestamps the change. No goal history/list API is introduced. Profile has no edit/account API. Frontend uses profile dates rather than independently determining today.

## 10. Meal-list filtering

| Query | Default | Rule |
| --- | --- | --- |
| start_date | Omitted = no lower bound | Strict real YYYY-MM-DD, year 1900–9999. |
| end_date | Omitted = no upper bound | Strict real YYYY-MM-DD; when both exist require start <= end. |
| meal_type | Omitted = all four | One of breakfast/lunch/dinner/snacks; the UI omits its “All” selection. |
| page | 1 | Positive decimal integer string; maximum 2,147,483,647. |
| page_size | 20 | Positive decimal integer string, 1–100. |

Reject repeated query keys, arrays, unknown keys, blanks, fractional/exponential/negative numeric strings, and invalid dates. Do not silently cap page_size. A future range bound is valid; only future consumption_date writes are forbidden. Filters are applied before both the total count and the paginated query. Keep WHERE parameter construction shared between those queries. Ordering: consumption_date DESC, created_at DESC, id DESC.

## 11. Pagination contract

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_items": 0,
    "total_pages": 0
  }
}
```

offset = (page-1) × page_size; total_pages = ceiling(total_items/page_size), zero when total_items is zero. An out-of-range page preserves actual total_items/total_pages. Use a short REPEATABLE READ, READ ONLY transaction for separate count and page queries so they share one database snapshot. Do not use a window count that disappears when the requested page has no rows.

Report buckets use the identical metadata contract and are ordered ascending by canonical period_start. Report summaries and goal calculations are independent of page/page_size. The only mandatory collection endpoints are meals and report buckets; singleton goals/profile and one extraction result are not collections.

## 12. Reporting API and output

GET `/api/v1/reports/nutrition` returns all required report views in one response. No request body. `reportQuerySchema` accepts start_date/end_date as a pair or both omitted; both omitted resolve to current Monday/Sunday. One without the other is 422. Additional queries: group_by = day or week (default day), page (default 1), page_size (default 20, max 100). No meal_type query is accepted because whole-day targets would otherwise be compared with a meal subset.

Require valid inclusive range, start <= end, and at most 366 inclusive dates. Ranges may contain future dates. The history API has no 366-day restriction. Status: 200 on success; 422 invalid query/range; 503 DB unavailable/timeout; 500 unexpected. All four report panels are projections of this one validated output.

| Response field | Exact meaning |
| --- | --- |
| range | Object: start_date, end_date, group_by, timezone, today. Resolved values, not omitted defaults. |
| summary | Aggregate over all matching meals, independent of bucket pagination; Summary contract below. |
| goal_snapshot | Current Goals object used in this report snapshot, including updated_at. |
| goal_comparison | Comparison for the whole selected elapsed range, section 13. |
| items | Paginated ReportBucket objects, including empty calendar buckets. |
| pagination | Contract from section 11; total_items counts calendar buckets, not meals. |

`Summary` = entry_count (integer), logged_day_count (distinct dates with entries), calories_kcal/protein_g/carbs_g/fat_g (logged numeric totals), and micronutrients (fixed six-key object). Each micronutrient object contains unit, known_total (number or null), known_count, unknown_count, and entry_count. Its key is the corresponding field name from section 7. A known zero contributes to known_count. Empty/all-unknown groups have known_total null.

`ReportBucket` = period_start, period_end, covered_start, covered_end (date strings); calendar_day_count and elapsed_day_count (integers); temporal_state (past, current, future); all Summary fields; and goal_comparison. Day buckets start=end; week buckets use Monday/Sunday and clipped coverage. temporal_state is future if covered_start > today, past if covered_end < today, otherwise current. A bucket with zero entries is still returned as logged totals zero with unknown micros; the UI labels the absence of entries.

For a full selected week group_by=day returns seven total bucket items, even with no entries. group_by=week returns one. For longer periods, the UI presents bucket paging controls and a “showing X–Y of Z periods” label. It must not imply the displayed page is the whole range.

## 13. Report calculations

Within a read-only consistent transaction, capture current goals and aggregate meals selected by inclusive consumption_date bounds. Summary covers all matches. Aggregate daily totals, group into the requested day/week buckets, add missing calendar buckets, and only then apply bucket paging. For at most 366 dates, constructing missing buckets in the service from database aggregates is acceptable and easy to explain. No raw unbounded meal list is loaded into React for totals.

- Calories: sum saved calories_kcal once per meal. No serving multiplier; values are consumed totals.
- Macros: sum each saved macro independently; chart unit is grams. Do not force calories to match 4P+4C+9F.
- Micros: for each nullable column compute SUM(value), COUNT(value), COUNT(*) and unknown_count = entry_count-known_count. SUM is NULL when none are known. Comments must explain why the count accompanies the sum.
- Coverage: logged_day_count is not proof of complete logging. A missing day is “no entries logged.”
- Updates/deletes: no persisted report-total table or application cache; subsequent queries naturally reflect committed rows. Frontend refetches relevant views.

`GoalComparison` is a fixed object with basis="current_daily_targets", scope_start, scope_end, day_count, and four metric objects named calories_kcal, protein_g, carbs_g, fat_g. For a covered range, elapsed scope ends at min(covered_end,today). If covered_start is later than today, scope_start/scope_end are null and day_count=0. Otherwise count every inclusive calendar date in that elapsed scope.

Each metric object has actual, target, difference, percent. Actual is logged amount in the same elapsed scope. Target = current daily target × day_count when the target is set and day_count>0; otherwise null. Difference = actual-target when target is not null. Percent = actual/target×100 rounded to two decimals when target>0; otherwise null. For a future-only scope actual=0, target/difference/percent=null. For a macro target explicitly 0 with elapsed days, target=0 and difference remains meaningful, but percent=null.

Display “Compared with current targets” for every comparison, including historical reports. Example: a current calorie target of 2,000 and seven elapsed dates gives target 14,000 even if the target used to differ. This is intentionally current-only behavior. For current-week Saturday, six elapsed dates give 12,000; Sunday is excluded until it arrives. Weight goal remains a separately displayed kg target with no actual/progress invention.

All report fields are produced from the same request snapshot and scope. Avoid joining a meal to repeating nutrient rows (the fixed-column design eliminates this multiplication risk). Preserve database decimal totals; round only output percentages and presentation labels, not each meal before summing.

## 14. Image extraction API

POST `/api/v1/nutrition/extract` accepts multipart/form-data with exactly one `image` file and one `image_type` text field: nutrition_label or food_plate. No query parameters. The file is required, nonempty, and at most **10 MB = 10,000,000 file bytes**. Supported declared MIME types: image/jpeg, image/png, image/webp. The decoded type must agree. Reject extra files, unknown fields, and unsupported/oversized input before any provider call.

Use upload middleware plus `imageExtractionInputSchema` for the text field, then bounded decoding, AIService, and normalized response validation. Status 200 returns the extraction response in section 15. Errors: 400 malformed multipart; 413 oversized file; 415 unsupported/mismatched type; 422 missing file, invalid mode, undecodable/animated/excessive-dimension image, unreadable/non-food/refused content; 429 rate/concurrency limit; 502 invalid output from both usable providers; 503 unavailable/configuration failures; 500 unexpected application error. No meal repository is called by this route.

## 15. Image extraction response

Return `{data: ExtractionResult}`. This response is a suggested draft, not a saved Meal and not a nutritional accuracy guarantee.

| Field | Contract |
| --- | --- |
| provider | gemini or grok, assigned by the backend rather than copied from model output. |
| image_type | The validated request's nutrition_label or food_plate. |
| is_estimate | true for food_plate; false for literal label extraction. |
| source_basis | Nullable short description, e.g. “per 100 g” or “estimated plate portion.” |
| assumptions | Array of short strings describing uncertainty/missing source information. No arbitrary HTML. |
| draft | Writable-meal-shaped object, except food_name, meal_type, consumed_quantity, quantity_unit, and four core nutrients may be null pending review. Micros remain nullable. |
| missing_fields | Array of field paths still required to satisfy createMealSchema. It is generated server-side. |

The backend sets draft.consumption_date to its today; meal_type starts null for the user to choose. Source and estimate fields derive from the requested image mode. Other suggestions come only from validated output. Draft has no id, created_at, or updated_at.

For a label, return nutrient amounts for the extracted reference quantity and set the suggested consumed quantity to that same reference quantity. Thus “per 100 g, 120 kcal” prefills 100 g and 120 kcal without an unstated multiplier. The user edits the amount and final totals when consuming a different portion. For a plate, use an explicitly estimated whole-plate amount, commonly one serving. Store one mixed-plate entry if several foods appear; do not also create component records.

Uncertain portions or missing core numbers stay null. Label-only %DV does not become a fabricated canonical amount. The frontend shows the normal meal form with these values and its create validation; Save stays unavailable until required fields are complete. Confirming sends only the complete writable meal representation to POST /api/v1/meals. No automatic save occurs on successful extraction, navigation, or provider fallback.

## 16. Backend module design

| Module | Named operations and responsibility |
| --- | --- |
| meal service | createMeal, getMeal, listMeals, replaceMeal, deleteMeal; date/domain validation, not HTTP concerns. |
| meal repository | insertMeal, findMealById, countMeals, findMealsPage, replaceMealById, deleteMealById; parameterized SQL and explicit row mapping. |
| goal service/repository | getGoals, replaceGoals; singleton values and complete replacement. |
| profile service/repository | getProfile, getDateContext; persisted singleton and backend clock policy. |
| report service | getNutritionReport; captured date context, grouping, empty buckets, goal comparisons, page metadata. |
| report repository | aggregateRange, aggregateByDate; complete matching SQL aggregates under the supplied snapshot client. |
| AIService | analyzeNutritionImage; attempt ordering, narrow failure classification, per-attempt validation, normalized draft. |
| GeminiProvider / GrokProvider | analyzeNutritionImage; bounded vendor transport, status/refusal handling, candidate text extraction. |
| image utilities | validateAndNormalizeImage; MIME/content checks, limits, normalized JPEG buffer. |
| validation middleware | Validate named params/query/body schemas; place validated values in a request-local object. |
| errors middleware | Translate known errors and unexpected exceptions into the common envelope. |
| number mapper | Convert known NUMERIC/count values explicitly; preserve null; reject non-finite/internal overflow instead of leaking invalid JSON. |

Services receive simple dependencies when needed for tests, such as clock/provider functions, without a container. Repository functions can accept the active transaction client, otherwise using the shared pool for single statements. Do not wrap every single SQL call in an extra invented unit-of-work abstraction.

Required comments explain why: DATE strings are preserved, query filters precede paging, report summaries ignore page limits, NULL-aware counts accompany sums, consumed totals are not multiplied again, and provider fallback excludes programmer exceptions. Keep route and UI code readable through naming before adding prose comments.

## 17. pg.Pool and transaction lifecycle

`db/pool.js` initializes one shared pool per backend process from validated configuration. Selected defaults: max 5 clients, connectionTimeoutMillis 5,000, idleTimeoutMillis 30,000, and database statement timeout 10,000 ms for normal requests. Migrations can use a documented longer statement timeout in their separate CLI process. Neither controllers nor repositories instantiate another pool.

Use pool.query for isolated atomic statements. For transactional operations, acquire once, begin, run every statement using that same client, commit on success or rollback on failure, and release in finally. List count/page and report multi-query reads use REPEATABLE READ READ ONLY. Migrations use a write transaction for schema work plus its applied-version record. Never hold a database transaction open while calling AI. [pg transaction rules](https://node-postgres.com/features/transactions)

Handle idle pool errors without exposing credentials. On SIGTERM/SIGINT stop accepting requests, abort active AI calls, allow brief in-flight request cleanup, and end the pool. A rejected operation must release its checked-out client. Pool exhaustion is an error, not a reason to create an emergency new pool.

TLS: load the Aiven CA through PG_CA_CERT_PATH and verify the server certificate. DATABASE_URL must not contain sslmode, sslcert, sslkey, or sslrootcert options that override the explicit pg SSL object; reject such configuration with a setup message. Do not set rejectUnauthorized=false. [pg SSL behavior](https://node-postgres.com/features/ssl)

## 18. Zod schema specifications

These are declarative schemas to implement, not generated JavaScript. Use Zod 4 and strict objects. Provider JSON Schema is derived from the supported basic shape; cross-field refinements are also enforced locally. A schema-construction exception is a programming failure and is not eligible for provider fallback. [Zod schema reference](https://zod.dev/api)

| Schema | Fields and refinements |
| --- | --- |
| envSchema | Section 26; validate core startup config and model/key pairs; never coerce invalid empty strings into meaningful values. |
| createMealSchema | All fields in section 3.1 required; numeric bounds/precision, enums, strict micronutrient object; no extra keys; food_plate implies is_estimate=true. |
| updateMealSchema | Same complete writable contract as createMealSchema; no partial semantics. |
| mealIdParamSchema | Strict object with one UUID id string. |
| mealListQuerySchema | Section 10: omission defaults, strict integer query strings, valid dates/order, strict enum, no unknown/repeated keys. |
| goalSchema | Five required nullable goal fields; positive calorie/weight when set; nonnegative macros; at most four decimals; strict object. |
| reportQuerySchema | Both dates together or neither; inclusive <=366-day range; group_by day/week; the same paging rules. |
| imageExtractionInputSchema | Strict image_type enum; file validation belongs to upload/decoder middleware. |
| aiImageResultSchema | Provider result shape below, JSON types only, nullable unknowns, bounded strings/numbers, semantic status checks. |
| extractionResponseSchema | Normalized ExtractionResult and partial draft from section 15; backend-derived metadata constrained separately. |

`aiImageResultSchema` fields: status (ok/unreadable/not_food), food_name (trimmed string length 1–200 or null), quantity (positive finite <=1,000,000 with <=4 decimals or null), quantity_unit (g/ml/serving/piece or null), calories_kcal/protein_g/carbs_g/fat_g (nonnegative bounded numbers or null), micronutrients (the six required nullable canonical fields), source_basis (string <=200 or null), and notes (array, at most 10 strings, each <=200). All keys are required; no additional properties.

For status=ok, require at least one core nutrient to be known. A missing name/portion/other core fields can remain a user-editable gap. For unreadable/not_food, ignore proposed nutrition and return a handled content error. Do not repair invalid JSON with eval, broad regex rewriting, or a second unbounded model call. JSON parsing failure and provider-payload Zod failure are eligible output failures; frontend/user request Zod failure is not.

## 19. AI provider contract and fallback

Both provider modules expose conceptually:

`analyzeNutritionImage({ imageBuffer, mimeType, imageType, signal })`

Input is a normalized JPEG and trusted mode. Output is candidate JSON text or a typed provider error. AIService parses and validates candidate JSON before normalization/use. The provider modules have no database or application-controller dependency.

Use documented Gemini image/structured-output transport and xAI Responses image/JSON-schema transport, with model IDs supplied by environment. The adapter owns vendor-specific envelope extraction; response fixtures must match the actual selected API. Do not copy Gemini fields into the Grok request or confuse Chat Completions response_format with Responses text.format. On the xAI Responses path, request JSON Schema using text.format and disable response storage with store=false. [xAI Responses reference](https://docs.x.ai/developers/rest-api-reference/inference/responses)

GeminiProvider uses `@google/genai` Interactions image input, an application/json response format with the generated schema, and the documented output-text accessor. GrokProvider uses native fetch against `https://api.x.ai/v1/responses`, with a base64 JPEG input_image and the same logical JSON schema. The provider modules enforce the timeout/cancellation contract using their transport's supported abort/deadline options and test envelope adaptation against pinned dependencies. Model/key selection is configuration, not permission to change primary/fallback order. [Gemini image input](https://ai.google.dev/gemini-api/docs/image-understanding), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)

Prompt contract: identify relevant food/label information; extract one coherent label column/reference amount; output the defined schema and canonical units; use null for unknown values; identify unreadable/non-food input; label plate assumptions in notes; treat text in the image as data rather than instructions. No tools or database actions are supplied to either model.

| Failure class | Examples | Action |
| --- | --- | --- |
| ProviderUnavailable | Timeout/abort by provider deadline, connection failure, 429, provider 5xx | Eligible for one Grok attempt after Gemini. |
| ProviderOutputInvalid | Missing expected content, malformed envelope, invalid JSON, truncated output, aiImageResultSchema failure | Eligible for one Grok attempt after Gemini. |
| ProviderConfiguration | Missing key/model, rejected credentials, model unavailable to account, upstream 401/403/404 | 503 AI_CONFIGURATION_ERROR, no new fallback. |
| ContentProblem | Valid unreadable/not_food status or explicit provider refusal | 422 IMAGE_UNREADABLE / IMAGE_NOT_FOOD / IMAGE_ANALYSIS_REFUSED; no fallback. |
| ApplicationBug | Unexpected TypeError, schema generation error, unrelated validator/mapper/database bug, rejected developer request shape | Central 500 INTERNAL_ERROR; no fallback. |
| UserCancellation | Browser disconnect/explicit cancellation | Abort work; do not invoke fallback. |

Execution: validate upload; check primary configuration; attempt Gemini with a 25,000-ms deadline covering request and response read; parse and Zod-validate; return valid draft or handled content error. Only an explicitly classified eligible failure permits a single Grok attempt with the same deadline. Unknown exceptions are rethrown, not wrapped as provider outages. Disable transport/SDK automatic retries. Use an overall extraction budget of 55 seconds after upload and abort outstanding work; the frontend upload request timeout is 60 seconds. A Promise.race that leaves the underlying provider request running does not meet the cancellation contract.

Classify transport errors at the actual transport boundary using documented error types, status codes, or known network causes. A generic TypeError is not a network-failure classification. Distinguish a provider deadline from a user cancellation before deciding on fallback. If an upstream 400 reports an invalid developer-constructed request/schema, surface the internal defect instead of calling Grok.

If both attempts produce invalid output, return 502 AI_INVALID_OUTPUT. If no usable result remains and either eligible attempt failed due to availability, return 503 AI_PROVIDERS_UNAVAILABLE. If an attempted fallback is not configured, return 503 AI_FALLBACK_UNAVAILABLE. If a terminal configuration/content/programming error occurs, its mapped error wins immediately. No success result or meal write is fabricated. Manual meal/goal/report services never check AI configuration.

## 20. Upload validation, normalization, and cleanup

Use a Multer memory parser scoped only to the extraction route. One image, one short image_type field, no extra fields/files. File-byte limit is exactly 10,000,000; multipart overhead is not counted as image bytes. Frontend checks the same size/types but cannot authorize the upload.

After size/type checks, Sharp inspects and decodes the content with a 25,000,000-pixel input limit and strict invalid-data handling. Allow only decoded jpeg/png/webp matching the declared MIME; reject animated/multi-frame input. Normalize orientation, flatten transparency on white, fit within 3072×3072 without enlargement, and emit JPEG quality 90. Limit normalized output to 10,000,000 bytes and image processing to 5 seconds; a processing failure returns 422 without calling providers. These resource bounds supplement the fixed upload rules. [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/), [Sharp output options](https://sharp.pixelplumbing.com/api-output/)

Both providers receive the same normalized JPEG. This preserves required WebP acceptance despite xAI's documented JPEG/PNG input support. [xAI supported image types](https://docs.x.ai/developers/model-capabilities/images/understanding)

Do not write uploads to a public directory, persist them in PostgreSQL, or use provider file-upload storage. Keep original/normalized buffers request-scoped, release references and close processing resources in cleanup, and abort outstanding transport on cancellation. Do not log base64, image bytes, raw model payloads, or credentials. The UI keeps its local preview while showing a recoverable processing/provider error.

Apply a per-IP limit of 10 extraction requests per 10 minutes and a maximum of two in-flight extractions per backend process, returning 429 with Retry-After when exceeded; do not queue. Acquire the slot before buffering large uploads and release it in finally after cancellation/cleanup. Deployment remains one process. Configure proxy trust only for the actual proxy topology so user-supplied forwarded headers cannot bypass limits.

## 21. Frontend routes/pages

| Route | Page | API use |
| --- | --- | --- |
| `/` | Dashboard | Profile, goals/report snapshot, current week report. |
| `/meals` | MealHistory | Paginated/filterable GET meals; DELETE action. |
| `/meals/new` | MealEditor in create mode | POST meals. |
| `/meals/:id/edit` | MealEditor in edit mode | GET one meal, PUT complete replacement. |
| `/goals` | Goals | GET/PUT singleton goals. |
| `/reports` | Reports | GET nutrition report with dates, grouping, bucket paging. |
| `/meals/from-image` | ImageEntry | Extraction, editable embedded MealForm, POST normal meal. |

Resolve static meal routes before parameterized routes. There is no login route or route guard. Profile/date context is read on app entry and refreshed on focus/relevant form submission; the backend still revalidates today at save time. No draft data need be saved in localStorage.

## 22. Frontend components and state

MealForm is shared by create/edit/image paths and displays consumed-total semantics, source/estimate state, and unit labels. MealList, MealFilters, and PaginationControls cover history. GoalForm handles nullable targets. CalorieTrendChart, MacroBreakdownChart, MicronutrientSummary, and GoalComparisonChart consume report fields directly. NutritionImageUpload and NutritionExtractionPreview manage selection and unsaved suggestions. Small shared LoadingState/EmptyState/ErrorMessage components are justified by actual reuse.

Use local component state plus React Hook Form; URL search params store history/report filters where useful. No additional global-store layer. Abort stale reads when filters change; do not let an older response overwrite a newer result. After POST/PUT/DELETE or goal replacement, refetch affected active views; dashboard/reports fetch on entry/focus. Preserve form values after failed saves. Disable repeated submit while pending. Confirmation of delete is sufficient; a browser or simple dialog is acceptable.

No automatic mutation retry. If the network fails after a possible commit, show “Could not confirm the save. Check history before submitting again.” GET can be retried explicitly. This minimal design does not promise deduplication of independently submitted identical creates; repeated food entries are valid. A client-side disabled button is not represented as an idempotency guarantee.

## 23. Frontend validation

React Hook Form manages meal/goal input and useful error state; Zod mirrors server field rules. Convert a nonblank numeric input to a number only after checking it is numeric. Blank nullable micros/goals become null, known "0" becomes 0, blank core fields fail. Do not use Number('')/Number(null) as normalization. Validate dates against backend-supplied today for immediate feedback. Backend rejection remains authoritative, including a day-boundary change between form load and save.

Image draft schemas permit incomplete suggestions; ordinary createMealSchema does not. The user chooses meal type and confirms date/quantity/nutrition before save. Unknown micronutrients display “Unknown” or a blank optional input, not 0. Recharts receives numeric core series and intentional gaps/labels for unknown micros, not a blanket null-to-zero conversion.

## 24. Frontend API client

One client uses `VITE_API_BASE_URL`, with no provider or database secrets. Include no authentication-token or cookie-credential logic. JSON requests set Content-Type correctly; multipart requests let the browser set the boundary. Handle 204 without trying to parse JSON.

Parse the standard error envelope once; expose code/message/details/request_id to callers. Handle non-JSON proxy errors and fetch/network failures with a safe fallback message. Use AbortController for stale reads, user cancellation, and the 60-second extraction timeout. Do not automatically retry writes. Endpoints wrappers return documented data/items rather than changing names or hiding metadata inconsistently.

## 25. Error response format and middleware

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the highlighted fields.",
    "details": [{"field": "consumed_quantity", "message": "Must be greater than zero."}],
    "request_id": "example-request-id"
  }
}
```

details is always an array; field is a dot path, or an empty string for a whole-request problem. Generate request_id server-side and return it in an X-Request-ID header as well. Do not echo untrusted payloads into messages.

| HTTP status | Codes/use |
| --- | --- |
| 400 | MALFORMED_JSON or MALFORMED_MULTIPART. |
| 404 | MEAL_NOT_FOUND or ROUTE_NOT_FOUND. |
| 413 | FILE_TOO_LARGE or REQUEST_TOO_LARGE. |
| 415 | UNSUPPORTED_MEDIA_TYPE or IMAGE_TYPE_MISMATCH. |
| 422 | VALIDATION_ERROR, IMAGE_INVALID, IMAGE_UNREADABLE, IMAGE_NOT_FOOD, IMAGE_ANALYSIS_REFUSED. |
| 429 | AI_RATE_LIMITED or AI_BUSY; include Retry-After. |
| 502 | AI_INVALID_OUTPUT after applicable attempts. |
| 503 | DATABASE_UNAVAILABLE, DATABASE_TIMEOUT, AI_CONFIGURATION_ERROR, AI_FALLBACK_UNAVAILABLE, AI_PROVIDERS_UNAVAILABLE. |
| 500 | INTERNAL_ERROR for unexpected bugs, invalid persistent profile configuration, and unmapped database errors. |

Middleware order: request ID; Helmet and configured CORS; JSON parsing on JSON routes; route-local rate/concurrency/upload middleware for images; schema validation; controller; route-not-found; centralized error handler. Do not run the JSON parser as the multipart parser. Known database constraint errors are mapped intentionally; a statement/connection timeout differs from a programming SQL error. Never send SQL text, stack traces, connection URLs, or provider key diagnostics to the browser.

## 26. Environment and README contract

| Variable | Requirement/default | Validation/use |
| --- | --- | --- |
| DATABASE_URL | Required | PostgreSQL connection URI; secret; no overriding SSL query options. |
| PG_CA_CERT_PATH | Required for selected Aiven connection | Readable service CA certificate path; verified TLS. |
| PORT | 3000 | Integer 1–65535. |
| CLIENT_ORIGIN | Required; example http://localhost:5173 | Single http(s) origin without a path. |
| NODE_ENV | development | development/test/production. |
| GEMINI_API_KEY | Optional for manual-only operation; required to enable primary AI | Secret, nonempty when supplied. |
| GEMINI_MODEL | Required together with Gemini key | Explicit image/structured-output-capable model available to the account. |
| XAI_API_KEY | Optional for manual-only/primary-only operation; needed for fallback | Backend secret. |
| GROK_MODEL | Required together with xAI key | Explicit image/structured-output-capable model available to the account. |
| TRUST_PROXY_HOPS | 0 | Nonnegative integer; change only to match actual deployment proxy topology. |
| VITE_API_BASE_URL | Client only; example http://localhost:3000/api/v1 | Public backend URL; never contains a secret. |

Validate core server/database configuration with envSchema and fail startup only for invalid required core configuration. Assess the two provider key/model pairs separately with safe validation that records enabled/configuration-error state without stopping manual operation. An absent pair disables that capability; a partially supplied pair is an extraction configuration error and is not repaired by fallback. Model availability is verified during configuration; these documents do not assert that an account already has access or credits. Model names remain explicit environment values rather than hardcoded guesses.

The eventual README must specify Node 24 LTS, installed/locked dependency versions, Aiven connection/CA setup, environment examples without secrets, and separate client/server setup. Define intended script names: server `dev`, `start`, `db:migrate`, `test`, `lint`; client `dev`, `build`, `preview`, `test`, `lint`. Document what each does and their working directories. Provide a migration-from-empty workflow, synthetic example meal, and a live AI smoke-check procedure once implementation exists.

Document consumed-total nutrition, full PUT edits, current-only targets, Asia/Kolkata initial timezone, inclusive dates, Monday–Sunday weeks, paging 1/20/max100, 366-day report bound, accepted image types/10 MB limit, unknown/zero semantics, image normalization, no-auth deployment implications, fallback behavior, and bonus exclusions. Required comments and the rationale for important choices form part of review readiness. No README file or scripts are being implemented in this planning step.

## 27. Testing strategy and acceptance inventory

Use Node's test runner with Supertest for backend endpoint checks and an isolated PostgreSQL test database/schema. Mock provider calls in automated tests; validate each provider adapter with representative response fixtures. Use Vitest and React Testing Library for the small set of important frontend state/contract checks. Tests target behavior rather than duplicating every line of implementation.

Use a fixed backend clock. Database/date tests must not depend on the machine's current date or timezone. Default fixture today is 2026-09-12 in Asia/Kolkata. All reported nutrition examples are synthetic test data.

| ID | Test | Expected PASS behavior |
| --- | --- | --- |
| T-001 | Create a complete valid meal | 201, stable ID, values stored once, snapshot equals supplied consumed totals. |
| T-002 | List and read created meals | Exact fields returned, deterministic order, GET-by-ID works. |
| T-003 | Full PUT update | Complete new values, same ID/created_at, changed updated_at; omitted required fields rejected. |
| T-004 | Delete and reread | 204 then 404; no lingering record. |
| T-005 | Invalid quantity/core values | Zero/negative quantity, negative nutrients, nonnumeric/null core fail; valid numeric zero core succeeds. |
| T-006 | Future consumption date | Tomorrow is rejected on both POST and PUT even through direct API calls. |
| T-007 | Inclusive boundaries and meal filter | Start/end-date records included; outside/type-mismatched records excluded. |
| T-008 | Real dates and reversed ranges | Invalid leap dates and start>end fail; valid leap day accepted. |
| T-009 | Sunday/Monday grouping | 2026-09-13 groups under Sep 7, Sep 14 under Sep 14. |
| T-010 | Creation versus consumption date | Yesterday's meal entered today belongs to yesterday's report. |
| T-011 | Backend today across timezone boundary | At 2026-09-11T20:00:00Z, Asia/Kolkata today is Sep 12; browser/process timezone does not change it. |
| T-012 | Paging defaults and max | Omitted values yield 1/20; 100 succeeds; 101, 0, negatives, decimals, arrays, blanks fail. |
| T-013 | Out-of-range page | Empty items with correct nonzero filtered totals when applicable. |
| T-014 | Report independent of list page | 25 meals ×10 kcal total 250 on every history/report page. |
| T-015 | Report bucket paging | Summary fixed while returned bucket subset changes; all calendar bucket count is correct. |
| T-016 | Known micronutrient zero | Zero survives POST, PUT, DB, response, form, and contributes to known_count. |
| T-017 | Unknown micronutrient | NULL survives every path; all-unknown sum remains null. |
| T-018 | Partial micronutrient coverage | 100/null/20/0 gives 120 with known_count=3, unknown_count=1. |
| T-019 | Report after update | Changed amount/date reflected in all affected day/week summaries. |
| T-020 | Report after delete | Removed contribution disappears from summary and bucket. |
| T-021 | Empty history/report | No crash; seven current-week day buckets, zero logged core totals, unknown micro totals. |
| T-022 | Goals first set/read/update/clear | Five values persist; all-null configuration accepted; no account ID involved. |
| T-023 | Goal comparison semantics | Current target applied consistently to elapsed days; missing/zero targets have percent=null. |
| T-024 | Current week and future-only ranges | Future buckets allowed; future consumed writes still fail; elapsed target excludes future days. |
| T-025 | Unsupported or spoofed image type | 415 before any provider call. |
| T-026 | Exact upload byte limit | Size layer accepts 10,000,000 and rejects 10,000,001 with 413 before provider. |
| T-027 | JPEG/PNG/WebP normalization | Each valid supported input produces bounded JPEG; WebP can proceed through Grok fallback. |
| T-028 | Missing/corrupt/animated/oversized-pixel image | Recoverable 422 and no provider call. |
| T-029 | Gemini success | Valid result prefills; Grok not invoked. |
| T-030 | Eligible Gemini transport failure | Timeout/429/5xx/network cases invoke Grok once with bounded timeout. |
| T-031 | Malformed Gemini output | Bad envelope/JSON/Zod data invokes Grok once; invalid values never reach form. |
| T-032 | Both providers fail | Correct 502/503 mapping; manual create/list/goals/reports still operate. |
| T-033 | Programming/configuration/content failure | No fallback for TypeError, schema-construction bug, invalid key/model, refusal, unreadable/non-food result. |
| T-034 | Extraction does not save | Database meal count unchanged after either provider's successful extraction; only normal POST creates. |
| T-035 | Incomplete AI draft | Missing required fields stay null and block ordinary Save until corrected. |
| T-036 | Provider output trust | Wrong/extra types rejected, no model-supplied provider identity/SQL/tool actions accepted. |
| T-037 | Client form null/zero handling | Blank micro becomes null, "0" becomes 0; failed save preserves input. |
| T-038 | Client API contract | 204 does not parse JSON; multipart boundary untouched; stable field errors and no automatic mutation retry. |
| T-039 | Pool/transaction cleanup | Success/failure release client; rollback as appropriate; count/page share snapshot; shutdown ends pool. |
| T-040 | Persistence and migrations | Fresh schema works, repeated migration does not reset rows, process restart retains meal/goals/profile. |
| T-041 | Cancellation/rate bounds | Active work aborts, no fallback on user cancellation, concurrency slot released, limit returns 429. |
| T-042 | Quantity semantics | Changing quantity with explicitly supplied totals does not multiply them; PUT/form review labels are present. |
| T-043 | Report and form units | Fixed six micronutrients and four core fields retain canonical units; label %DV is not treated as amount. |
| T-044 | Stale frontend reads | Old filter responses cannot overwrite newer results; successful mutations refetch affected views. |

Manual/document checks: D-001 all fixed decisions match PRD/HLD/LLD; D-002 no mandatory authentication/bonus leakage; D-003 easy-to-explain modules and meaningful names; D-004 README fresh-setup walkthrough; D-005 secrets/TLS/CORS/upload boundaries; D-006 required comments explain critical logic; D-007 readable keyboard/responsive UI and chart empty states; D-008 real label and plate smoke checks with configured providers. Automated tests use mocks; D-008 validates real integration separately once code exists.

These are specified checks. No application tests or live provider calls have been executed in this planning task.
