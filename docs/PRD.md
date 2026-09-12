# Personal Calorie Tracker — PRD

Status: reviewed planning specification. Source order: original take-home assignment; the user's fixed scope/stack decisions; the latest instruction that comments must be present; prior analysis for unresolved design choices. This document defines the mandatory product. Bonus features remain separate.

## 1. Product overview

A single-user web application for recording consumed food, managing nutrition and weight targets, reviewing history, and understanding recorded intake through charts. Users can enter meals manually or review editable suggestions extracted from a nutrition-label or plate-of-food image.

## 2. Problem statement

Food records are difficult to interpret when portions, nutrients, dates, and goals are inconsistent. The product keeps these records together and shows understandable totals and comparisons. Image-assisted entry reduces typing while leaving the user in control of the saved record.

## 3. Product goals

- Persist a complete diary with create, read/list, update, and delete operations.
- Support calorie, protein, carbohydrate, fat, and target-weight goals.
- Make dated and meal-filtered history usable through backend pagination.
- Show weekly calories, daily/weekly macros, micronutrient summaries, and goal-versus-actual charts.
- Support both label and plate image extraction, editable review, and explicit saving.
- Keep ordinary diary and reporting workflows usable during AI failure.
- Provide clear, concise, modular code that its author can understand and explain, with setup documentation and meaningful comments.

## 4. Non-goals

Mandatory scope excludes signup, login, account management, multiple-user isolation, conversational actions, and PDF import. These are bonus-only. It also excludes food catalogs, barcode search, recipes, exercise tracking, automatic dietary prescriptions, actual weight-history charts, goal version history, native mobile apps, and enterprise infrastructure.

Single-user scope does not imply access-controlled hosting. A remotely reachable mandatory instance exposes the same diary to anyone who can reach its API. Deployment audience must reflect that limitation; authentication must not be silently added to the mandatory backlog.

## 5. Primary user

One application user maintains one diary and one current goal configuration. There is no sign-in journey. A persisted singleton profile supplies a display name and the application timezone; it is not an account or ownership system. The initial timezone is `Asia/Kolkata`, recorded in setup documentation and displayed with date-sensitive views.

## 6. User stories

| ID | As the application user, I want to… | Requirement |
| --- | --- | --- |
| US-001 | Set, view, and update nutrition and target-weight goals. | FR-001 |
| US-002 | Manually create a dated food entry under a meal category. | FR-002 |
| US-003 | View history and inspect a specific entry. | FR-003 |
| US-004 | Correct an existing entry. | FR-004 |
| US-005 | Delete an incorrect entry. | FR-005 |
| US-006 | Filter history by inclusive start/end dates and meal type. | FR-006 |
| US-007 | Navigate all matching entries using pagination. | FR-007 |
| US-008 | See calorie intake across a Monday–Sunday week. | FR-008 |
| US-009 | See protein, carbohydrate, and fat by day and week. | FR-009 |
| US-010 | See known vitamin/mineral amounts and missing-data coverage. | FR-010 |
| US-011 | Compare logged intake with my current targets. | FR-011 |
| US-012 | Upload a product nutrition-label image. | FR-012 |
| US-013 | Upload a plate-of-food image. | FR-013 |
| US-014 | Review and edit extracted values before saving through the normal meal form. | FR-014 |
| US-015 | Continue manual entry when image analysis is unavailable. | FR-017 |

## 7. Functional requirements

| ID | Mandatory requirement |
| --- | --- |
| FR-001 | Read and replace the current daily calorie/macro targets and optional target weight; preserve unset values; persist changes. |
| FR-002 | Create an entry containing food name, meal category, consumption date, consumed quantity/unit, calories, macros, and the supported micronutrients. |
| FR-003 | List saved entries and read an entry by stable ID. |
| FR-004 | Replace an existing entry's editable values and retain its identity and creation timestamp. |
| FR-005 | Delete an existing entry so it no longer contributes to history or reports. |
| FR-006 | Combine start-date, end-date, and meal-type filters; both date endpoints are inclusive. |
| FR-007 | Paginate every collection API on the backend: default `page=1`, `page_size=20`, maximum `page_size=100`. Invalid values above the maximum are rejected, not capped. |
| FR-008 | Display daily logged calorie totals across a selected Monday–Sunday week, including dates with no entries. |
| FR-009 | Display protein, carbohydrate, and fat totals independently by day or calendar week. |
| FR-010 | Summarize sodium, calcium, iron, potassium, vitamin C, and vitamin D, including availability counts. This is a documented subset of micronutrients. |
| FR-011 | Compare intake with current daily targets over the same elapsed dates; identify the use of current targets on historical ranges. Show the target weight as a saved goal, without invented actual weight. |
| FR-012 | Analyze JPEG, PNG, or WebP nutrition-label images up to 10 MB and return editable suggestions. |
| FR-013 | Analyze JPEG, PNG, or WebP plate images up to 10 MB and return editable food/portion estimates. |
| FR-014 | Let the user review, correct, and explicitly save suggestions through ordinary meal creation. Extraction itself must never create a meal. |
| FR-015 | Frontend application-data access must occur exclusively through backend REST APIs. |
| FR-016 | Persist meals, goals, and the single user's profile in PostgreSQL; preserve them across normal restarts. |
| FR-017 | Attempt Gemini first; use Grok only for eligible provider/output failures. Return recoverable failure if no valid result is available; manual workflows remain available. |
| FR-018 | Operate as one application user without mandatory authentication or account ownership logic. |

## 8. Non-functional requirements

| ID | Requirement and review evidence |
| --- | --- |
| NFR-001 | Backend validation is authoritative. Invalid dates, quantities, units, paging, uploads, and AI results cannot bypass it. Frontend validation provides timely feedback. |
| NFR-002 | Errors are consistent and recoverable. Failed saves preserve form values; reports reflect committed data; restarts do not reset records. |
| NFR-003 | Code is easy to understand and explain: meaningful names, small focused functions, feature modules, shared rules, and no layers without a clear responsibility. |
| NFR-004 | The eventual README documents prerequisites, separate startup commands, database/migrations, environment variables, AI setup, assumptions, checks, and known limitations. |
| NFR-005 | Comments must be present for important logic and architectural decisions, including date semantics, NULL-aware aggregation, pool/transaction cleanup, and fallback classification. Avoid comments that only repeat obvious code. |
| NFR-006 | Keep provider/database secrets backend-only; parameterize SQL; validate uploads; use safe errors, configured CORS, Helmet, and AI rate limits. |
| NFR-007 | Provide labeled units, keyboard-operable forms, responsive layouts, and loading/empty/error states. Charts have textual totals and do not depend on color alone. |
| NFR-008 | Bound paging and expensive uploads/AI work. Reports aggregate complete matching data. No enterprise-scale throughput or availability claims are made. |

## 9. Business/domain rules

### 9.1 Meals and quantities

Categories are **Breakfast, Lunch, Dinner, Snacks**. Their API values are `breakfast`, `lunch`, `dinner`, `snacks`. Multiple entries in the same category/date, including identical foods, are allowed.

Consumed quantity must be positive. Units are `g`, `ml`, `serving`, or `piece`. Every saved nutritional amount is the **total for the consumed quantity**, not a hidden per-100-g or per-serving value. Forms state this beside nutritional fields. Changing quantity does not silently rescale nutrition: the full edit form requires the user to review and submit the totals. No unit or density conversion is implicit.

### 9.2 Dates

`consumption_date` is a calendar date, stored as PostgreSQL `DATE`, separate from `created_at` and `updated_at`. Reports use consumption date. Future consumption dates are prohibited using the application's timezone and backend clock.

All supplied ranges include start and end. Weeks are Monday–Sunday. Range endpoints may include future dates to display a complete current week, but no future-dated consumed meal may be created or updated. Future report days are labeled future; they are excluded from elapsed-period goal comparisons.

One report request covers at most 366 inclusive calendar days, with a clear validation message for a longer selection. Meal history remains available over longer ranges through pagination. This is a bounded-report design choice, not a limit on retained diary history.

### 9.3 Pagination

Defaults: `page=1`, `page_size=20`. Maximum: `page_size=100`; 101 returns validation failure. Positive integers only. Filters run before pagination. A page beyond the last page returns an empty collection with correct total metadata. Variable-length report buckets are also paginated; report summaries still cover the entire range.

### 9.4 Nutrients

Calories use kcal; protein, carbs, and fat use g. Sodium, calcium, iron, potassium, and vitamin C use mg; vitamin D uses mcg. Core nutrition is required and nonnegative for a saved entry; zero is valid. All six micronutrient fields are nullable. `0` means known zero; `NULL` means unknown/unavailable. Unknown values must never automatically become zero.

Reports show known micronutrient subtotals and how many entries supply each value. If none supply it, the subtotal is unknown. A date with no entries means no intake was logged, not verified zero consumption.

### 9.5 Goals and comparisons

One current configuration is used; history/versioning is excluded to keep the mandatory design simple. Calorie and weight targets are positive when set; macro targets may be zero. Any goal can be unset. All-null goals mean no goals configured.

Historical charts explicitly say “Compared with current targets.” Compare actuals and targets over the same selected dates through today. Do not divide by a zero/unset target. Weight is stored in kg, without claiming actual weight progress.

### 9.6 Image extraction

Accept `image/jpeg`, `image/png`, `image/webp`. **10 MB means 10,000,000 file bytes**; exactly the limit is permitted, greater is rejected. Both frontend checks and authoritative backend checks apply.

Extraction proposes one editable food entry. A mixed plate is one named mixed-plate entry. Label values are associated with their reference amount, which becomes the proposed consumed amount; unknown portions/fields must be completed by the user. Plate suggestions are marked estimated. Valid output may still contain unknowns. Neither extraction nor fallback writes a meal to the database.

## 10. Edge cases

| Case | Required behavior |
| --- | --- |
| Empty history or no goals | Show useful empty/unconfigured states; meal entry stays available. |
| Zero/negative quantity; invalid core nutrition | Reject with field errors; write nothing. |
| Invalid calendar date, reversed range, future consumption | Reject; do not substitute another date. |
| Invalid page/page_size or size above 100 | Reject; preserve filters for correction. |
| Page beyond available results | Empty items plus correct pagination metadata. |
| Known zero micronutrient | Preserve zero and count it as known. |
| Unknown micronutrient | Persist NULL; preserve unknown subtotal/coverage semantics. |
| Update/delete | Subsequent history, dashboard, and reports reflect the change. |
| Unsupported type or file larger than 10 MB | Reject before any provider call. |
| Unreadable/non-food image | Explain the content problem; offer manual entry. |
| Malformed provider output | Reject untrusted output and use fallback only when eligible. |
| Gemini unavailable; both providers fail | Try Grok when eligible; otherwise return a recoverable error without losing the user's form. |
| Current week has future days | Show the complete week with future labels; compare only elapsed dates. |

## 11. Acceptance criteria

These are future PASS/FAIL checks, not a claim that an application has been tested.

| ID | PASS condition |
| --- | --- |
| AC-001 | Save and update all supported goals; reload/restart returns the last committed values, including explicit NULLs. |
| AC-002 | Create, list, read, replace, and delete an entry; its fields and report contribution match each committed state. |
| AC-003 | Both boundary dates and the selected meal type are included correctly; other dates/types are excluded. |
| AC-004 | Omitting paging yields 1/20; size 100 succeeds; 101, zero, negative, and fractional paging fail; an out-of-range page is empty. |
| AC-005 | With 25 meals of 10 kcal and page size 10, history pages contain 10/10/5 entries and report total remains 250 kcal on every page. |
| AC-006 | Sunday and the following Monday belong to different weeks; entries are grouped by consumption date even when entered later. |
| AC-007 | Micronutrient values 100, NULL, 20, and 0 yield known total 120 and known count 3 of 4. All unknown values yield a NULL total. |
| AC-008 | Goal comparisons use current targets and the same elapsed dates; absent/zero targets never produce invalid percentages. |
| AC-009 | Valid label and plate examples produce editable drafts; a plate is labeled estimated; no meal exists until normal save succeeds. |
| AC-010 | All three supported MIME types work; exactly 10,000,000 bytes passes size validation and 10,000,001 bytes fails before a provider call. |
| AC-011 | Eligible Gemini failure invokes Grok once; invalid Grok output cannot escape validation; both-provider failure leaves manual entry functional. |
| AC-012 | Future consumption dates and invalid values fail in direct API requests, not only in the browser. |
| AC-013 | Browser requests use APIs; secrets/database access stay backend-only; normal restarts preserve persisted data. |
| AC-014 | Code review finds focused modules, understandable names/flow, required explanatory comments, and no mandatory authentication or unnecessary infrastructure. |
| AC-015 | A reviewer can follow the eventual README from an empty database to a working manual workflow and understand AI configuration/limitations. |

## 12. Bonus scope

| Bonus | Separate future acceptance boundary |
| --- | --- |
| Conversational LLM interface | Real app actions and summaries through authorized, validated tools. |
| Multi-user authentication/private data | Signup/login plus ownership across every applicable data path. |
| PDF bulk import | Parse documented tabular formats, validate candidate rows, and prevent accidental duplicate commits. |

No mandatory schema, API, route, or request flow depends on these bonuses. This planning deliverable does not define implementation phases.
