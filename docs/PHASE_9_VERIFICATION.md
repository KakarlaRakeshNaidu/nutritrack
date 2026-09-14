# Phase 9 Verification

Date: 2026-09-14

Status: PHASE 9 FAILED because the required real xAI Grok fallback check is
blocked by configuration. The implementation, credential-free gates, compiled
runtime smoke, two Gemini live checks, and no-persistence checks pass.

## Scope and requirements covered

Phase 9 adds POST /api/v1/nutrition/extract as a backend-only workflow. It:

- accepts exactly one image and one image_type multipart field;
- enforces exact upload counts, field bounds, media types, a 10,000,000-byte
  inclusive image limit, a 15-second upload deadline, per-IP rate limiting, and
  two active requests per process with no queue;
- decodes JPEG, PNG, or WebP through a cancellable worker boundary, validates
  decoded type/frame/pixel constraints, applies orientation, flattens
  transparency, fits within 3072 by 3072, and emits bounded quality-90 JPEG;
- asks Gemini once for structured JSON and permits one xAI Grok attempt only for
  an availability or output-invalid primary failure;
- validates unknown provider values through a strict Zod boundary and validates
  the final editable result separately;
- derives date, source, estimate status, provider, and missing fields on the
  server; and
- performs no meal mutation, provider file upload, image persistence, public
  upload, OCR, or frontend work.

Covered requirements include FR-012, FR-013, the backend part of FR-014, FR-017,
and the applicable validation, security, cancellation, and resource bounds.

## Main modules

- server/src/modules/nutrition/nutrition.routes.ts: route-local Multer parsing,
  upload deadline, rate/concurrency admission, caller and shutdown cancellation,
  request validation, and safe error mapping.
- server/src/modules/nutrition/image-processing.ts and image-worker.ts:
  request-owned worker lifecycle plus strict Sharp processing.
- server/src/modules/nutrition/nutrition.schemas.ts: provider JSON Schema, strict
  local Zod validation, editable draft response, and missing-field derivation.
- server/src/modules/nutrition/provider-common.ts: bounded one-pass JSON parsing,
  prompt rules, reference-quantity semantics, and narrow network recognition.
- server/src/modules/nutrition/gemini.adapter.ts: @google/genai Interactions
  structured output, inline normalized JPEG, stateless settings, abort signal,
  and automatic retries disabled.
- server/src/modules/nutrition/grok.adapter.ts: native xAI Responses fetch,
  data-URL JPEG, text.format JSON Schema, bounded body/output reading,
  stateless/no-tools settings, and abort signal.
- server/src/modules/nutrition/nutrition.service.ts: primary/fallback
  orchestration, 25-second attempt budgets, remaining 55-second overall budget,
  terminal failure precedence, and post-analysis profile date read.
- server/src/app.ts and server/src/server.ts: route composition and active
  extraction cancellation during normal shutdown.

## Exact direct dependency additions

- @google/genai 2.22.0
- express-rate-limit 8.7.0
- multer 2.3.0
- sharp 0.35.4
- @types/multer 2.2.0 as a development dependency

The package manager updated server/package-lock.json. npm ci installed 280
packages, audited 281, and reported zero vulnerabilities.

## Fresh verification

The following checks ran in Ubuntu-24.04-Verify with Node 24.16.0 and npm
11.13.0:

| Check | Result |
| --- | --- |
| npm ci | Passed; reproducible lockfile install, 0 vulnerabilities |
| npm run lint | Passed |
| npm run typecheck | Passed with strict TypeScript |
| focused Phase 9 files | Passed; 35 tests after final socket cases |
| npm test | Passed; 161 credential-free server tests after final rerun |
| npm run build | Passed; fresh server/dist emitted |
| Sharp runtime | sharp 0.35.4, libvips 8.18.6, timeout method available |
| compiled endpoint smoke | Passed; compiled worker accepted PNG, normalized it, then returned expected safe 503 with Gemini disabled for that process |
| git diff --check | Passed after final review |

The compiled smoke started server/dist/server.js on an owned port, posted the
permitted PNG through the actual multipart and compiled worker path, observed
503 AI_CONFIGURATION_ERROR as expected without making a provider call, sent
SIGINT, completed lifecycle cleanup, and confirmed the port was closed.

## Credential-free test evidence

Focused synthetic and injected tests cover:

- missing, empty, duplicate, unknown, extra, malformed, bad-query, bad-mode, and
  bad-media multipart requests;
- exact 10,000,000 and 10,000,001 image byte boundaries;
- JPEG, PNG, and WebP normalization; MIME spoofing; corrupt/truncated bytes;
  animation; 25-million-pixel decode limit; orientation; alpha flattening;
  resize; native/outer processing deadlines; and worker termination;
- strict provider/final schemas, numeric precision, unknown keys, null versus
  known zero, source/date ownership, assumptions, and missing fields;
- exact Gemini Interactions and xAI Responses request/envelope fixtures,
  stateless flags, no tools, retry disablement, refusal/incomplete handling,
  response bounds, status classification, and real AbortSignal propagation;
- primary success, the two eligible primary failure classes, terminal content,
  configuration and application errors, absent fallback, both-invalid and
  mixed-invalid/unavailable precedence, attempt/overall budgets, and caller
  cancellation without late fallback;
- maximum two active requests, a rejected third request, subsequent reuse,
  ten-per-ten-minute rate limit, Retry-After, malformed-upload cleanup,
  stalled-upload 408 cleanup, caller disconnect, server-shutdown cancellation,
  and slot release; and
- safe extraction failure without AI configuration while the existing profile
  API remains usable and the existing 65,536/100,000-byte JSON limits continue
  to pass in the full suite.

Both provider adapters receive the same request-scoped normalized JPEG in the
orchestration fixtures. Provider text is parsed once with no repair call,
Markdown stripping, eval, or schema coercion.

## Provider transport decisions

Implementation was checked against the installed @google/genai 2.22.0 types and
current official Gemini Interactions/image/structured-output documentation.
Gemini sends inline image bytes with MIME image/jpeg, response_format structured
JSON, store false, background false, stream false, no tools, one AbortSignal,
and explicit no-retry options. It reads output_text, checks explicit
safety/content codes and incomplete states, and bounds text at 65,536 bytes.

The xAI adapter follows the Responses API rather than Chat Completions. It posts
to https://api.x.ai/v1/responses with input_image, a normalized JPEG data URL,
input_text, text.format json_schema with strict true, store false, background
false, an empty tools array, and 2,000 maximum output tokens. It bounds the full
response body to 131,072 bytes before JSON parsing and the extracted text to
65,536 bytes. It handles refusal/incomplete envelopes explicitly.

Provider 429/5xx and recognized connection causes are availability failures.
401/403/404 are configuration failures. Developer request 400 and unexpected
TypeError paths are application defects, not fallback triggers. Caller abort is
distinguished from the provider deadline before fallback selection.

## Live checks

The bounded live harness used server/.env without printing or modifying keys.
It generated a readable synthetic label in memory and used the permitted
workspace plate fixture at
server/support/fixtures/phase9-live-plate.png.

Observed outbound call counts:

- Gemini: 2
- xAI Grok: 0

Gemini model: gemini-3.6-flash.

Synthetic label through the real route:

- HTTP 200 in 7,293 ms;
- quantity 100 g;
- 250 kcal;
- protein 10 g;
- carbohydrate 30 g;
- fat 8 g; and
- is_estimate false.

All six asserted quantity/core values exactly matched the synthetic label and
the response passed the final extraction Zod schema.

Permitted plate through the real route:

- HTTP 200 in 12,052 ms;
- provider Gemini;
- is_estimate true;
- entry_source food_plate; and
- three bounded assumptions.

This verifies an editable estimate, not nutritional ground truth. Photo-based
portions and nutrient values remain uncertain and require user review.

The required controlled real Grok fallback could not run. The selected .env
contains GROQ_API_KEY and GROQ_MODEL, which configure the separate Groq service.
It does not contain the required xAI XAI_API_KEY and GROK_MODEL pair, so the
application correctly reports Grok as disabled. The harness stopped repeated
attempts and made no xAI request. No credential was printed, copied, renamed, or
used with the wrong provider.

## No-persistence and cleanup evidence

The live harness:

1. loaded the selected server/.env directly;
2. opened the verified-CA database connection;
3. digested public tracker_profile, goals, meals, and schema_migrations data;
4. created one cryptographically unique, validated nutritrack_p9_* schema;
5. applied migrations only within that owned schema;
6. digested its profile, goals, meals, and migration rows;
7. compared the isolated digest after label success, plate success, invalid
   image failure, and the available fallback gate;
8. compared the ordinary public digest before cleanup;
9. dropped only the owned schema; and
10. compared public data again and closed the pool.

Every comparison passed. No ordinary meal, goal, profile, or migration row
changed. The temporary schema and every owned HTTP process/port were removed.

## Carried-forward Phase 8 evidence

The following Phase 8 evidence is carried forward, not freshly rerun:

- 44 client tests;
- 18 isolated database-suite tests;
- development and production-preview browser workflows at desktop and narrow
  widths; and
- compiled production-preview integration.

Phase 9 changes only backend dependencies/source/tests/docs and adds no frontend
code. The established database schema/repositories/migrations are unchanged.
The narrower fresh Phase 9 owned-schema harness directly reverified database
connectivity, migrations, data digests, and no persistence, so replaying the
full unchanged database suite or diary browser suite would repeat unaffected
evidence.

## Problems found and fixed

- Multer/Busboy signals the configured file-size sentinel at the limit; the
  parser now allows one bounded sentinel byte and applies the exact inclusive
  application check.
- Worker threads inherited Node test-runner execution arguments; TypeScript
  workers now receive only the required tsx loader and compiled workers receive
  no development loader arguments.
- The first animation fixture was not actually multi-frame; it was replaced by
  a verified two-frame WebP.
- A Supertest concurrency request had not been explicitly started and could
  hang; all concurrent probes now start deterministically.
- Shutdown cancellation initially risked leaving a connected response open; it
  now maps owned server-shutdown cancellation to a safe 503 before releasing the
  slot.
- The upload timer initially destroyed the socket before its 408 mapping could
  be observed; it now detaches/drains the parser, sends a Connection-close 408,
  destroys after response finish, and proves slot reuse.
- Caller-disconnect testing now owns and closes its HTTP server explicitly, so
  no test handle remains open.

No API schema, database migration, frontend, public force-provider flag, provider
model substitution, credential file, commit, or deployment was added.

## Repository state and remaining gate

- Branch: main
- HEAD: 285a822
- Remote: existing origin remains configured
- Worktree: intentionally uncommitted changes from Phases 3 through 9 and the
  TypeScript migration remain present
- Branch created: no
- Commit created: no
- Push performed: no

Remaining completion gate: configure a real xAI XAI_API_KEY plus GROK_MODEL pair
in server/.env, then rerun the bounded live harness once. Do not rename or reuse
the existing GROQ key. If that single live fallback returns a valid result and
the existing digest/cleanup assertions pass, update this report with the model,
one-call timing, and PHASE 9 PASSED.

PHASE 9 FAILED
