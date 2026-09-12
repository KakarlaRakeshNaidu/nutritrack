# Personal Calorie Tracker — design-review findings

Review scope: the original assignment, the attached fixed decisions, the prior analysis, and the latest instruction making comments required. Reviewed artifacts: PRD.md, HLD.md, LLD.md, and REQUIREMENT_TRACEABILITY.md. This review assesses the design; it does not claim that an application or its proposed tests already exist.

## Findings resolved in the documents

| ID | Finding | Resolution and location |
| --- | --- | --- |
| DR-001 | Comments were temporarily described as optional in the conversation. | The latest clarification wins. PRD NFR-005 and HLD/LLD require explanatory comments for important logic and decisions; D-006 checks their presence. |
| DR-002 | Prior analysis recommended accounting for multiple users early, which could leak into mandatory scope. | Mandatory architecture has no authentication, ownership IDs, tokens, account tables, or login routes. A singleton profile persists user data without becoming an account system. PRD 4–5/12; HLD 1/14; LLD 2/9/21/24. |
| DR-003 | “Manage meals” could omit update/delete or leave PATCH semantics undecided. | Explicit POST/GET/list/PUT/DELETE contracts. Full PUT requires all writable fields and preserves identity/created_at. LLD 3/8/18. |
| DR-004 | PostgreSQL DATE can accidentally become a timezone-shifted JavaScript Date. | Preserve DATE strings; derive today from backend clock plus persisted Asia/Kolkata timezone; do not group by creation timestamp. HLD 6; LLD 4–5. |
| DR-005 | A ban on future consumption can be confused with a ban on viewing a complete current week. | Reject future consumption on POST and PUT. Inclusive report ranges may display future dates, labeled future and excluded from elapsed goals. PRD 9.2; LLD 4/12/13. |
| DR-006 | Weekly/custom range boundaries can differ between charts, history, and targets. | Monday–Sunday calendar buckets with clipped inclusive coverage; one captured today; elapsed-date goal comparisons. LLD 5/10/12/13. |
| DR-007 | Pagination could be limited to the history UI, or report totals could depend on one page. | Backend 1/20 defaults, maximum 100 with 101 rejected, consistent metadata, deterministic sorting, filters first, and separate full-range report summaries. Report buckets also paginate. HLD 7/11; LLD 10–13. |
| DR-008 | Blank/null nutrient values can become zero through frontend or numeric coercion. | Nullable columns and strict body schemas; explicit blank-to-null mapping; SUM plus known/unknown counts; all-unknown totals remain null. PRD 9.4; HLD 12; LLD 6/7/13/18/23. |
| DR-009 | Serving/reference values could be saved as consumed totals without a defined basis. | Every stored nutrient is a consumed total. A label draft uses its extracted reference quantity as the proposed consumed amount; the user reviews totals when changing quantity. Full PUT avoids partial-edit defaults. PRD 9.1/9.6; LLD 3/15. |
| DR-010 | Historical goal behavior remained an unnecessary architectural decision for the implementer. | Selected one current configuration, without history tables. Historical charts explicitly say “Compared with current targets”; all comparisons use matching elapsed dates and units. PRD 9.5; HLD 11/16; LLD 2.3/13. |
| DR-011 | Required WebP uploads do not directly match Grok's documented JPEG/PNG input list. | Validate all three required formats and normalize to bounded JPEG before either provider. No change to user-facing accepted types. HLD 10; LLD 20. |
| DR-012 | “10 MB” needed an exact byte interpretation and backend enforcement point. | Consistently define 10 MB as 10,000,000 file bytes; exact limit passes size validation and larger input fails before AI. PRD 9.6; HLD 10; LLD 14/20; T-026. |
| DR-013 | Broad catch-and-fallback could hide programming errors or retry user cancellation. | Narrow typed transport/output failure classes; generic TypeError, schema-construction errors, invalid requests, configuration, content refusal, and cancellation do not trigger Grok. LLD 19; T-030–033/041. |
| DR-014 | Invalid AI configuration could stop all application startup despite manual fallback requirements. | Core configuration is validated for startup; provider pairs are assessed separately and expose recoverable extraction errors. Manual endpoints have no AI dependency. LLD 26; T-032. |
| DR-015 | AI output could reach the database or frontend without authoritative validation. | Each provider candidate is JSON/Zod-validated. AIService has no meal repository; only a later ordinary POST saves the confirmed draft. HLD 2/8/9; LLD 14–19; T-034–036. |
| DR-016 | Multiple pools, leaked clients, inconsistent count/page snapshots, and TLS overrides are easy implementation mistakes. | One shared pg.Pool; finally-release; same-client transactions; read snapshots; graceful shutdown; verified Aiven CA with conflicting URL SSL options rejected. HLD 5; LLD 11/17/26. |
| DR-017 | Numeric/report and frontend error contracts could drift. | One Meal representation, one paging envelope, one report contract, one error envelope, explicit 204 handling, and shared test fixtures. LLD 3/8/11/12/24/25. |
| DR-018 | A single-user public API might be incorrectly described as private because CORS is configured. | Deployment limitation stated; no mandatory authentication was added. CORS/Helmet/rate limits are not represented as private ownership controls. PRD 4; HLD 14/15. |

## Completed design checks

- Reviewed all fixed scope/stack decisions against the three documents, including required comments.
- Checked 12 PRD sections, 16 HLD sections, and 27 LLD sections against the requested document coverage.
- Mapped 18 functional and 8 non-functional requirements to design locations and verification checks.
- Checked Markdown table structure, fenced JSON examples, and requirement/test identifier consistency.
- Checked the Sunday/Monday examples, timezone-boundary example, inclusive six-day Saturday target, seven-day target, full-data calorie fixture, and known/unknown micronutrient arithmetic.
- Checked that a bounded normalized 10 MB image can be base64-encoded with a small prompt/schema within the documented Gemini inline-request size. Upload validation and image normalization remain separately tested requirements.
- Inspected architecture and AI-flow diagrams for the intended boundaries; there is no direct AI-to-database path, mandatory authentication, or extra infrastructure.
- Checked that the output consists only of planning documents, traceability, and this design review. No application files, migrations, README implementation, or phased implementation plan were created.

## Deliberate tradeoffs and verification still required after implementation

The design intentionally uses current-only goals, six fixed micronutrients, consumed-total nutrition, full PUT edits without automatic rescaling, one mixed entry per plate, a 366-day report request limit, and a single backend process. These are documented decisions rather than unresolved architectural choices. Longer diary history remains accessible through the paginated list.

Automated verification is specified as T-001–T-044, with manual/code-review checks D-001–D-008. These checks have not been executed against an application. Actual Aiven credentials/CA, provider keys, account model access, dependency pinning, model-output accuracy, image readability after normalization, timeout cancellation, and UI behavior will require implementation-time verification. No provider accuracy, uptime, cost, or completed integration claim is made here.

No unresolved contradiction with the fixed decisions remains in this review. The mandatory design is ready to be converted into an implementation plan when requested.
