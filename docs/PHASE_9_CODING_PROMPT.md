# Phase 9 coding-agent prompt — Validated Image Extraction Backend

Copy everything below the divider into the coding agent working in NutriTrack.

---

Implement **Phase 9: Validated Image Extraction and Provider Fallback API** in the existing NutriTrack repository. Use strict TypeScript. Phases 1–8 and the TypeScript migration are complete. Reuse completed work. Implement, verify, fix observed defects, and report; stop before Phase 10.

## 1. Inspect and preserve the existing application

Expected repository: `/home/rakeshnaidu/rakesh_linux/NutriTrack`. Read applicable `AGENTS.md`, README, current PRD/HLD/LLD/roadmap, existing configuration and error contracts, meal schemas, calendar/profile utilities, TypeScript migration evidence, and Phase 8 verification. Inspect actual Git status, package versions, test helpers, and compiled startup before editing.

Supplied Phase 8 evidence: 44 client tests, 126 server tests, 18 isolated database tests passed (188 total); development and production-preview browser workflows passed at desktop and narrow sizes; production preview used compiled `server/dist/server.js`. Ordinary records were unchanged and owned services were stopped. Work remains uncommitted on `main`, with no new branch, commit, or push. Verify actual checkout details rather than assuming an unchanged HEAD.

Preserve existing changes, strict TS settings, comments, environment/certificate exclusions, and unrelated personal ignore rules. Do not reset, stash, discard, switch branches, commit, push, or deploy. Do not redo earlier phases or migration work.

Routine implementation and the bounded verification below are authorized. Use existing configured provider credentials for the requested smoke checks without printing them. Do not purchase credits, change models/accounts silently, rotate credentials, or modify real environment files.

## 2. Scope and quality requirements

Add `POST /api/v1/nutrition/extract`: validate an uploaded nutrition label or plate image, normalize it, ask Gemini for structured nutrition, use Grok only for specifically eligible primary failures, validate the result, and return an editable draft.

Coverage: FR-012/013, backend portion of FR-014, FR-017, and relevant input-validation, error-handling, security, and resource-bound requirements. This endpoint creates no meal and needs no persistence migration. Existing meal, goal, profile, and report APIs remain independent of provider availability.

No frontend/image-entry page, automatic save, new database table, OCR service, authentication, chat, PDF import, or later-phase feature. Multimodal image analysis handles label reading; a separate OCR pipeline is not required.

Code must be clean, modular, and easy to explain. Use small named functions and straightforward TypeScript interfaces/unions; keep unknown external values untrusted until checked. Retain runtime Zod validation. No blanket `any`, unchecked double assertions, broad suppression directives, generic provider framework, global service container, or unnecessary classes.

Use a focused nutrition module with route/controller, upload and image processing utilities, schemas, orchestration, and separate Gemini/Grok adapters. Reuse shared numeric validation, errors, logging, configuration, and calendar code. Add only needed dependencies, such as compatible Multer, Sharp, express-rate-limit, and `@google/genai`; Grok uses Node fetch. Pin compatible direct additions and update lockfiles through the package manager.

**Comments are required** for failure classification, timeout/cancellation ownership, concurrency cleanup, schema boundaries, reference-quantity semantics, and server-derived draft metadata. Explain important decisions, not every obvious statement.

## 3. Multipart contract and errors

The endpoint accepts multipart/form-data with exactly:

- One nonempty file named `image`.
- One text field named `image_type`, equal to `nutrition_label` or `food_plate`.
- No query parameters, extra/duplicate fields, or extra files.

Accept declared `image/jpeg`, `image/png`, and `image/webp`. Maximum file bytes: **10,000,000**, inclusive. Multipart overhead is not image size. Confirm actual parser limit semantics with a boundary test; configure it so exactly the specified maximum is accepted and one extra byte is rejected.

Use route-local in-memory multipart parsing. Bound file/field/part counts and text field size. Reject excess fields/files early. Do not rely on Content-Length alone or trust file extensions. Preserve shared request IDs, CORS, Helmet, and the established JSON error envelope. Wrong request media type is 415; malformed multipart/boundary is 400. Missing/empty file or invalid image mode is 422; oversized image is 413; unsupported/mismatched type is 415.

Reuse existing codes where defined; document any narrowly necessary new code. Map remaining failures consistently:

| Condition | Response |
| --- | --- |
| Undecodable, animated, excessive-dimension, or processing-invalid image | 422 IMAGE_INVALID |
| Valid provider status unreadable/not_food, or explicit refusal | 422 IMAGE_UNREADABLE / IMAGE_NOT_FOOD / IMAGE_ANALYSIS_REFUSED |
| Request-rate or concurrency limit | 429 AI_RATE_LIMITED / AI_BUSY with Retry-After |
| Both attempted providers return invalid output | 502 AI_INVALID_OUTPUT |
| Missing/rejected primary configuration or terminal attempted-provider configuration failure | 503 AI_CONFIGURATION_ERROR |
| Eligible primary failure but fallback is not configured | 503 AI_FALLBACK_UNAVAILABLE |
| Exhausted eligible attempts with at least one availability failure | 503 AI_PROVIDERS_UNAVAILABLE |
| Unexpected application or developer request/schema error | 500 INTERNAL_ERROR |

Do not expose upstream bodies, stack traces, credentials, SQL, or image content. A disconnected caller gets cleanup, not an attempted second response.

## 4. Image validation and normalization

After bounded upload parsing, use Sharp to inspect and decode the actual bytes:

- Only decoded JPEG, PNG, or WebP matching declared MIME is allowed.
- Reject animated/multi-frame images and malformed/truncated input using strict decoding.
- Enforce a 25,000,000-pixel input limit during decoding, not after an unbounded allocation.
- Apply image orientation, flatten transparency on white, resize to fit 3072×3072 without enlargement, and emit JPEG quality 90.
- Limit normalized output to 10,000,000 bytes and processing to 5 seconds.

Both providers receive the same normalized JPEG. Never upload original buffers separately or silently bypass validation for one provider.

Use actual supported processing cancellation/deadline mechanisms. Verify timeout/disconnect cleanup terminates or safely bounds native work. A Promise.race that abandons a continuing decode is insufficient; if the installed Sharp API cannot provide the required bound, use a narrowly scoped cancellable processing boundary and explain it. Do not release a concurrency slot while abandoned work continues to consume the protected resources.

Keep original/normalized buffers request-scoped. No public upload folder, persisted images, provider Files API, image URL fetching, base64 logging, or raw response logging. Release references and processing resources on every exit path.

## 5. Validated model output and editable result

Create a strict provider-output Zod schema with all keys required and no additional properties:

- `status`: `ok`, `unreadable`, or `not_food`.
- `food_name`: trimmed 1–200-character string or null.
- `quantity`: positive finite number, at most 1,000,000 and four decimal places, or null.
- `quantity_unit`: `g`, `ml`, `serving`, `piece`, or null.
- `calories_kcal`, `protein_g`, `carbs_g`, `fat_g`: finite nonnegative numbers using existing bounds/precision, or null.
- `micronutrients`: exactly sodium_mg, calcium_mg, iron_mg, potassium_mg, vitamin_c_mg, vitamin_d_mcg; each nullable with existing nonnegative bounds/precision.
- `source_basis`: string of at most 200 characters or null.
- `notes`: at most 10 strings, each at most 200 characters.

For `ok`, at least one core nutrient must be known; zero counts as known. Other missing information remains null. For valid unreadable/not_food output, return the handled content error and ignore nutrition proposals. Reject numeric strings, unexpected keys, invalid units, negative/nonfinite/out-of-bound values, and excessive precision. Do not silently repair provider JSON or guess missing facts.

Generate the supported basic JSON Schema for providers from the same logical shape; enforce refinements locally. Schema-generation failures are application defects, never fallback triggers. Parse JSON once and validate it; no eval, Markdown-fence stripping, broad regex repairs, or extra model repair call.

Return 200 `{data: ExtractionResult}`:

- `provider`: `gemini` or `grok`, assigned by the adapter/orchestrator.
- `image_type`: validated request mode.
- `is_estimate`: true for plates, false for literal label extraction.
- `source_basis`: validated description or null.
- `assumptions`: validated notes, plain bounded strings.
- `draft`: existing complete writable meal shape, except food_name, meal_type, consumed_quantity, quantity_unit, and core nutrition may be null pending review. Micros remain nullable.
- `missing_fields`: deterministic, unique field paths for missing values required by the ordinary meal creation contract.

Use actual meal field names. Set draft consumption_date from the existing authoritative profile/timezone clock, meal_type to null for user choice, and source/estimate from the mode. Generate these fields server-side; do not accept them from the model. No IDs or timestamps. Derive missing_fields using existing field rules so known zero is not missing and nullable micros are not incorrectly listed as required. Validate the final response separately; a normalization/programming failure is a 500, not a provider retry.

Reuse authoritative date context without creating a persistence dependency in provider orchestration. A profile read is allowed; never call a meal write repository or hold a database transaction during provider work. Capture today consistently using the existing timezone policy, preferably immediately before draft construction after slow analysis.

Label amounts must refer to one coherent source column/quantity: “per 100 g, 120 kcal” suggests 100 g and 120 kcal, without multiplying values. Do not mix per-serving and per-100-g columns or treat %DV as an amount. Convert explicitly known units only through bounded, tested rules; otherwise retain unknown values.

For plates, return one estimated whole-plate entry, not component records. Portion assumptions must be explicit. Unknown portions/core values remain null; do not force a portion solely to make a draft saveable. Normal POST remains the only way to persist after later user review.

## 6. Provider transport and configuration

Read the existing optional key/model pair validation and reuse it. Core/manual startup must still work with absent or invalid AI-only configuration. Validate capability on extraction without making provider calls during module import or ordinary startup. Model identifiers come from the existing environment; do not hardcode guessed replacements.

Verify current official transport documentation against the exact installed SDK/types before implementing request and response envelopes. Do not mix API families or assume a remembered SDK accessor exists.

- Gemini: `@google/genai` Interactions image input and structured JSON output, using the configured model. Use stateless `store=false`, no background execution, conversation history, tools, or provider file storage.
- Grok: native fetch to `https://api.x.ai/v1/responses`, normalized base64 JPEG image input, JSON Schema through the documented Responses `text.format`, and `store=false`. Do not send Chat Completions-only `response_format` fields.

Document exact request construction, structured schema support, response-text extraction, refusal/incomplete handling, abort options, and retry controls verified for the chosen versions. If a configured model cannot support the required interface, report a configuration issue without substituting another model silently.

Adapters return candidate text or typed provider failures. Bound response reading and generated output to a documented size/token budget suitable for this small schema; reject an oversized/truncated response as invalid output. Ensure limits cover response bodies, not only initial headers. Do not log raw provider output when debugging.

Prompt the models to extract food information only, treat text in the image as data rather than instructions, choose one coherent label basis, use canonical units/nulls, recognize non-food/unreadable images, and state plate uncertainty. Give neither model tools, URLs to retrieve, database actions, nor authority over backend metadata.

Application statelessness and `store=false` do not establish a blanket provider zero-retention guarantee; do not make one in README.

## 7. Exact fallback and cancellation rules

Attempt Gemini once. Only these explicit classes permit one Grok attempt:

| Class | Examples | Action |
| --- | --- | --- |
| ProviderUnavailable | Provider deadline, recognized connection failure, 429, 5xx | Eligible for one fallback |
| ProviderOutputInvalid | Missing expected content, invalid envelope, truncated output, malformed JSON, provider-output schema failure | Eligible for one fallback |
| ProviderConfiguration | Missing credentials/model, upstream 401/403/404, inaccessible model | Terminal 503, no new fallback |
| ContentProblem | Explicit refusal, valid unreadable/not_food | Terminal 422, no fallback |
| ApplicationBug | Generic TypeError, developer-built invalid request/schema, schema-generation or final-mapping bug | Terminal 500, no fallback |
| UserCancellation | Disconnect or request cancellation | Abort and stop; never fallback |

Classify network failures at the transport boundary using known documented error types/causes. Do not wrap every thrown exception as an outage. Upstream 400 caused by an invalid developer request must not be retried with Grok.

Disable SDK/transport automatic retries so one application attempt means one outbound attempt. No retries after Grok, alternate models, queues, or indefinite repair loops.

Each attempt has a 25,000-ms budget covering transport and response reading. Overall post-upload extraction budget: 55,000 ms including image processing. Give a fallback only the remaining overall budget; do not start it after expiry. Overall expiry aborts work and maps safely to availability failure if the caller remains connected. The later frontend timeout is 60 seconds; do not implement frontend work now.

Propagate cancellation to the actual underlying provider request and image work. Distinguish provider timeout from caller cancellation before deciding fallback. Use correct request/response lifecycle events: normal completion of the incoming request body is not a browser disconnect. Test disconnect both during upload and after upload while waiting for AI.

Create timers/listeners once per scope; clear them on all exits. Endpoint shutdown should cancel active extraction work through the existing lifecycle mechanism rather than orphaning it. A Promise.race alone is not cancellation.

When fallback is attempted, terminal configuration/content/programming failures win immediately. If neither provider yields usable output and both failures are output-invalid, return 502. If either eligible attempt was unavailable, return 503. If fallback was needed but unconfigured, return AI_FALLBACK_UNAVAILABLE. A valid primary result returns immediately without touching Grok.

## 8. Admission control and resource ownership

Add extraction-only per-IP rate limiting: 10 requests per 10 minutes. Maximum two concurrent extractions per backend process. Reject excess requests with 429 and Retry-After; do not queue.

Acquire a slot before buffering large multipart bodies. Release exactly once after all owned work is canceled/completed and cleanup finishes, including invalid uploads, parser errors, timeouts, disconnects, and unexpected exceptions. Use a simple request-scoped ownership helper, not a generic job system.

Bound upload waiting as well as post-upload work so a stalled multipart sender cannot occupy slots indefinitely; reuse a suitable existing server deadline or add a documented route-level upload deadline. Keep its error mapping explicit and test its cleanup. This deadline is separate from the 55-second post-upload budget.

Preserve existing proxy trust configuration. Do not trust arbitrary forwarded headers, broadly enable trust proxy, or rate-limit manual APIs. Test address handling consistent with the installed limiter, including its supported IPv6 behavior. The concurrency limit is per process and in-memory; do not claim distributed enforcement.

## 9. Verification without repeating unchanged phases

Carry forward Phase 8 client/browser and database-suite evidence when corresponding code/dependencies/configuration are unchanged. Explicitly label carried-forward results. Do not rerun the TypeScript migration, redesign report fixtures, replay production migrations, or repeat the full diary browser suite for this backend-only phase.

Run fresh server lint, strict typecheck, credential-free suite, build, and a compiled-runtime endpoint smoke. Reproducibly install changed server dependencies and check required native Sharp runtime support. Rerun other suites only for actual shared-code changes or observed risks; explain why. If client code remains unchanged, no client install/build/browser run is required.

Add meaningful focused tests with synthetic images and injected provider/clock dependencies:

- Multipart cardinality, duplicate/unknown fields, bad mode/query/media type, empty input, malformed boundary, and exact 10,000,000/10,000,001 byte boundary. A parser-only size test may use arbitrary bytes with downstream isolation; valid-image end-to-end tests must separately exercise decoding.
- JPEG/PNG/WebP success, spoofed MIME, corrupt/truncated input, animation, pixel limit, orientation/transparency/resize, processing deadline, and normalized output bound. Assert both adapters receive identical normalized bytes.
- Strict output schema, coherent label basis, %DV unknowns, plate estimates, null versus zero, missing-fields derivation, server date/source ownership, and no persistence.
- Request/envelope fixtures matching each actual provider API, schema parameters, stateless flags, bounded response reading, refusal, incomplete/empty output, and no hidden retries. Test adapters, not only a mocked orchestration function.
- Each fallback row: primary success/no Grok; timeout/429/5xx/known network/output-invalid then success; both invalid; mixed invalid/unavailable; fallback absent; primary/fallback configuration failure; refusal/non-food; generic TypeError; schema-generation/final-normalization error; developer-request 400.
- Attempt and overall time budgets using fake clocks where suitable; verify actual transport signal cancellation separately. Prove a canceled primary cannot trigger fallback or leak a late result.
- Limit of two active requests and third rejected, request-rate limit, Retry-After, malformed upload slot cleanup, stalled upload deadline, disconnect during/after upload, and subsequent slot reuse.
- Extraction without AI configuration returns safe failure while existing manual APIs remain usable. Preserve meal 65,536-byte and general/goals 100,000-byte parser limits with targeted routing regression checks.

For fresh no-persistence evidence, use the existing `.env` and randomized owned-schema test harness. Snapshot relevant meals/goals/profile/migration data before/after extraction success and failure; confirm no writes. No `.env.test`, separate credentials, name-based database blocker, or ordinary-table mutation. Reuse helpers and clean up only schemas/processes created by this run.

## 10. Bounded live provider checks

Mocked tests do not prove credential/model/transport compatibility. With the existing configured credentials, perform a small live check using non-sensitive test assets:

1. A clearly readable synthetic nutrition-label image through the real route and Gemini. Check expected source quantity/core values against the synthetic label and validate the response.
2. A representative actual plate photo with permitted use through the real route and Gemini. Verify the editable schema, estimate flag, assumptions, and no persistence; do not claim photo estimates are exact ground truth.
3. One controlled fallback check with an injected eligible primary failure and the real Grok adapter, in a test-only harness. Confirm exactly one live Grok call, valid normalized result, and no persistence. Do not add a public force-provider flag or deliberately invalidate production credentials to trigger fallback.

Keep provider use bounded to these planned checks plus a justified retry after a concrete fix. Record actual outbound call counts, models, outcomes, and timing without keys or raw payloads. If rate limits, unavailable credits/models, or network access prevent a required live check, stop repeated calls, finish other work, and record that gate as blocked. Do not silently replace live evidence with mocks.

Use backend HTTP verification; no new browser UI is needed. Stop all owned processes and verify ordinary application data remained unchanged. If a representative plate asset is unavailable, complete label/tests/implementation and clearly identify the missing plate check.

## 11. Documentation and handoff

Archive this prompt as `docs/PHASE_9_CODING_PROMPT.md`. Update README with endpoint/multipart examples, safe existing environment variable names, supported image modes/types/limits, source quantity rules, editable nulls, explicit save separation, error/fallback behavior, deadlines/admission limits, provider configuration, compiled startup, and tests. Include synthetic example inputs/responses, never real credentials.

Add `docs/PHASE_9_VERIFICATION.md` containing:

1. Changes and requirements covered; key modules and exact dependency additions.
2. Fresh commands/checks, expected versus actual results, and test counts.
3. Carried-forward Phase 8 evidence explicitly separated from fresh checks, with rerun decisions explained.
4. Upload/output boundaries, provider transport/fallback/cancellation evidence, and compiled-runtime results.
5. Live checks separated from mocked checks, outbound call counts, observed label accuracy, and plate-estimation limitations.
6. No-persistence, owned-schema/process cleanup, and unchanged ordinary-data evidence.
7. Problems/fixes, any narrow design refinements, deviations, and exact remaining blockers.
8. Current Git branch/HEAD, uncommitted state, and confirmation whether anything was pushed.

Review the diff and run `git diff --check`. Do not weaken tests or skip required cases to claim completion. Previously unverified credential rotation remains an operator follow-up; do not claim it has been resolved without evidence.

Completion requires the bounded extraction endpoint, validated editable result, correct narrow fallback, real cancellation/resource cleanup, no persistence, unaffected manual APIs, fresh affected checks, required live-provider evidence, readable modular TypeScript with comments, and updated documentation.

End with **PHASE 9 PASSED** only if all required gates pass; otherwise **PHASE 9 FAILED** with concrete remaining requirements. Finish all feasible authorized work before reporting a blocker. Stop after Phase 9 and do not generate or implement Phase 10.

## Official references to verify against installed versions

- [Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Gemini image understanding](https://ai.google.dev/gemini-api/docs/image-understanding)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [xAI Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses)
- [Sharp input options](https://sharp.pixelplumbing.com/api-constructor/)
- [Sharp image operations](https://sharp.pixelplumbing.com/api-operation/)
