# NutriTrack

NutriTrack is a full-stack application for recording meals and
understanding personal nutrition. The persisted diary, current goals, dashboard,
and reports support manual entry plus two optional Gemini-assisted workflows:
nutrition-label/plate image extraction and nutrition estimation from explicitly
submitted meal basics. Both produce strictly validated, editable suggestions.
AI analysis never saves a meal; the user must review the draft and explicitly
choose Save meal to submit the ordinary meal POST.

All completed application source, tests, and executable support code are written
in strict TypeScript. The backend production build emits JavaScript to
`server/dist`; production startup executes that compiled output with Node.

## Stack and prerequisites

- Node.js 24.x (verified with 24.16.0)
- npm 11.x (verified with 11.13.0)
- React 19.3.0, Vite 8.3.0, React Router 7.18.3, Recharts 3.10.1,
  React Hook Form 7.88.0, and @hookform/resolvers 5.9.1
- Express 5.2.1, pg 8.23.0, Zod 4.6.2, Helmet 8.3.0, CORS 2.8.6,
  Multer 2.3.0, Sharp 0.35.4, express-rate-limit 8.7.0,
  jsonwebtoken 9.0.2, Nodemailer 7.0.6, and @google/genai 2.22.0
- ESLint 10.10.0, Node test runner/Supertest, Vitest, and React Testing Library
- TypeScript 5.9.3 with strict NodeNext backend and bundler-aware frontend
  configurations; `tsx` is used only for development and source-level tests

The client and server are independent npm packages. From the repository root:

```bash
nvm install
nvm use
npm --prefix server ci
npm --prefix client ci
```

## Backend environment and TLS

The backend loads server/.env through Node native environment-file support.
Copy the safe template and replace placeholders:

```bash
cp server/.env.example server/.env
```

Configure PORT, NODE_ENV, CLIENT_ORIGIN, TRUST_PROXY_HOPS, DATABASE_URL,
PG_CA_CERT_PATH, JWT_SECRET, and SESSION_TTL_HOURS. DATABASE_URL must be a PostgreSQL URI without any ssl-prefixed
query option. PG_CA_CERT_PATH must identify the trusted provider CA certificate
file on disk (for example, a WSL path when developing on Windows).
TRUST_PROXY_HOPS is the number of proxy hops Express trusts when resolving the
client IP from X-Forwarded-For, including for per-IP AI rate limiting. Use 0 for
direct access and 1 behind one reverse proxy or load balancer.

JWT_SECRET must be an unpredictable value of at least 32 characters.
SESSION_TTL_HOURS defaults to 24 and accepts 1 through 720. Optional welcome
email uses Nodemailer when all five SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASSWORD, and SMTP_FROM values are configured; leaving all five absent
disables email without disabling signup. Welcome email is informational and
does not verify email ownership.

The process owns one shared pg.Pool. It verifies the configured CA with
rejectUnauthorized enabled, allows at most five connections, and uses bounded
connection, idle, and statement timeouts. Startup proves connectivity before
listening. Logs do not print database URLs, certificate paths, SQL, or secrets.

Gemini uses the optional GEMINI_API_KEY and GEMINI_MODEL pair. Both values must
be present and nonblank. Missing AI configuration does not block startup or any
manual/profile/goal/report API, but image extraction and meal-basics estimation
return a safe configuration error when Gemini is unavailable. Gemini is the
sole AI provider. The browser receives no provider credentials. Never put
backend credentials into VITE-prefixed values or tracked example files.

## Database setup

Migrations are explicit operator actions, not application-startup behavior.
Inspect the configured target, then run:

```bash
npm --prefix server run db:migrate
npm --prefix server run db:migrate
```

The first run applies pending migration files atomically under an advisory lock.
The second must report that the schema is current. Migration 001 creates the
original profile, goals, and constrained meals table. Migration 002 adds users,
hashed JWT sessions, per-user ownership, and ownership indexes. Existing records
are preserved under a reserved non-login legacy owner; no signup receives them.
Do not edit an applied migration or reset a database to conceal conflicts.

Each signup atomically creates a profile defaulting to the email local part and
Asia/Kolkata plus an all-null goals row and empty diary. The authenticated
Profile page can update only the display name; the persisted timezone remains
operator-managed. To assign preserved legacy data, first back up
the database, create the intended login account, leave that account's profile,
goals, and diary untouched, and run:

```bash
npm --prefix server run db:assign-legacy -- user@example.com
```

The command is operator-only, transactional, and refuses a missing account or
an account containing nondefault profile, goal, or meal data. It replaces that
empty account's defaults with the preserved legacy profile/goals and moves the
legacy meals; it is not exposed by the API. The persisted IANA timezone defines
the backend value of today and never rewrites meal DATE values.

## Run the applications

Run these in separate terminals:

```bash
npm --prefix server run dev
npm --prefix client run dev
```

The API defaults to http://localhost:3000/api/v1 and the client to
http://localhost:5173. Build before starting the production backend:

```bash
npm --prefix server run build
npm --prefix server start
```

`npm start` runs `server/dist/server.js` with Node and does not depend on a
TypeScript development runner. The build removes only stale `server/dist`
output, type-checks production source, and emits a fresh build.

NutriTrack requires an authenticated account. Profiles, goals, meals, reports,
and nutrition workflows are scoped to the validated session owner. Signup does
not inherit legacy or other users' data.

Set VITE_API_BASE_URL only when the browser should use a non-default API:

```bash
VITE_API_BASE_URL=http://localhost:3000/api/v1 npm --prefix client run dev
```

This value is a public browser URL, not a place for secrets.

The backend CLIENT_ORIGIN must exactly match the browser origin. The standard
development origin is http://localhost:5173 and preview is
http://localhost:4173; change the configured origin between those checks rather
than disabling CORS or allowing a wildcard. Browser API calls include
credentials. Development uses an HttpOnly SameSite=Lax cookie; production uses
an HttpOnly Secure SameSite=None cookie because the currently supported client
and API may have different origins. Some browsers restrict cross-site cookies,
so a same-site deployment or same-origin /api reverse proxy is the reliable
production topology. Keep CLIENT_ORIGIN exact and never replace it with a
wildcard.

## Authentication API

The browser provides responsive /signup and /login pages. Authentication uses
the existing /api/v1 convention:

| Method and path | Success | Purpose |
| --- | --- | --- |
| POST /api/v1/auth/signup | 201 | Create an account, default profile, all-null goals, and session |
| POST /api/v1/auth/login | 200 | Verify credentials and create a session |
| GET /api/v1/auth/me | 200 | Read the current session user |
| POST /api/v1/auth/logout | 204 | Revoke the session and clear its cookie |

Email is trimmed and lowercased; passwords are never trimmed or lowercased and
must contain 12 through 128 characters. Passwords use salted scrypt hashes.
JWTs use HS256 with issuer/audience, subject, session ID, and expiry claims.
Only the JWT SHA-256 hash is stored in PostgreSQL; logout revokes that row.
The session cookie is HttpOnly, limited to /api/v1, and expires after the
configured SESSION_TTL_HOURS (24 by default).

POST requests use an exact Origin check against CLIENT_ORIGIN for CSRF
protection, and auth submission is rate limited. The central client sends
credentials and redirects a 401 to login without replaying a failed write.
Authentication errors are generic and do not expose passwords, tokens, or
database details. Password reset, email verification, social login, account
deletion, and administrative screens are intentionally not implemented.

## Meal-basics nutrition estimation API

POST /api/v1/nutrition/estimate accepts application/json with exactly
food_name, meal_type, consumption_date, consumed_quantity, and quantity_unit.
It applies the existing name, category, date, quantity, unit, numeric-bound,
and four-decimal rules without weakening the complete meal-write schema.
Unexpected fields, query parameters, numeric strings, future consumption dates,
and incompatible media types are rejected.

The route makes one bounded Gemini text request with structured JSON output.
It asks for consumed-quantity totals in kcal, g, and the canonical mg/mcg
micronutrient units. Unknown values remain null and known zero remains zero. An
`ok` result contains at least one known core nutrient; a
`needs_clarification` result contains a useful clarification and no nutrition
guesses. Provider metadata and `is_estimate=true` are assigned by the server.

```bash
curl -i -X POST http://localhost:3000/api/v1/nutrition/estimate \
  -H 'Content-Type: application/json' \
  --data '{"food_name":"cooked brown rice","meal_type":"lunch","consumption_date":"2026-09-12","consumed_quantity":200,"quantity_unit":"g"}'
```

The response is a suggestion only: it has provider/status, nullable core and
six-key micronutrient values, assumptions, clarification, and missing_fields.
It does not echo food_name, consumption_date, consumed_quantity, quantity_unit,
or meal_type; the client retains those values from the request it just sent.
It never includes a saved-meal ID and performs no meal/goal write. On
`/meals/new`, Estimate nutrition is an explicit action, never a typing trigger.
Successful values remain editable and are marked “AI-estimated from meal
details.” Saving uses `entry_source="manual"` with `is_estimate=true`; manual
describes how the entry was supplied, not measured accuracy. Changing the
estimation basis preserves nutrition and marks it for review rather than
rescaling or calling Gemini automatically. Cancellation, timeout, stale
responses, and clarification preserve current input.

| Status | Codes |
| --- | --- |
| 400 | MALFORMED_JSON |
| 413 | REQUEST_TOO_LARGE |
| 415 | UNSUPPORTED_MEDIA_TYPE |
| 422 | VALIDATION_ERROR, AI_ANALYSIS_REFUSED |
| 429 | AI_RATE_LIMITED, AI_BUSY |
| 500 | INTERNAL_ERROR |
| 502 | AI_INVALID_OUTPUT |
| 503 | AI_CONFIGURATION_ERROR, AI_PROVIDERS_UNAVAILABLE, DATABASE_TIMEOUT, DATABASE_UNAVAILABLE |

## Image extraction API

POST /api/v1/nutrition/extract accepts multipart/form-data with exactly one
nonempty file field named image and one text field named image_type. The mode
must be nutrition_label or food_plate; query parameters, duplicate or unknown
fields, and extra files are rejected.

Declared JPEG, PNG, and WebP are accepted. The image itself may be at most
10,000,000 bytes, inclusive; multipart overhead is not included. Actual decoded
content must match the declared MIME. Corrupt, truncated, animated/multi-frame,
or over-25,000,000-pixel inputs are rejected. Accepted input is auto-oriented,
flattened on white, fitted within 3072×3072 without enlargement, and normalized
to JPEG quality 90 with a 10,000,000-byte output cap.

Example:

```bash
curl -i http://localhost:3000/api/v1/nutrition/extract \
  -F image_type=nutrition_label \
  -F 'image=@synthetic-label.png;type=image/png'
```

A successful label response is an editable draft, for example:

```json
{
  "data": {
    "provider": "gemini",
    "image_type": "nutrition_label",
    "is_estimate": false,
    "source_basis": "one 100 g serving",
    "assumptions": [],
    "draft": {
      "food_name": "Synthetic example",
      "meal_type": null,
      "consumption_date": "2026-09-12",
      "consumed_quantity": 100,
      "quantity_unit": "g",
      "calories_kcal": 250,
      "protein_g": 10,
      "carbs_g": 30,
      "fat_g": 8,
      "micronutrients": {
        "sodium_mg": 400,
        "calcium_mg": null,
        "iron_mg": null,
        "potassium_mg": null,
        "vitamin_c_mg": null,
        "vitamin_d_mcg": null
      },
      "entry_source": "nutrition_label",
      "is_estimate": false
    },
    "missing_fields": ["meal_type"]
  }
}
```

The provider may leave unsupported facts as null. Known zero remains zero.
missing_fields deterministically lists only values still required by the
ordinary meal-write contract. consumption_date, source, estimate status, and
provider identity are server-owned — consumption_date defaults to the current
date in the persisted profile timezone and remains editable before save. A
plate returns one whole-plate estimate with explicit assumptions rather than
component records. A label uses one coherent quantity column: values stated
per 100 g remain the totals for that 100 g basis, are not multiplied again,
and percent Daily Value is never treated as a nutrient amount.

Extraction is read-only. It performs no meal insert/update, stores no image
locally, and uses no provider file API. To persist a reviewed result, fill every
missing required field and send the completed draft to POST /api/v1/meals.
Provider store=false makes these requests stateless at the API level but is not
a blanket promise about provider retention policies.

Gemini is attempted once through the Interactions API with structured JSON and
automatic retries disabled. Gemini is the sole provider; no secondary provider
is configured or attempted. Missing/rejected configuration, explicit content
refusal, valid unreadable/not-food status, caller cancellation, application
defects, availability failures, and invalid output map directly to their bounded
API errors.

Each step of the flow — the Gemini call, image processing, the multipart
upload wait, and the overall post-upload flow — has its own timeout, so a slow
or unresponsive step fails safely instead of hanging indefinitely. The browser
sets its own abort deadline slightly longer than the server's, purely to allow
for normal network delay; it is not a separate, independent limit.

Admission is local to each backend process: image and text AI work share one
two-request concurrency limit and one per-IP budget of 10 AI requests per
10-minute window, with no queue. Rejections return 429 with Retry-After. These
limits do not apply to manual APIs and are not distributed across processes.

## Image-assisted web workflow

Open /meals/from-image directly or choose Log from photo from the dashboard or
meal history. Select Nutrition label or Plate of food, then choose one JPEG,
PNG, or WebP image. The file must be nonempty and no larger than exactly
10,000,000 bytes; selecting it creates only a local preview and does not upload
or save anything.

Analyze image performs one explicit Gemini-backed extraction request. A label
draft preserves its extracted reference quantity and totals. A plate produces
one editable whole-meal estimate. Review the food name, date, meal type, quantity,
core nutrition, all six micronutrients, source basis, assumptions, and locked
source/estimate context in the shared meal form. Unknown values stay blank,
while a known numeric zero stays zero. Changing consumed quantity never rescales
nutrient totals, so totals must be reviewed and edited directly.

Only Save meal calls POST /api/v1/meals, and it remains disabled until the normal
meal contract is valid. Analysis failures retain usable selection/draft context
and always leave Enter manually available. Cancellation, timeouts, stale
responses, dirty-draft replacement confirmation, save errors, and ambiguous
network failures are handled without automatic retries or duplicate writes.
Gemini is the sole image provider; provider credentials remain server-only.

Image extraction errors include:

| Status | Codes |
| --- | --- |
| 400 | MALFORMED_MULTIPART |
| 408 | UPLOAD_TIMEOUT |
| 413 | IMAGE_TOO_LARGE |
| 415 | UNSUPPORTED_MEDIA_TYPE |
| 422 | VALIDATION_ERROR, IMAGE_INVALID, IMAGE_UNREADABLE, IMAGE_NOT_FOOD, IMAGE_ANALYSIS_REFUSED |
| 429 | AI_RATE_LIMITED, AI_BUSY |
| 500 | INTERNAL_ERROR |
| 502 | AI_INVALID_OUTPUT |
| 503 | AI_CONFIGURATION_ERROR, AI_PROVIDERS_UNAVAILABLE |

All use the shared redacted error envelope and server request ID. Upstream bodies,
raw provider output, credentials, SQL, and image buffers are never logged.

The credential-free AI suite is part of the ordinary server test command.
The bounded live transport/no-persistence harness is deliberately separate
because it consumes configured provider calls and touches a temporary owned
database schema:

```bash
cd server
node --env-file=.env --import tsx support/phase9-live-verification.ts
```

The harness creates a unique nutritrack_p9_* schema, verifies the synthetic
label and permitted plate through the real Gemini route, compares table digests,
drops only its owned schema, and closes its pool. It prints the model name,
bounded call count, timings, and observed synthetic values, never keys or raw
payloads.

The meal-basics live transport check is deliberately separate because it makes
one configured Gemini text request. It validates the structured result and
prints only bounded metadata, never credentials or raw provider output:

```bash
cd server
node --env-file=.env --import tsx support/meal-estimate-live-check.ts
```

## Meal API

| Method and path | Success | Purpose |
| --- | --- | --- |
| POST /api/v1/meals | 201 plus Location | Create one complete meal |
| GET /api/v1/meals | 200 | Filter and page meal history |
| GET /api/v1/meals/:id | 200 | Read one meal |
| PUT /api/v1/meals/:id | 200 | Fully replace every writable field |
| DELETE /api/v1/meals/:id | 204 empty | Physically delete one meal |

POST and PUT require Content-Type application/json; charset parameters are
accepted. Their body stream is limited to exactly 65,536 bytes (64 KiB) before
the broader 100,000-byte API parser can consume it. Bodies above that limit
receive 413. Malformed JSON receives 400, an incompatible body media type
receives 415, and schema failures receive 422.

A complete POST or PUT body is:

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

Every shown key is required. Unknown, server-owned, and nested extra keys are
rejected. food_name is trimmed and limited to 200 characters. Supported meal
types are breakfast, lunch, dinner, and snacks. Quantity units are g, ml,
serving, and piece. Entry sources are manual, nutrition_label, and food_plate;
food_plate requires is_estimate true.

Amounts are finite JSON numbers from zero through 1,000,000 with at most four
decimal places; consumed_quantity must be greater than zero. All six
micronutrient keys are required, but their values may be null. Known zero stays
zero and unknown stays null.

Nutrition fields are totals for the entire consumed quantity. A 150 g entry
with 180 kcal stores and contributes 180 kcal. Changing quantity to 300 while
explicitly submitting 180 kcal still stores 180 kcal; the server never rescales
or derives nutrition.

consumption_date is a real YYYY-MM-DD Gregorian date from 1900 through 9999.
POST and PUT reject dates after today in the persisted profile timezone.
Listing may use future bounds. IDs and timestamps are server-owned; DATE values
remain strings and timestamps are returned as UTC ISO strings.

Example:

```bash
curl -i -X POST http://localhost:3000/api/v1/meals \
  -H 'Content-Type: application/json' \
  --data-binary @meal.json
```

PUT is a full replacement, never an upsert. It preserves id and created_at and
sets updated_at. A valid missing UUID returns 404 MEAL_NOT_FOUND; a malformed
UUID returns 422. DELETE is physical, and a repeated delete returns 404.

## Goal API

| Method and path | Success | Purpose |
| --- | --- | --- |
| GET /api/v1/goals | 200 | Read the current singleton goal configuration |
| PUT /api/v1/goals | 200 | Fully replace all five goal values |

GET accepts no query string or request body. PUT requires Content-Type
application/json; charset parameters are accepted. PUT uses the existing shared
100,000-byte API limit measured from the actual request stream. Bodies above
that limit receive 413. Malformed JSON receives 400, incompatible body media
types receive 415, and schema failures receive 422.

Every PUT must provide this complete strict body:

```json
{
  "daily_calories_kcal": 2200,
  "daily_protein_g": 0,
  "daily_carbs_g": 250.5,
  "daily_fat_g": null,
  "target_weight_kg": 72.3456
}
```

Each value may be null. When set, calories and target weight must be greater
than zero; macro targets may be zero. All numbers must be finite JSON numbers
no greater than 1,000,000 with at most four decimal places. Numeric strings,
omitted keys, unknown keys, partial updates, and server-owned fields are
rejected. Zero remains a configured macro target while null remains unset.

The response is data containing those five fields plus updated_at as a UTC ISO
timestamp. The API never exposes id or created_at. PUT performs one
parameterized UPDATE of id 1, preserves created_at, updates updated_at, and is
never an insert or upsert. The migrated singleton makes the first setting and
every later replacement the same operation. An all-null replacement clears all
targets. POST, PATCH, DELETE, goal history, ownership fields, and weight
measurements are not supported. A missing singleton fails safely with the
generic 500 contract instead of recreating data.

Example:

```bash
curl -i -X PUT http://localhost:3000/api/v1/goals \
  -H 'Content-Type: application/json' \
  --data-binary @goals.json
```

## Filtering and pagination

GET /api/v1/meals accepts only:

- start_date: optional inclusive YYYY-MM-DD lower bound.
- end_date: optional inclusive YYYY-MM-DD upper bound.
- meal_type: optional supported category.
- page: default 1, maximum 2,147,483,647.
- page_size: default 20, range 1 through 100.

A single date bound may be supplied alone. When both are supplied, start_date
must not follow end_date. Future bounds are valid. Repeated, unknown, blank,
signed, fractional, or exponential query values are rejected. Numeric strings
with leading zeroes (for example, "007") are accepted and normalized to their
integer value.

Filters apply before both count and page reads. Results are ordered by
consumption_date descending, then created_at descending, then id descending.
Count and page queries run on one checked-out client in a short REPEATABLE READ
READ ONLY transaction.

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

A page beyond the end remains a 200 with empty items and the true filtered
total_items and total_pages. An empty match has total_pages zero.

## Nutrition report API

GET /api/v1/reports/nutrition accepts no request body. Its only query
parameters are:

- start_date and end_date: an optional pair of inclusive YYYY-MM-DD dates.
  Supplying neither resolves the current Monday-through-Sunday week from one
  captured clock instant and the persisted profile timezone.
- group_by: day (default) or week.
- page: calendar-bucket page, default 1.
- page_size: calendar buckets per page, default 20 and maximum 100.

Explicit ranges may include future dates but must contain at most 366 inclusive
calendar dates. Reversed, invalid, unpaired, repeated, unknown, blank, signed,
fractional, and exponential values are rejected; meal_type is deliberately not
a report filter. A 366-day leap-year range such as 2024-01-01 through
2024-12-31 is valid, while ending 2025-01-01 is 367 days and is rejected. The
meal-history endpoint keeps its independent, uncapped date-range behavior.

The response is not wrapped in data:

```json
{
  "range": {
    "start_date": "2026-09-07",
    "end_date": "2026-09-13",
    "group_by": "day",
    "timezone": "Asia/Kolkata",
    "today": "2026-09-12"
  },
  "summary": {
    "entry_count": 25,
    "logged_day_count": 1,
    "calories_kcal": 250,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "micronutrients": {
      "sodium_mg": {
        "unit": "mg",
        "known_total": 120,
        "known_count": 3,
        "unknown_count": 1,
        "entry_count": 4
      }
    }
  },
  "goal_snapshot": {
    "daily_calories_kcal": 2000,
    "daily_protein_g": 0,
    "daily_carbs_g": null,
    "daily_fat_g": 70,
    "target_weight_kg": 75,
    "updated_at": "2026-09-12T00:00:00.000Z"
  },
  "goal_comparison": {
    "basis": "current_daily_targets",
    "scope_start": "2026-09-07",
    "scope_end": "2026-09-12",
    "day_count": 6,
    "calories_kcal": {
      "actual": 250,
      "target": 12000,
      "difference": -11750,
      "percent": 2.08
    }
  },
  "items": [],
  "pagination": {
    "page": 99,
    "page_size": 20,
    "total_items": 7,
    "total_pages": 1
  }
}
```

The real response includes all four core nutrients in each comparison and all
six micronutrients in each summary. Core totals are zero for empty ranges.
Micronutrients report units and coverage: an all-unknown total is null, while a
known total of zero is 0. Day and week items flatten the same summary fields and
also provide period_start, period_end, covered_start, covered_end,
calendar_day_count, elapsed_day_count, temporal_state, and goal_comparison.
Weekly period labels remain canonical Monday/Sunday dates; covered dates are
clipped to the requested range.

The root summary and comparison always cover the complete selected range,
regardless of grouping or page. Empty calendar buckets are created before
pagination in ascending order. Therefore an out-of-range page has empty items
but unchanged full-range summary, comparison, and true bucket totals.

Comparisons use the currently persisted daily targets across elapsed selected
dates through today, including unlogged dates; they are not historical goal
snapshots. Future-only scopes have actual zero and null targets. An unset target
stays null. A configured zero macro target returns target zero and the actual
difference, but percent remains null. Percentages are rounded to two decimal
places and are not clamped. target_weight_kg appears only in goal_snapshot.

One short REPEATABLE READ READ ONLY transaction uses one checked-out client for
profile, current goals, and a bounded per-day PostgreSQL aggregate. Stored
consumed totals are summed once. PostgreSQL NUMERIC strings are combined with
exact decimal arithmetic before finite JSON numbers are serialized; no
per-meal output cap is applied to valid aggregate totals.

Example:

```bash
curl 'http://localhost:3000/api/v1/reports/nutrition?start_date=2026-09-10&end_date=2026-09-15&group_by=week&page=1&page_size=20'
```

## Manual web workflows

The client routes are:

- / for the API-backed current-week dashboard.
- /meals for URL-backed filters and pagination.
- /meals/new for complete manual meal creation and optional explicit
  meal-basics estimation.
- /meals/from-image for explicit image analysis and editable meal prefill.
- /meals/:id/edit for complete meal replacement.
- /goals for current goal retrieval and full replacement.
- /reports for URL-backed date/grouping controls and chart-bucket pagination.

The shared meal form sends every writable field explicitly. Blank micronutrients
become null, while typed zero remains zero. Nutrition numbers are always consumed
totals and are not rescaled when quantity changes. The backend profile supplies
the authoritative current date and profile timezone context.

Meal filters and page state are encoded in the URL. Empty and out-of-range
results, loading, API errors, retry actions, deletion confirmation, and frontend
404s have explicit UI states. Older list responses cannot overwrite a newer
request. Mutations are never retried automatically; when transport failure makes
a save ambiguous, the UI tells the user to inspect persisted history before
submitting again.

Goal saves are complete PUT replacements. Clearing all fields and saving sends
five null values; a visible macro zero remains a configured zero target.

The dashboard and reports page use only the root nutrition-report response.
Calorie trends and macro grams use Recharts with exact table disclosures;
micronutrients show unit-aware known totals and entry coverage; goal comparisons
show the current-target scope and do not invent weight progress. Empty diary
days, future days, known zero, and unknown micronutrients remain visibly
distinct. Report URLs accept paired start_date/end_date values, group_by=day or
week, page, and page_size up to 100. Invalid/duplicate/unknown parameters remain
visible with a reset action and are not sent to the API. Bucket pages never
change the full-range totals, micronutrients, or goal comparison panels.

## Error responses

All errors include the server-generated request ID also returned in the
X-Request-ID header:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please correct the highlighted fields.",
    "details": [
      {
        "field": "consumption_date",
        "message": "Consumption date cannot be after today."
      }
    ],
    "request_id": "server-generated-uuid"
  }
}
```

Stable statuses include malformed JSON 400, missing meal/route 404, oversized
JSON 413, unsupported mutation media type 415, validation 422, narrowly known
database timeout/unavailability 503, and redacted unexpected failures 500.

## Test isolation and quality checks

Credential-free tests never connect to PostgreSQL:

```bash
npm --prefix server run typecheck
npm --prefix server run lint
npm --prefix server test
npm --prefix server run build
```

Real database tests deliberately reuse the user-selected server/.env connection;
no .env.test or second credential set is required:

```bash
npm --prefix server run test:db
```

The test loader parses that exact file so inherited shell values cannot redirect
the target. Every run creates cryptographically unique, strictly validated
nutritrack_test_* schemas and records ownership only after successful creation.
Every test/migration/server connection sets and verifies an exact search_path
containing only its owned schema and excluding `public` and `$user`.

Fixtures, including live POST/PUT/DELETE probes, never enter the ordinary
application diary. The harness compares application-table snapshots, stops
owned servers, releases clients, drops only its recorded schemas, and closes
pools even if cleanup reports an error.

The full repository checks are:

```bash
npm --prefix server run typecheck
npm --prefix server run lint
npm --prefix server test
npm --prefix server run build
npm --prefix server run test:db
npm --prefix client run typecheck
npm --prefix client run lint
npm --prefix client test
npm --prefix client run build
git diff --check
```

## Production frontend

Build and preview the static frontend:

```bash
npm --prefix client run build
npm --prefix client run preview
```

Preview uses http://localhost:4173 with strict-port behavior. Build-time
VITE_API_BASE_URL must identify the backend used by that preview. Development
and production-preview workflows were both verified in an actual browser.

For the Vercel client, client/vercel.json proxies /api to the Render backend
and preserves SPA route refreshes. Production builds always use /api/v1;
remove any previous absolute VITE_API_BASE_URL value from Vercel.
Deploy the current backend before the client so /api/v1/auth routes exist.
Render CLIENT_ORIGIN must exactly equal the production Vercel origin. This
same-origin browser path avoids third-party-cookie restrictions while retaining
the backend's exact Origin check and secure HttpOnly session cookie.

## Implemented feature set

- Strict startup configuration, request IDs, Helmet/CORS, safe errors, and
  reusable request validation.
- Calendar-date and IANA-timezone helpers.
- Verified-CA shared PostgreSQL pool, DATE text parsing, bounded timeouts,
  atomic migrations, and transaction helpers.
- JWT signup/login/logout/current-session flows with salted scrypt passwords,
  hashed server session records, expiry/revocation, CSRF origin checks, and
  bounded authentication attempts.
- Per-user profile/goals and private user-owned meals with ownership indexes.
- Authenticated profile read and display-name update API with immediate header refresh.
- Complete meal create/read/list/full-update/delete APIs.
- Read and atomic full-replacement goal APIs scoped to the session owner.
- Strict nullable goal validation with positive calories/weight, nonnegative
  macros, four-decimal precision, and explicit null/zero preservation.
- Strict writable meal, UUID, date, provenance, precision, and query contracts.
- Consumed-total nutrition with explicit null/zero response mapping.
- Inclusive meal filters and deterministic backend pagination from one database
  snapshot.
- Meal-specific byte-accurate 64 KiB JSON mutation limit.
- Goal replacements use the shared byte-accurate 100,000-byte JSON limit.
- Strict nutrition-report query validation with paired ranges, a 366-day cap,
  day/week grouping, and calendar-bucket pagination.
- Full-range core totals, micronutrient known/unknown coverage, clipped empty
  buckets, current-goal comparisons, and exact decimal aggregation.
- Per-user repeatable-read report snapshots across profile, goals, and meals.
- Credential-free and owned-schema real-database regression suites.
- API-backed current-week dashboard and dedicated nutrition reports route.
- Recharts calorie and macro visualizations with keyboard-accessible exact-data
  tables and responsive non-zero chart containers.
- Unit-aware micronutrient coverage plus null/zero/no-entry distinctions.
- Current-goal comparisons scoped to elapsed selected dates, including explicit
  zero/unset targets and target-weight disclaimer.
- Strict URL-backed report dates, grouping, page size, pagination, reset/week
  navigation, stale-request protection, retry, refresh, and empty-page recovery.
- Responsive React routes for home, history, meal creation/editing, goals, and
  frontend not-found handling.
- Central browser API client with normalized backend errors and request IDs.
- React Hook Form plus Zod forms that preserve null, zero, precision, provenance,
  and complete-replacement semantics.
- URL-backed filtering/pagination with stale-request protection.
- Explicit loading, empty, out-of-range, error, retry, success, confirmation,
  rapid-submit, and ambiguous-failure behavior.

- Validated multipart nutrition-label and whole-plate extraction endpoint.
- Strict provider and final-response schemas with explicit null/zero semantics.
- Sharp worker-boundary decoding, format/pixel/frame checks, orientation,
  transparency flattening, fit, JPEG normalization, deadlines, and cancellation.
- Stateless Gemini Interactions structured output as the sole provider, with
  no hidden retries.
- Bounded provider output, upload waiting, overall extraction time, per-IP rate,
  and per-process concurrency with exact cleanup and shutdown cancellation.
- Editable, server-owned draft metadata and deterministic missing fields with no
  extraction persistence.
- Explicit nutrition-label and plate image selection with validated local
  preview, exact client size/type checks, and object-URL cleanup.
- Gemini-only multipart extraction through the central client with a bounded
  client-side abort deadline (set slightly longer than the server-side cap to
  allow for network delay), explicit user-triggered retry (never automatic),
  cancellation, and stale-response protection.
- Shared MealForm editable prefill with null/zero preservation, live missing-field
  guidance, locked provenance, dirty-draft confirmation, and no auto-rescaling.
- Explicit ordinary meal persistence only after review, with failed-save draft
  retention, duplicate-submit protection, history navigation, and report updates.
- Strict meal-basics estimation request/provider/result schemas using one
  Gemini text request with no image fabrication, external tools, or automatic
  retry.
- Explicit Estimate/Re-estimate and Cancel controls in the shared meal form,
  editable null/zero-preserving prefill, clarification/assumption display,
  stale-response and pending-edit protection, changed-basis review, and no
  persistence before the ordinary explicit Save meal action.

## Documentation and scope

Gemini is the only AI provider used by NutriTrack.

The application includes no automatic AI save, OCR service, image persistence,
password reset, email verification, social login, account deletion,
administrative dashboard, chat, PDF import, export/reminders, schema reset,
goal history, or weight history. SMTP welcome messages do not verify ownership.
