Implement Phase 10: Image Upload and Editable Meal Prefill UI.

Phases 1–9 are complete. Phase 9 passed under the user-approved
Gemini-only scope. Groq/xAI fallback has been removed. Do not restore it.

Implement only the new frontend workflow and necessary integration.
Stop after Phase 10.

1. Starting context and focused inspection

Work in the existing NutriTrack repository:
 /home/rakeshnaidu/rakesh_linux/NutriTrack

Reuse the current implementation. Inspect only applicable repository
instructions and the relevant:
- Router and navigation.
- Shared MealForm and meal creation validation.
- Central API client.
- Extraction endpoint's final response contract.
- Profile/date context.
- Existing isolated browser verification helpers.
- Phase 9 closeout evidence where needed.

Do not reread every planning document, repeat the TypeScript migration,
or rebuild working backend features.

The latest Phase 9 closeout recorded:
- Gemini-only extraction.
- Typecheck, lint, and 31 focused regression tests passed.
- Existing successful Gemini label/plate evidence carried forward.
- No persistence during extraction.
- Groq/xAI code and configuration requirements removed.

Do not assume previous aggregate test counts or Git HEAD remain current.
Preserve existing work, unrelated changes, and the real .env.
Do not change branches, commit, push, or deploy.

2. Objective and scope

Add /meals/from-image so users can:

1) Select a nutrition-label or plate image.
2) Explicitly request analysis.
3) Review and edit the suggested meal fields.
4) Complete missing required values.
5) Explicitly save through the existing POST /api/v1/meals endpoint.
6) See the saved meal in history and existing reports.

Add a clear “Log from photo” link in appropriate existing navigation,
such as the dashboard and meal history.

Reuse the existing manual meal form and save workflow. Do not create
a separate nutrition editor with duplicated validation.

Do not implement provider adapters, OCR, fallback, image persistence,
authentication, chat, PDF import, or Phase 11 work.

3. Code quality

Use strict TypeScript/TSX and the existing React, React Hook Form,
Zod, router, and styling conventions.

Keep modules small and easy to explain. Separate:
- Extraction API wrapper.
- File selection/preview.
- Analysis request lifecycle.
- Draft-to-form mapping.
- Page composition.

Use existing helpers where suitable. Do not introduce a global store,
new form framework, or unnecessary dependencies.

Preserve runtime validation. No blanket any, unchecked double assertions,
or suppression directives to bypass typing problems.

Comments must explain non-obvious logic:
- Analysis versus persistence.
- Null/zero and raw/parsed form values.
- Protection against obsolete responses.
- Preview cleanup.
- Draft replacement and consumed-total semantics.

4. Image selection and preview

Provide labeled controls for:
- Image mode: Nutrition label or Plate of food.
- One image file.
- Analyze image.
- Cancel analysis while a request is pending.
- Manual-entry navigation.

Accept JPEG, PNG, and WebP. Client validation must reject:
- No selected file.
- Empty file.
- Unsupported MIME type.
- File larger than 10,000,000 bytes.

Exactly 10,000,000 bytes is permitted. Display the limit accurately.
The backend remains authoritative for content, format, animation,
dimensions, and decoding checks.

Selecting a file must not upload it automatically.
Analyze requires an explicit user action.

Show a local preview and useful filename/size information.
Handle preview failure safely; do not render file contents as HTML.

Use object URLs where appropriate and revoke them on replacement,
removal, and unmount. Do not store images/base64 in localStorage,
sessionStorage, route URLs, analytics, or application records.

Provide visible format guidance and explain that plate nutrition is
estimated and all suggestions should be reviewed before saving.

5. Extraction API request

Use the existing central API client and public backend base URL.

POST /api/v1/nutrition/extract using FormData containing exactly:
- image: selected File.
- image_type: nutrition_label or food_plate.

Do not manually set multipart Content-Type; the browser supplies
the boundary. Do not include additional fields or query parameters.

The successful response is { data: ExtractionResult }.
Use the actual final Gemini-only contract from Phase 9.

Preserve normalized API errors and request IDs. Add multipart support
to the shared client only if it is missing, without breaking existing
JSON requests or 204 handling.

Use a 60-second total client request timeout, including upload and
response reading. Timeout must abort the underlying fetch.

No automatic analysis retries. Retrying is an explicit user action.
Do not expose provider credentials or call Gemini from the browser.

6. Request lifecycle and draft protection

Use explicit states such as:
- No image selected.
- Ready to analyze.
- Analysis pending.
- Draft ready.
- Recoverable error.
- Save pending.
- Save success.

Show honest progress text; do not invent percentage progress when
the transport cannot measure it.

Prevent duplicate Analyze submissions while pending.
Cancellation, file/mode changes, and route unmount must abort pending
analysis and invalidate its response.

Use existing abort-plus-sequence protection so an old response cannot:
- Replace a newer draft.
- Reset edited fields.
- Show the wrong image mode.
- Restore a canceled result.
- Overwrite a newer error or loading state.

Treat cancellation as an intentional action, not a provider failure.

Protect unsaved draft edits:
- Do not reset the form on unrelated rerenders or profile refresh.
- Before discarding a dirty draft for a different image/mode or a new
  analysis result, obtain explicit discard/replacement confirmation.
- If the user declines, preserve the existing draft and its image context.
- Keep the current draft available if reanalysis fails.

Use a simple replacement policy rather than silently merging fields
from two different images.

During saving, prevent conflicting analysis/replacement actions.
Do not treat canceling a save request as proof that nothing persisted.

7. Editable prefill

Map the returned draft into the existing MealForm.

Show:
- Extracted food name.
- Consumption date.
- Meal type.
- Consumed quantity and unit.
- Calories, protein, carbs, and fat.
- All six micronutrients with their existing units.
- Source basis and assumptions.
- Clear estimate indication for plate results.

Render assumptions as plain text. They are informational and are not
extra fields to submit to the meal API.

Preserve these distinctions:
- null becomes a blank/unknown form value.
- Numeric zero remains zero.
- Missing required core values remain blank.
- Optional unknown micronutrients do not become zero.

Use the existing raw-input versus parsed-output form types.
Do not use Number('') or Number(null) to manufacture a zero.

Display backend missing_fields as guidance, but derive current save
eligibility from the ordinary meal form validation. The missing-fields
list must update meaningfully as the user completes the form.

Meal type initially remains unselected if the backend returns null.
Use the returned date and existing backend profile context; do not
replace it with the browser's local date.

Preserve the final source and estimate metadata:
- nutrition_label for label-derived entries.
- food_plate with is_estimate=true for plate-derived entries.

Do not silently convert an edited AI draft into a manual entry.
Keep provenance consistent with the existing meal API contract.

For labels, preserve the extracted reference amount and its totals:
“per 100 g, 250 kcal” prefills 100 g and 250 kcal.

Changing consumed quantity must not automatically rescale calories
or nutrients. Keep the existing consumed-total explanation visible.

Plate analysis produces one editable meal entry, including mixed plates,
not multiple component records.

8. Explicit saving and persistence

Analysis success must never trigger POST /meals.

Only explicit “Save meal” submits the complete validated writable
meal payload through the existing create API.

Do not submit:
- Image bytes.
- provider.
- assumptions.
- source_basis.
- missing_fields.
- Server-owned IDs or timestamps.
Unless a field already belongs to the actual writable meal contract,
it is not part of the save payload.

Disable Save while invalid or pending and explain missing requirements.
Allow all nutritional suggestions to be reviewed and corrected.

Preserve existing behavior:
- Failed save retains entered values.
- Backend validation errors map to form fields where possible.
- No automatic mutation retry.
- Ambiguous network failure advises checking history before retrying.
- Repeated clicking while pending cannot send duplicate writes.

After confirmed success, navigate to the existing history or saved-meal
view and clear the completed draft. Returning to the image route must
not automatically resubmit the previous meal.

Existing dashboard/report refresh behavior must include the saved meal.
Do not rewrite report calculations or add a report cache.

9. Recoverable failures and manual entry

Handle:
- Client file validation failures.
- Backend 400/413/415/422 upload/content failures.
- 429 rate/busy responses.
- 502 invalid AI output.
- 503 unavailable/configuration errors.
- Network errors, timeout, and non-JSON proxy responses.

Show useful messages with an explicit retry or correction action.
Do not pretend an error produced zero nutrition.

Preserve a usable preview, selection, and existing draft where possible.
For 429, display retry guidance using available Retry-After information;
do not automatically issue another request.

Keep manual entry accessible throughout the workflow. Gemini failure
must not prevent use of the existing manual meal route.

10. Accessibility and layout

Use labeled native controls, clear headings, visible keyboard focus,
accessible validation messages, and announced loading/error states.

After successful analysis, move focus sensibly to the review heading
or first field requiring attention. Do not unexpectedly steal focus
during background state changes.

Verify the image preview, assumptions, form fields, and action buttons
at desktop and 375px width without page-wide horizontal overflow.

Support keyboard selection, analysis, cancellation, review, and saving.
Ensure direct-route refresh and Back/Forward navigation remain usable.

11. Focused verification

Do not repeat successful Gemini live label/plate checks or test provider
accuracy again. Carry Phase 9 evidence forward explicitly.

Add meaningful client tests for:
- File types and exact size boundaries.
- No upload merely from selecting a file.
- Correct FormData and no manually set multipart boundary.
- Both extraction modes and draft mapping.
- Known zero versus unknown/missing values.
- Missing required fields preventing save.
- Explicit save producing only the normal meal payload.
- No meal POST after analysis alone.
- No duplicate Analyze/Save while pending.
- Cancellation, timeout, and stale-response protection.
- Dirty-draft replacement confirmation and failed-analysis retention.
- Failed-save input retention.
- Recoverable errors and manual entry access.
- Preview object-URL cleanup.

Run fresh client typecheck, lint, production build, and relevant tests.
Because shared MealForm/API-client code may change, include the existing
tests for affected manual create/edit behavior.

Do not rerun unchanged server/database suites. If a concrete backend
integration fix is necessary, test only affected behavior and explain it.

12. Browser integration without repeated provider calls

Verify the new workflow in a real browser against the existing isolated
backend/database setup, using development and production preview.

Use a test-only injected Gemini adapter returning validated Phase 9
fixtures so the real upload route, draft normalization, browser handling,
and normal meal persistence execute without fresh live Gemini calls.

Do not add a public mock/provider-selection flag. Keep fixture injection
inside the existing test harness. Clearly label provider simulation in
the verification evidence; do not describe it as a fresh live-AI test.

Verify both label and plate workflows:
- Upload and Analyze.
- Prefill and missing-field completion.
- Review/edit values.
- No database change before Save.
- One explicit Save creates one meal.
- Reload confirms saved values and source/estimate metadata.
- The saved meal appears in history and contributes to reports.

Also verify cancellation, one controlled analysis failure, one failed save,
manual-entry recovery, keyboard use, direct-route refresh, and responsive
layout at approximately 1440×1000 and 375×812.

Use existing .env-backed randomized schema isolation.
Do not require .env.test, new credentials, or production migrations.
Preserve ordinary application records and clean up owned resources.

Use the existing installed-browser fallback if the desktop helper fails.
Do not repeat unrelated goals/report browser suites.

13. Documentation and final result

Update README with:
- /meals/from-image usage.
- Accepted formats and exact file-size limit.
- Label versus plate behavior.
- Review/edit and explicit Save requirement.
- Unknown values and consumed-total semantics.
- Manual entry after analysis failure.
- Gemini-only scope.

Archive this prompt in docs/PHASE_10_CODING_PROMPT.md.
Create docs/PHASE_10_VERIFICATION.md containing:
- Changes and relevant files.
- Fresh checks and actual test counts.
- Carried-forward evidence identified separately.
- Browser workflows and simulated-provider disclosure.
- No-save-before-confirmation and persistence evidence.
- Problems/fixes, deviations, and remaining blockers.
- Cleanup and ordinary-data preservation.
- Current branch/HEAD and uncommitted status.

Run git diff --check and review only the relevant final changes.
Do not weaken tests or claim unavailable checks passed.

Report PHASE 10 PASSED only when the new workflow and required checks
succeed. Otherwise report PHASE 10 FAILED with precise remaining blockers.

Stop after Phase 10. Do not start Phase 11, commit, push, or deploy.

Additional user clarification:
If the isolated browser harness already supports provider injection, reuse it. Otherwise add only the minimal test-only injection needed. Do not change production provider behavior or expose a mock endpoint.
