Personal Calorie Tracker — requirements, design decisions, and evaluation analysis

Prepared from the assignment supplied in this conversation. This is a requirements analysis, not an implementation or an official grading rubric. Proposed defaults, API names, database entities, and test cases are engineering recommendations unless identified as explicit requirements. Numerical examples are synthetic software fixtures.

**The assignment requires an end-to-end nutrition application with five mandatory feature areas.** They are goal management, meal entry, filtered food history, nutrition reporting, and AI image extraction. Separate backend APIs, database persistence, pagination, and the stated code-quality guidelines are also mandatory. Conversational actions, multiple accounts, and PDF import are explicitly bonuses. A polished interface alone, or a chatbot that only discusses nutrition, does not establish completion of the required workflows.

The brief does not provide a deadline, scoring weights, required framework, AI provider, API budget, deployment destination, accuracy threshold, or expected load. Those facts cannot be inferred. Recommendations below are intended to make a submission correct and reviewable without expanding it into a commercial health platform.

**The following distinction should drive scope decisions.** “Explicit” means directly requested. “Implied” means needed for the requested behavior to be meaningful. “Recommended” means a useful implementation choice rather than a hidden assignment rule. “Bonus” means extra credit, with its own conditions if implemented.

| ID | Classification | Requirement | Observable evidence of completion |
| --- | --- | --- | --- |
| R01 | Explicit | A full-stack web application | A user can complete the required workflows in a browser, and the frontend obtains and changes application data through backend APIs. |
| R02 | Explicit | Set and manage personal health goals | Targets can be created, read, changed, saved, and used in comparisons. The examples name calories, protein, carbohydrate, fat, and weight; implementing all named types is the conservative interpretation. |
| R03 | Explicit | Create food entries | Entries contain a food name, quantity, calories, macros, and supported micronutrients, and are grouped as Breakfast, Lunch, Dinner, or Snacks. |
| R04 | Explicit | List entries in a specified time range | The user selects dates and meal type and obtains matching records, including records beyond the first page. |
| R05 | Explicit | Weekly calorie trend | A dated chart reflects saved entries for the selected week. |
| R06 | Explicit | Daily/weekly macronutrient breakdown | Protein, carbohydrate, and fat are visible with correct units and day/week aggregation. |
| R07 | Explicit | Micronutrient summary | Vitamins and minerals can be stored and summarized; unknown data are represented honestly. |
| R08 | Explicit | Goal-versus-actual charts | The app compares actual logged intake and applicable targets over matching periods and units. |
| R09 | Explicit | AI image extraction and prefill | A nutrition-label or food-plate photo produces editable nutritional fields using actual image analysis. The user can correct and save the result. |
| R10 | Explicit | Frontend/backend separation | API code and data access are separated from frontend code. All frontend access to application data crosses the API boundary. |
| R11 | Explicit | Database persistence | Food entries, goals, and user/profile data survive a normal application restart. |
| R12 | Explicit | Pagination in all list APIs | Collection endpoints accept validated paging parameters and return usable navigation metadata. |
| R13 | Explicit | Clean code and modularity | Feature modules, reusable domain calculations, meaningful names, and understandable responsibilities. |
| R14 | Explicit | README | Reproducible setup/run instructions and documented assumptions. |
| R15 | Explicit | Error handling and validation | Invalid input, external-service failures, and failed saves produce useful errors and do not corrupt data. |
| R16 | Explicit | Appropriate comments | Comments explain non-obvious calculations and architectural decisions. |
| B01 | Bonus | Conversational interface powered by an LLM | Natural-language requests actually invoke app actions and return results grounded in saved data. |
| B02 | Bonus | Independent user accounts | Signup, login, and private ownership work across all data access paths. |
| B03 | Bonus | Tabular PDF import | A supported diary PDF is parsed into entries, validated, and imported with intelligible feedback. |

**Several apparently small details are implied by the requested features.** An entry needs a consumption date because history and reports cannot work without one. Quantity needs a unit or defined serving because “2” does not identify how much food was eaten. Nutrition needs a defined basis because “120 calories” could mean per 100 g, per serving, or for the amount consumed. A weight goal needs a weight unit. Chart axes and totals need defined periods. Database rows need stable identifiers. Dates in the diary and dates in reports must follow the same rule.

Editing and deleting food entries are strongly recommended rather than explicitly enumerated. They make “monitor and manage” credible and let users correct AI or manual-entry mistakes. Showing current goals is implied by managing them. Goal history, weight history, food search, recipes, reminders, and exports are separate scope decisions; they are not all implied by the word “tracker.”

**Goal management needs a clear contract.** A conservative implementation exposes daily calorie, protein, carbohydrate, and fat targets, plus an optional target weight. Values should remain editable. It should allow a user to leave an optional target unset, distinguish an unset target from zero, and explain the units beside every field. Creating a calorie target does not imply calculating one from age, sex, height, activity, or a medical condition.

| Goal decision | Recommended behavior | Failure avoided |
| --- | --- | --- |
| Calorie target | Positive finite kcal value when set | Zero denominator and meaningless negative targets |
| Macro targets | Nonnegative finite grams; handle an explicit zero without calculating a percentage | Rejecting legitimate zero values or dividing by zero |
| Weight goal | Positive finite value in a declared unit; normalize if several units are accepted | Comparing kilograms with pounds |
| Optional fields | Omitted PATCH fields preserve the previous value; explicit null clears a field if allowed | Accidentally resetting unrelated goals |
| Missing goals | Display “No goal set”; permit meal logging | Inventing a target or blocking the core diary |
| Effective date | Define when a change starts; an effective calendar date is sufficient | Applying a new target to unintended days |
| Multiple updates on one date | Keep one effective configuration for that date, or define a clear replacement rule | Conflicting active targets |
| Weight direction | Permit a target above, below, or equal to current weight | Assuming every user wants weight loss |
| Goal completion | Display actual and target accurately; avoid treating a larger number as automatically better | Misleading generic progress badges |

Historical comparisons are a product decision with database consequences. Suppose the target was 2,000 kcal for three days and 2,200 for the next four. The applicable seven-day target is 14,800 kcal. Multiplying the latest target by seven produces 15,400 and changes the meaning of the report. Recommended design: store goal versions with an effective date and use the version applicable on each day. A simpler current-goal-only model can still be defensible if historical charts explicitly say they compare past intake with the current target. The assignment does not expressly mandate version history.

A target weight can be stored without building a weight tracker. If the interface claims to show actual weight progress, however, it needs dated user-entered measurements. Calories logged do not supply observed weight. Weight logging and weight charts are recommended only if that extra behavior is intentionally included.

**Meal entry must preserve the meaning of each number.** A useful entry contains an ID, owner/profile, consumption date, meal type, food name, consumed quantity, quantity unit, calorie amount, protein/carbohydrate/fat amounts, supported micronutrient amounts, and created/updated timestamps. A source such as manual, label extraction, plate estimate, PDF, or chat is useful provenance. Food names should support ordinary Unicode text, including local dishes and brand names.

The four meal categories should be a controlled set. Multiple food items can belong to breakfast on the same date. There can be several snacks. There should not be a uniqueness constraint on date and meal type, or on date, meal type, and food name: a person may genuinely log the same item twice. Retry protection should identify an operation, not prohibit similar meals.

Recommended validation for a confirmed entry is a nonempty food name, valid date and meal category, positive finite quantity, supported unit, and nonnegative finite core nutrient values. A value of zero is valid. A negative quantity, infinity, NaN, or a free-form string in a numeric field is not. Put explicit maximum lengths and computational bounds in the API contract; any particular numeric limits are implementation choices rather than assignment requirements.

For strict core-field completeness, require calories and all three macros before saving a confirmed entry. If an AI result lacks a core field, leave the draft incomplete and request correction. Alternatively, allow incomplete saved entries, but then define their reporting and completeness rules. Do not fill missing fields with invented zeros to make validation pass. Micronutrient omissions should remain unknown; the assignment does not imply that every food must have laboratory-complete nutritional data.

**Serving arithmetic is a central business rule, not a formatting detail.** The input form must state whether nutrition is for the amount consumed or for a reference amount. A manual form can default to “nutrition for this entry.” Label extraction usually needs a reference basis, such as one 30 g serving or 100 g, followed by how much was actually consumed. U.S. nutrition labels illustrate why serving size and per-serving values must travel together, and why a percentage Daily Value is a different field from a nutrient amount. This is a labeling example, not a requirement to support only U.S. products. [FDA label guide](https://www.fda.gov/food/nutrition-facts-label/how-understand-and-use-nutrition-facts-label)

For compatible units:

`consumed nutrient amount = reference nutrient amount × consumed quantity / reference quantity`

For example, a reference amount of 100 g with 120 kcal, 6 g protein, 18 g carbs, and 2 g fat becomes 180 kcal, 9 g protein, 27 g carbs, and 3 g fat for 150 g. Apply the same multiplier to every known micronutrient. Never multiply a set of values already expressed for the consumed portion a second time.

| Quantity/basis case | Required decision |
| --- | --- |
| Half a serving | Accept decimal quantity and scale once. |
| Two pieces | Require a defined per-piece basis or a piece-to-weight mapping. |
| Grams versus kilograms | Normalize compatible mass units before division. |
| Millilitres versus grams | Do not silently assume a density; obtain a valid conversion or use a matching basis. |
| Per 100 g and per serving columns | Select one coherent column and retain its basis. |
| As-sold and as-prepared columns | Identify which preparation state the entry represents. |
| Reference quantity missing or zero | Ask for correction; do not divide or guess. |
| Quantity edited later | Recalculate from the stored reference values, or clearly request new total values if no reference basis exists. |
| Product catalog edited later | Keep historical entries as snapshots of what was logged. |
| Display rounding | Calculate at adequate precision and round for presentation; avoid repeated intermediate rounding. |

Use consistent names such as `calories_kcal`, `protein_g`, `carbs_g`, `fat_g`, and `sodium_mg`. An energy value in kJ must not be stored as kcal. Quantities with incompatible units must not be added. A nutrient identity also matters: “sodium” and “salt” are not interchangeable labels.

**Micronutrients need actual support and an honest missing-data policy.** Provide fields for a documented set containing both vitamins and minerals. For example, vitamin C and vitamin D alongside calcium, iron, potassium, and sodium give meaningful coverage. The exact set is not specified in the brief. Sugar and fiber can be useful extra nutrients, but they do not establish vitamin-and-mineral support.

Represent a known zero as numeric zero and a missing value as null or an absent nutrient record. When only three of four entries supply calcium, report the known subtotal and “calcium data available for 3 of 4 entries.” That count describes recorded-data coverage, not measurement accuracy or a complete dietary assessment. If all values are unknown, show unavailable data rather than a persuasive zero-height bar.

Normalize units per nutrient: for example, calcium in mg and vitamin D in micrograms. Do not put all micronutrients into a single “total micros” number. If a source gives only a reference percentage, preserve that fact or use an explicitly identified reference standard; do not treat the percentage as mg or infer a universal conversion. Different label conventions may require different handling.

**Time-range listing must be defined independently of screen layout.** Users should be able to choose a start date and end date, select all meals or one meal type, move through results, and inspect which filters are active. A single-day query is valid. Invalid dates, a reversed range, an unknown meal category, and invalid paging inputs should produce field-specific errors. Changing the filter should reset or validate the current page.

The simplest assignment-compatible model uses a stored consumption calendar date, such as `consumed_on`, as the diary day. Use the user's configured timezone for relative expressions such as “today” and “yesterday.” Keep `created_at` separate: food eaten yesterday but entered today belongs to yesterday. A timezone preference change should not unexpectedly move historical diary dates.

If exact consumption timestamps are supported instead, define how local date boundaries become database timestamp bounds. A UI range with inclusive start/end dates can map to a half-open timestamp interval ending at the next local midnight. Do not assume a fixed 24-hour UTC duration for every local day. Exact time-of-day filtering is a possible extension, not explicitly necessary for the date-filtering requirement.

Define “week” once. A Monday-to-Sunday calendar week is a reasonable documented default; “last seven days” is a different range. Decide whether future diary dates are accepted. If they represent planned meals, they must not silently enter “actual intake so far.” Planning meals is not required by the brief.

**Pagination is a backend requirement.** Fetching every row and splitting it in the browser does not satisfy it. A straightforward contract is `page=1&page_size=20` with a documented maximum, such as 100; those numbers are proposed defaults. Return `items`, `page`, `page_size`, and `total_items`, plus enough information to determine whether another page exists. Cursor pagination is also valid if the contract is clear.

Filtering and owner scoping occur before pagination. The count describes the entire filtered result, not just the returned page. Use deterministic ordering with a unique tie-breaker, such as consumption date plus entry ID. For a static dataset, walking pages should neither repeat nor omit entries. Concurrent writes can shift offset-based pages; a cursor or snapshot is an optional stronger guarantee.

Apply the rule to every actual list endpoint added: food history, goal history, search results, weight history, chat history, imports, and preview rows if those collections are exposed. Do not create a public user-list API merely because the app supports several users. Static enums and single-resource responses are not ordinary record-list endpoints.

The phrase “all list APIs” could be interpreted to include variable-length report buckets. A conservative design paginates daily/weekly bucket collections too, while returning the full-range report summary separately. A maximum report range is a useful resource bound but is not a substitute for pagination. If the evaluator explicitly permits bounded report series without paging, document that exception; do not silently assume one.

**Nutrition reports should be specified as calculations before choosing chart components.** Every chart needs a scope, a unit, an aggregation rule, and a missing-data rule. The same selected owner and date range should flow through the report API, labels, totals, and any conversational summary. Reports should aggregate the complete matching dataset on the backend, independently of the diary page currently displayed.

| Report | Recommended visual | Calculation and presentation contract |
| --- | --- | --- |
| Weekly calorie intake | Daily bars or a line with all seven dates | Sum confirmed consumed-portion kcal for each diary day. Distinguish an empty diary day from a verified record of eating nothing. |
| Macros by day | Grouped/stacked bars with gram units | Sum protein, carbs, and fat separately for each day. |
| Macros by week | Week-level totals and an optional composition chart | Sum grams across the selected week; label totals versus daily averages explicitly. |
| Micronutrient summary | Nutrient-specific rows or small bars | Sum known amounts in the correct unit; show data coverage. Do not sum different nutrient identities. |
| Goal versus actual | Grouped bars or actual series with a target line | Match the period, unit, and effective goal; show actual values above the target without clipping the data. |
| Weight progress, if added | Dated measurement line and target | Use recorded weights; keep this separate from nutrition aggregation. |

Recommended calorie calculations are:

- Daily actual = sum of saved, confirmed entry calories for that day.
- Period actual = sum of daily actuals over the requested period.
- Period target = sum of each day's applicable target for days with a configured target.
- Delta = actual minus target for the same comparison scope.
- Percentage = actual divided by target, multiplied by 100, only when the relevant target is positive.

If some dates have no target, do not compare all-period actual against only the configured days' targets without explaining the different scope. Either compare only covered days and label coverage, or mark a complete period comparison unavailable. Missing targets are not zero targets.

The current week introduces a second scope decision. A week-to-date actual should be compared with the week-to-date target. A full-week target can also be displayed, but label it as the whole week's target. Future days and unlogged days should not generate unsupported claims about compliance. “Days with entries” is useful metadata but does not establish that those days were fully logged.

For averages, state the denominator. “Average logged calories per calendar day in this seven-day range” and “average on the four days with entries” answer different questions. A report can expose both, but should not silently use whichever makes the trend look better. A range clipped to part of a week should identify the bucket as partial.

For a macro-energy composition chart, a common approximate calculation uses 4 kcal/g for protein and carbs and 9 kcal/g for fat. Normalize against that macro-derived total if the chart claims to show those three shares. General factors, other allowed calculation methods, and label rounding explain why recorded calories need not equal exactly `4P + 4C + 9F`; use this as a sanity check, not a rigid equality constraint. [eCFR nutrition-labeling provisions](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-A/section-101.9)

Do not calculate “percentage of calories from fat” by dividing fat grams by the sum of macro grams. If showing gram composition instead, label it as gram composition. An all-zero denominator should produce an empty state. Additional carbohydrate/fat components should not be added to their parent macro again.

Reports must update after an entry is created, edited, deleted, or imported, or after an applicable goal changes. Avoid separately maintained totals until there is a concrete need: they add reconciliation and cache-invalidation risks. A subtle database error is summing entry calories after joining each entry to several micronutrient rows; the join can multiply the calorie amount. Aggregate at the correct level or preaggregate each side.

**AI extraction contains two distinct input problems.** A label provides text and numbers that must be read and interpreted. A plate photo requires estimating the food identity and consumed amount. Those paths can share an API but should not promise identical certainty.

| Input | What the feature should do | Principal uncertainty |
| --- | --- | --- |
| Nutrition label | Extract available nutrients, units, reference amount, and relevant column into structured editable fields | Blur, glare, crop, column selection, unit recognition, and serving interpretation |
| Plate of food | Identify likely foods and propose editable portion/nutrition estimates | Portion scale, mixed ingredients, preparation, hidden oil/sauce, and unobservable nutrient details |

The wording “product nutrition label or a plate of food” leaves room to debate whether one mode would suffice. To avoid a weak interpretation, plan to demonstrate both. If there is a constraint that forces a single mode, ask the evaluator rather than assuming that label-only OCR covers plate estimation.

A robust mandatory workflow is: upload; validate the file; call the backend's image-analysis adapter; validate the structured response; show an editable draft with portion assumptions; let the user correct it; then save through the ordinary food-entry service. “Pre-fill” is the important word: an extraction result is not yet evidence that the person consumed that amount, and should not automatically enter reports.

The minimum useful result has food name or items, a reference/consumed quantity, units, kcal, protein/carbs/fat where available, available micronutrients, input type, and useful uncertainty notes. Fields that cannot be established stay missing. Do not require the model to invent every vitamin to satisfy a rigid response shape. A plate estimate can provide clearly identified estimated core values, while unsupported micronutrients remain unavailable.

If a plate contains rice, dal, and paneer, a single editable mixed-meal entry or separate editable item entries can both satisfy the brief. Choose and document one. If separate items are returned, do not also save the whole-plate total as another consumed entry. A mixed entry should not pretend that its components were independently measured.

Useful extraction failure handling includes readable messages for invalid images, images with no relevant food information, unreadable labels, missing portions, unsupported units, invalid response structure, out-of-range values, model timeout, missing configuration, and provider quota exhaustion. Manual entry and existing reports should remain usable when AI fails. That fallback improves robustness but does not replace the obligation to demonstrate a working AI feature.

The server should own credentials, provider configuration, request deadlines, and error translation. A provider adapter keeps those details separate from nutritional business rules. Persist the accepted nutritional snapshot and its source; a model response should not directly write arbitrary database fields. Keeping the raw image or full raw model response forever is not required. Avoid exposing hidden prompts, secrets, or stack traces in frontend errors.

A model's own confidence number is not a measured accuracy guarantee. Prefer concrete statements such as “portion size estimated” or “serving size unreadable,” and keep user corrections visible. If benchmarking is added, report the sample set and the actual metric instead of an invented percentage.

For uploads, use an allowed-format policy, validate file content rather than trusting the filename alone, set byte and image-dimension limits, and avoid exposing private uploads as public files. A configurable limit is a design choice; no exact file size is specified in the assignment. [OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

**The architecture can remain a modular single backend.** Separate frontend and backend directories, distinct startup commands, a documented HTTP API, and backend-only database access are a clear fit. A single repository is acceptable. A single origin behind a reverse proxy is also compatible with separation. The assignment does not require microservices, several repositories, or a separate server for every feature.

| Component | Responsibility | Boundary to preserve |
| --- | --- | --- |
| Frontend pages/components | Forms, filters, upload preview, visualizations, loading/error states | No database credentials, direct database queries, or provider secrets |
| Frontend API client | Request serialization, authentication handling, response/error mapping | Reuse one request policy rather than scattering inconsistent calls |
| API routes/controllers | Request validation, identity, status codes, response schemas | Keep substantial nutrition calculations out of route handlers |
| Domain services | Quantity scaling, meal mutations, goal selection, reporting, import commit | One implementation shared by UI-triggered, chat, and import actions |
| Database access | Queries, transactions, owner scoping, persistence | Keep database-specific details out of presentation components |
| AI adapter | Image/chat provider invocation and structured-result handling | Model output is input to validation, not authority to bypass it |
| PDF parser, if added | Extract supported tabular rows with source locations | Return candidate entries instead of writing around the domain service |

An internal chat tool can call the shared service directly within the backend. The frontend still communicates exclusively through APIs; internal backend modules do not need to make artificial HTTP calls to one another. A frontend may calculate a temporary form preview, but the backend must validate and calculate authoritative saved values.

**A relational database is a strong default because the records have clear ownership and reporting relationships.** It is a recommendation, not an assignment constraint. A document database can work with disciplined schemas and aggregation. The correct choice is one whose persistence and calculations can be demonstrated reliably.

| Entity | Essential or useful fields | Status and rationale |
| --- | --- | --- |
| `users` or `profiles` | ID, timezone, timestamps; email and password hash if local account auth is added | User/profile persistence is required; signup/login is bonus. A documented single-profile baseline is possible. |
| `food_entries` | ID, user/profile ID, consumption date, meal type, name, quantity/unit, consumed-portion core nutrition, source, timestamps | Core record. Optional typed source-basis metadata supports reliable rescaling. |
| `nutrient_definitions` | Canonical code, display name, unit, vitamin/mineral classification | Recommended controlled vocabulary; avoids arbitrary incompatible keys. |
| `entry_micronutrients` | Entry ID, nutrient code, known consumed-portion amount | Recommended flexible representation; unique entry/nutrient pair and referential integrity. |
| `goal_versions` | User/profile ID, effective date, calorie/macro targets, optional weight target, timestamps | Recommended if historical comparisons are implemented. A single current-goals record is a simpler disclosed alternative. |
| `weight_logs` | User ID, measurement date, weight | Optional; needed only for actual weight history/progress. |
| `imports` and preview rows | User ID, file fingerprint, status, source row identity, validation result, committed operation | Bonus support for repeatable PDF review and commit. |
| `chat_threads` and `chat_messages` | User ID, thread ID, content, timestamps, tool-result references where useful | Optional supporting storage if persistent conversation history is provided. |

A fixed micronutrient-column set or a validated structured map is also acceptable. The key properties are nutrient identity, units, numeric validation, missing-data semantics, and reportability. Do not normalize everything into many tables just to appear sophisticated, and do not store an unvalidated blob if the rest of the app must reliably calculate from it.

Store entry nutrition as a snapshot of the consumed portion. If reference/basis values are also retained for future quantity edits, treat consumed values as a defined derivative and recompute them through one service in the same transaction. Avoid two independently editable sources of truth. A shared food catalog is optional, and changing it must not retroactively rewrite old diary entries.

Useful database constraints include foreign keys, valid meal categories, positive quantities, nonnegative known nutrients, unique nutrient codes per entry, and one effective goal version per user/date where that model is used. Use adequate numeric precision. An index beginning with user ID and consumption date supports typical owner/date queries; add further indexes based on actual filter/query behavior.

Save a food entry and its nutrient rows atomically. Delete related rows according to an explicit cascade or service rule. External AI calls should normally finish before a short database write transaction starts. Provide migrations and an intentional seed/reset procedure. Startup should not silently erase or recreate user data. A local file database is still a database, but hosting must preserve its file if the application is deployed; an ephemeral process filesystem is not durable storage.

**The API surface below is an illustrative contract, not a prescribed naming scheme.** API documentation should settle request types, ownership, pagination, and validation before frontend assumptions spread.

| Endpoint example | Purpose | Scope |
| --- | --- | --- |
| `GET /api/v1/profile` | Obtain the current profile and relevant settings | Single resource |
| `PATCH /api/v1/profile` | Update supported profile settings | Recommended |
| `POST /api/v1/entries` | Validate and save a consumed food entry | Required |
| `GET /api/v1/entries` | Filter by date/meal and paginate matching entries | Required |
| `GET /api/v1/entries/{id}` | Retrieve one owned entry | Recommended |
| `PATCH /api/v1/entries/{id}` | Correct an owned entry and recalculate affected nutrition | Recommended |
| `DELETE /api/v1/entries/{id}` | Remove an owned entry and update report results | Recommended |
| `GET /api/v1/goals/current?date=...` | Obtain the goal applicable on a date | Required goal-read capability |
| `PUT /api/v1/goals/current` | Set a complete goal configuration under a documented effective-date policy | Required goal-write capability |
| `GET /api/v1/goals/history` | Paginate goal versions if exposed | Recommended with history |
| `GET /api/v1/reports/nutrition` | Full-range summary plus paginated day/week buckets | Required reporting capability |
| `POST /api/v1/nutrition/extract` | Receive an image and return a validated editable extraction draft | Required |
| `POST /api/v1/auth/signup`, `/login`, `/logout` | Account/session lifecycle | Bonus |
| `POST /api/v1/chat/messages` | Run a conversational request using authorized domain tools | Bonus |
| `GET /api/v1/chat/threads/{id}/messages` | Paginate saved conversation history if provided | Optional supporting feature |
| `POST /api/v1/imports/pdf` | Parse a PDF and create a preview | Bonus |
| `GET /api/v1/imports/{id}/rows` | Paginate preview rows and their validation results | Bonus support |
| `POST /api/v1/imports/{id}/commit` | Save the chosen validated rows without duplicate commits | Bonus support |

Example filtered list request: `GET /api/v1/entries?start_date=2026-09-01&end_date=2026-09-07&meal_type=breakfast&page=1&page_size=20`.

Use one error envelope with a stable code, user-readable message, and field errors when appropriate. Document choices for invalid input, unauthenticated access, unavailable/not-owned resources, duplicate conflicts, oversized/unsupported uploads, and external-service failures. The exact choice between conventional validation statuses such as 400 and 422 is less important than consistency and useful semantics. Never report “saved” merely because the frontend dispatched a request.

**The conversational bonus requires actions, not just generated answers.** A completed chatbot should translate user intent into calls to the same validated services used by the normal interface. It should retrieve authoritative totals and goal values before answering questions about the user's records. It should acknowledge a mutation only after the operation succeeds.

| Conversational request | Necessary behavior |
| --- | --- |
| “Log 150 g of this yogurt for breakfast today.” | Resolve the food/nutrition basis, obtain missing information if needed, and create a real dated entry. |
| “Change that to lunch yesterday.” | Resolve the prior entry, apply an authorized update, and refresh affected dates' reports. |
| “What is my protein goal?” | Read the applicable saved goal rather than inventing a typical value. |
| “Set my daily calorie target to 2,100 starting Monday.” | Resolve the date, validate the value, and persist the configuration. |
| “Show dinners from last week.” | Resolve last week's dates and meal filter, and support continuation through all results. |
| “How did I do this week?” | Use report-service totals, date scope, goal coverage, and missing-data information. |
| “Delete the duplicate lunch.” | Identify the specific entry or ask which one; do not choose arbitrarily among matches. |
| “What does protein do?” | Answer the general nutrition question separately from claims about the user's actual records. |
| Attached food photo or PDF | Route the attachment through the existing extraction/import flow if claiming full action parity. |

“All app actions” is broad. Inventory every authenticated action your app exposes and decide whether chat can perform it, including correction and deletion if those exist. The examples in the brief are a minimum indication, not proof that a read-only chatbot meets the bonus. Signup/login can remain the access boundary; the assistant does not need users to type passwords into chat. Attachments inherently require supplying a file, but the subsequent review and commit can be conversational. Document any action not supported through chat.

Multi-turn ambiguity is a real functional issue. “I ate a bowl of rice” lacks a defined portion, preparation, and possibly meal type. Ask a focused follow-up or offer an explicitly estimated interpretation. “Last week” and “the last seven days” should resolve differently. “Delete that” should carry a concrete saved record reference from the conversation, not a fresh guess by name.

An unambiguous, validated logging request can save directly. Estimated, unclear, or broad destructive operations need a review or clarification step suited to the request. Do not make every harmless read require confirmation, and do not force ordinary meal logging through a long conversational ceremony. Use operation identifiers so a retry or repeated tool response does not create a second entry.

Give the model a small allowlist of tools with typed arguments. Do not allow arbitrary SQL, arbitrary code execution, or model-selected user identity. Text inside food names, images, PDFs, and retrieved records is data, not permission to take unrelated actions. Tool authorization and argument checks must still run even if the model proposes a convincing-looking call. These controls address the prompt-injection and tool-manipulation risks relevant to this bonus. [OWASP LLM prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

**The multi-user bonus adds an ownership requirement to the whole application.** Signup/login screens alone are insufficient. An authenticated user's identity should come from a verified session or credential, and the backend must verify access to every entry, goal, report, image, import, and conversation. Guess-resistant IDs do not replace object-level authorization. [OWASP object-level authorization guidance](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)

Use established authentication/password-handling facilities and properly hashed passwords if storing local credentials. Do not put plaintext passwords or live API keys into the database seed or repository. Define duplicate-account errors, incorrect-login behavior, expired sessions, logout, and what the frontend displays after authentication expires. Authentication details depend on the chosen framework and should be checked against its official documentation during implementation.

A user must not be able to change a request's `user_id` or entry ID to access someone else's information. Report queries need ownership filters just as detail queries do. Import IDs and chat-thread IDs also need checks. Clear or scope frontend caches on account changes so that user B does not briefly see user A's dashboard. If cookies are used, account for the corresponding browser request protections; if frontend/backend origins differ, configure the intended origins and credentials deliberately. CORS alone is not an authorization mechanism.

If the bonus is omitted, a documented single-profile application can meet the core scope. Still persist the profile in the database. Including an owner/profile foreign key from the beginning makes future account support easier, but an unprotected shared profile must not be presented as private multi-user support.

**The PDF bonus needs a declared input contract.** The brief specifies tabular food diaries or nutrition histories, not universal interpretation of every PDF. Start with a supported text-based table schema, for example date, meal, food, quantity, unit, calories, protein, carbs, fat, and optional micronutrient columns. Provide at least one representative sample and describe recognized headers, date formats, and units.

Text PDFs and scanned image PDFs need different handling. Supporting scanned documents generally introduces OCR and additional ambiguity; it is not explicitly required. Likewise, multilingual layouts, arbitrary merged cells, handwritten diaries, and hundreds of pages are additional scope unless promised. Unsupported documents should produce a clear message rather than an empty “successful” import.

A useful workflow is upload, parse candidate rows, map or recognize columns, validate, preview, resolve errors, and commit selected valid rows. Preview is a recommended safeguard, not a verbatim assignment requirement. Preserve the source page/row for each candidate so a user can locate a problem. Split rows and repeated headers may occur across pages. Daily subtotals must not be imported as additional food entries when the underlying foods were already imported.

Important cases include password-protected PDFs, corrupt files, ambiguous dates such as `03/04/2026`, missing meal types, decimals with locale-specific separators, quantity written as `150 g`, nutrition basis unclear, micronutrient units in headers, and dates carried down implicitly from a group heading. Do not resolve an ambiguous date or serving basis silently.

Choose a transaction policy. A practical default lets the user explicitly select the validated rows, then commits that selection atomically; invalid or excluded rows remain visible in the result. If partial success is supported instead, report exactly which rows were saved and which failed. Revalidate at commit time, and bind every row and import to the acting user.

Prevent repeated commits of the same import operation. A file fingerprint can flag a likely repeat, but should not globally ban identical meals or identical files across independent users. Use import identity and source-row identity for retry protection. An identical diary imported deliberately a second time is a different decision from a timeout retry, and should be handled visibly. Return saved/skipped/failed counts that agree with the actual database outcome.

**Implicit usability requirements are modest but important.** Every network-backed screen needs loading, empty, success, and failure states. Keep form inputs after a failed save. Disable accidental repeated submissions while a request is in flight, and use backend retry protection for operations where that matters. After a mutation, refresh the relevant diary and reports. If a session expires, explain the need to sign in instead of displaying an empty dashboard as though the data disappeared.

Responsive layouts, labeled controls, keyboard operation, readable units, and text alternatives to color-only charts are good implementation choices. A dashboard should display real database results and useful no-data states. It should not pre-populate persuasive production-looking values merely to make the charts attractive. Demo seed data are fine when explicitly identified and isolated from real user data.

There are no stated service-level objectives. Choose practical response limits and bound list sizes, upload sizes, and expensive model/import operations. Long-running parsing or image analysis may justify job status/polling, but a queue, distributed cache, background worker cluster, and WebSocket transport are not intrinsically required. Prefer the smallest design that meets actual response and reliability needs.

**The explicit grading criteria are code clarity, modularity, documentation, error handling/validation, and appropriate comments.** The brief says code quality carries significant weight, but provides no percentages. It would be misleading to claim that a particular feature guarantees a score. The following are reasonable evaluator checks inferred from the specification.

| Evaluation area | What a reviewer can inspect | Common weak submission |
| --- | --- | --- |
| Mandatory completeness | Each required feature works from the browser | A chart page or AI upload control exists but its workflow is incomplete |
| Correctness | Quantities, totals, filters, dates, and goals agree on known fixtures | Attractive charts with incorrect arithmetic or scope |
| Architecture | Frontend uses documented backend APIs; data access stays server-side | Client-side persistence or duplicated business logic |
| Persistence | Entries/goals survive refresh and process restart | In-memory state or startup reset mistaken for a database |
| Pagination | All exposed collections have working API paging | Pagination only in the frontend or only on one endpoint |
| Code readability | Small focused modules and meaningful names | A single large file containing routes, prompts, SQL, and UI logic |
| Reuse | Manual, AI, PDF, and chat writes use the same validation/calculation path | Four similar implementations that disagree |
| Robustness | Invalid input, missing AI configuration, and failed requests are recoverable | Generic alerts, swallowed exceptions, or false success |
| Documentation | A fresh checkout can be run with the README | Missing migrations, secret configuration steps, or undocumented assumptions |
| Bonus depth | Real actions, private ownership, and working PDF parsing | Chat that only answers, cosmetic login, or a hardcoded import result |
| UI clarity | Units, scopes, missing-data states, and action outcomes are visible | Unlabeled numbers, clipped over-target values, or no error states |

Good comments explain why consumption date differs from creation date, why null nutrients remain unknown, how serving rescaling works, why goals use effective dates, or why duplicate import commits are rejected. Comments repeating a function name add little value. Splitting one large function into arbitrary files also does not create meaningful modularity; boundaries should follow responsibilities.

**The most consequential failure points are predictable.** They should be prioritized before optional polish.

| Failure point | Consequence | Prevention or decisive check |
| --- | --- | --- |
| Spending the schedule on bonus chat before image extraction works | Missing a mandatory AI feature | Prove one real label and plate request early; finish required workflows before expanding bonuses |
| Nutritional values lack a serving basis | Every report may be systematically wrong | Make the basis explicit and test fractional/multiple portions |
| Unknown micronutrients become zero | Reports imply false completeness | Preserve nulls and report known-data coverage |
| Aggregation uses only the loaded diary page | Large histories undercount | Backend aggregate over the full filtered set; test with more than one page |
| Joining micronutrient rows duplicates food rows | Inflated calories/macros | Aggregate at entry level and test several micros on one food |
| Latest goal overwrites the meaning of history | Misleading historical comparisons | Version by effective date or label current-goal comparisons clearly |
| Date filters use creation time or server-local time | Entries appear in the wrong day/week | Define and consistently use consumption-date semantics |
| A failed request was actually committed | User retry creates duplicates | Record operation identity for retry-sensitive mutations |
| AI returns plausible but wrong units/columns | Large nutrition errors | Validate types, units, basis, and allow corrections before save |
| API/model credentials or quota are unavailable | AI demonstration cannot run | Document configuration and verify provider access before the final demo |
| Report or import routes omit owner scoping | Private data leakage with accounts | Exercise negative cross-user tests on every feature family |
| PDF summary rows are imported with details | Double-counted daily totals | Detect headers/subtotals and preserve source-row review |
| A database exists only on disposable storage | Data disappear across redeployment | Verify the persistence configuration if hosting is included |
| Setup depends on unexplained local state | Evaluator cannot run the app | Test setup from an empty database using the README |

**Acceptance tests should demonstrate behavior, not merely mirror implementation details.** The following are proposed tests; they have not been run against an application because no application is being built in this step. Core calculations can use deterministic fixtures. AI integration needs a small real-image demonstration in addition to deterministic validation tests.

| Test | Scenario | Expected result |
| --- | --- | --- |
| T01 | Save goals, reload, and restart the backend | Identical persisted goal values are returned. |
| T02 | Log entries under Breakfast, Lunch, Dinner, and Snacks | Each appears in the correct group and contributes once to totals. |
| T03 | Log a food twice intentionally | Both entries are kept; ordinary repetition is permitted. |
| T04 | Submit zero/negative quantity, negative nutrients, unsupported meal, and invalid date | Invalid inputs fail with useful field errors and no partial writes. Known zero nutrients remain valid. |
| T05 | Use the 100 g reference fixture at 150 g | Saved nutrition is 180 kcal, 9 g protein, 27 g carbs, and 3 g fat. |
| T06 | Edit that quantity from 150 g to 200 g | It becomes 240 kcal, 12 g protein, 36 g carbs, and 4 g fat, without rescaling already-scaled values. |
| T07 | Enter label calories differing modestly from `4P + 4C + 9F` | Preserve valid supplied calories; do not reject solely for exact inequality. |
| T08 | Four entries have calcium values 100, null, 20, and 0 mg | Show a known subtotal of 120 mg with data for 3 of 4 entries. |
| T09 | Add multiple micronutrient rows to one entry | Its calorie/macro contribution remains one entry's worth. |
| T10 | Create 25 matching entries at 10 kcal each; page size is 10 | Three pages contain 10, 10, and 5 entries; total count is 25 and full-range report is 250 kcal. |
| T11 | Change meal/date filters while viewing a later page | Results and count follow the new filters and paging resets or remains valid. |
| T12 | Query one day, an empty interval, a reversed interval, and an out-of-range page | One-day and empty requests behave deliberately; reversed range errors; a valid empty page does not crash. |
| T13 | Log yesterday's food today | It belongs to yesterday's diary/report. |
| T14 | View a week with some unlogged days | All dates are represented; the UI identifies missing logging and does not claim verified zero food intake. |
| T15 | Use three days of a 2,000 target and four of a 2,200 target | Under historical-goal semantics, the weekly target is 14,800 kcal. |
| T16 | View a comparison before any goal exists, and a macro comparison with zero target | No divide-by-zero, fabricated default, or misleading percentage. |
| T17 | Edit/delete a saved entry or commit an import | All affected diary and report totals refresh and match database state. |
| T18 | Upload a readable nutrition label | Real analysis prefills its visible core values and coherent serving basis, then user-confirmed saving works. |
| T19 | Upload a plate image | Real analysis returns an editable estimated food/portion result without claiming exact hidden nutrient knowledge. |
| T20 | Upload an unreadable/non-food image or receive malformed model output | The app gives a recoverable explanation and does not save invented data. |
| T21 | Simulate model timeout or missing key | Existing manual entry/history/report flows still work; AI failure is clearly reported. |
| T22 | Lose the network around a save and retry the same protected operation | At most one intended write occurs, and the final state can be reconciled. |
| T23 | Start with an empty database and follow the README | Schema creation, configuration, startup, and a complete manual workflow are reproducible. |
| T24 | Add an entry, then restart processes normally | Data are still present; seed logic has not reset them. |
| BT01 | With two accounts, try another user's entry/goal/import/chat IDs and reports | All unauthorized paths fail without exposing the other user's data. |
| BT02 | Change accounts in one browser | No prior user's cached private records are displayed. |
| BT03 | Ask chat to save a sufficiently specified meal and then inspect the diary | The real record exists and the assistant reports the actual successful result. |
| BT04 | Ask chat to modify an ambiguous “lunch” with several matches | It asks for enough detail instead of changing an arbitrary record. |
| BT05 | Ask chat for a report spanning several diary pages | Its numerical answer agrees with the report service over the full scope. |
| BT06 | Put instruction-like text into an image/PDF/food name | It cannot grant cross-user access or cause unrelated tool actions. |
| BT07 | Import a supported multi-page PDF containing repeated headers and subtotals | Only actual food rows are committed, with correct quantities and dates. |
| BT08 | Include invalid or ambiguous rows in the PDF | They are visible and handled according to the documented commit policy. |
| BT09 | Commit the same import operation twice or retry after timeout | No duplicate committed batch appears. |

Run enough focused tests to establish these risks are controlled. There is no need to write tests for every static label or to chase a coverage percentage unrelated to behavior. Separate model-output validation tests from live-provider tests so the suite remains useful without a paid key. A mocked AI adapter is useful for tests but must not be represented as proof that the real feature works.

**A README should enable a fresh evaluator to reproduce the result.** Include the application's purpose and implemented feature list; prerequisites and supported runtime versions; frontend and backend installation/start commands; database configuration, migrations, and seed instructions; environment-variable names in an example file without secrets; and instructions to run relevant checks and a production build if provided.

Also document API examples, authentication mode, paging defaults/limits, accepted dates and units, serving semantics, missing nutrient handling, week boundaries, goal-history behavior, AI configuration and limitations, and supported PDF format if applicable. State how to access sample data and how to reset it safely. Identify optional features that are incomplete or omitted. A demo account should be clearly artificial and should never use someone's real password.

Screenshots, a short demo recording, an API collection, and a deployment link can make review easier. The supplied brief does not explicitly require them. Likewise, Docker can simplify setup, but Docker itself is not a requirement. If a hosted demo is included, ensure that it does not replace reproducible local instructions or depend on undisclosed keys supplied by the evaluator.

**A practical implementation order protects the mandatory scope.** This is dependency guidance, not a time estimate; a realistic schedule needs the deadline and available hours.

1. Set the domain decisions: supported nutrients, units, consumption date, week definition, goal history, and pagination. Create a few arithmetic fixtures. Make a small real-provider feasibility check for both a label and a plate before assuming the AI dependency works.
2. Set up separate frontend/backend modules and a persistent schema. Include profile ownership from the beginning. If choosing the multi-user bonus, establish authentication and owner scoping here before adding many data paths.
3. Complete one vertical manual workflow: create a meal, save it, list it through the API, reload, and observe persisted data. Add corrections and deletion if included.
4. Add goal management and filtered/paginated history. Validate dates, quantities, units, empty states, and failure behavior.
5. Implement report calculations and test them against known fixtures before styling charts. Verify totals beyond the first page and ensure corrections refresh results.
6. Complete mandatory image upload, validated extraction, editable prefill, and normal-service saving. Verify a real label and a real plate example.
7. Finish core error handling, setup documentation, and end-to-end acceptance checks. At this point the base assignment should be demonstrable.
8. Add chosen bonuses based on remaining time and evaluator preferences. Independent accounts are a strong first choice if not already done. PDF import is bounded by its supported format; chat becomes easier once every action already exists as a tested service.
9. Verify each claimed bonus and run a fresh-setup demonstration. Apply final UI polish after functional gaps are resolved.

**The questions that could materially change implementation are specific.** They are questions for the evaluator when available, not reasons to stop this requirements analysis.

| Open question | Why it matters | Sensible working assumption |
| --- | --- | --- |
| What is the deadline and submission format? | Controls bonus scope and packaging | Finish mandatory workflows first; provide source and a reproducible README. |
| Are both label and plate photos expected? | Determines the real AI coverage | Support both modes. |
| Is an external AI API permitted, and whose key will be used for review? | Affects provider availability and demonstration | Keep a configurable backend adapter and document credentials; do not assume free access. |
| Which micronutrients must be supported? | Affects forms, schema, examples, and completeness | Implement a documented set of both vitamins and minerals, with units and unknowns. |
| Must missing core macros block a saved entry? | Affects validation and reporting coverage | Keep incomplete extraction as a draft; require core fields for confirmed entries. |
| Are goals historical or current-only? | Changes comparisons and schema | Use effective-date versions if feasible; otherwise label current-target comparisons. |
| What does “week” mean? | Changes queries and summaries | Use a documented Monday-to-Sunday week and name rolling ranges separately. |
| Do report bucket arrays count as list APIs? | Affects literal pagination compliance | Paginate variable-length bucket collections and keep full-range summaries independent. |
| What PDF formats are used for evaluation? | Determines extraction work | Support a documented text-based table, with sample input; scans are additional scope. |
| How broad is conversational “all actions”? | Defines the bonus acceptance boundary | Cover authenticated actions actually offered by the app, with documented attachment handling. |
| Is hosting mandatory? | Changes persistence and deployment work | The brief does not require it; prepare local setup and add hosting if requested. |

**Features that should not enter the mandatory backlog without a reason include** barcode scanning, a comprehensive global food database, automatic calorie prescriptions, meal plans, recipe management, exercise tracking, wearable integration, payment plans, social features, reminders, export to PDF/CSV, mobile-native apps, training a custom vision model, a vector database, and a multi-agent system. Some could be useful later; none is necessary merely because this is a nutrition application.

The base submission is ready for review when every mandatory requirement has a working browser workflow, an authoritative API/data path, and an observable correctness check; when a fresh setup succeeds; and when assumptions and AI limitations are documented. Bonus completion should be claimed only for behavior that actually works across the same validation, persistence, and ownership rules.
