# Personal Calorie Tracker — requirement traceability

This maps every mandatory assignment outcome and quality guideline to the reviewed planning documents. FR/NFR identifiers are defined in PRD section 7/8. T and D identifiers are proposed implementation-verification checks in LLD section 27, not tests already run. Fixed user decisions override earlier recommendations; required comments follow the latest clarification.

| Requirement ID | Original assignment requirement | Fixed decision | PRD section | HLD design | LLD implementation | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| FR-001 | Set/manage calorie, macro, weight goals | Single current configuration; no mandatory accounts | 6–7, 9.5, AC-001 | 4–5, 11, 16 | 2.3, 9, 13, goalSchema in 18 | T-022, T-023; AC-001/008 |
| FR-002 | Create food entries with quantity and nutrition | Four categories; consumed totals; DATE; future consumption prohibited | 6–7, 9.1–9.4 | 3–6 | 2.4, 3–8, createMealSchema in 18 | T-001, T-005/006, T-016/017, T-042/043 |
| FR-003 | Food-entry listing/read capability | Complete list/read in mandatory CRUD | 6–7, AC-002 | 3–4, 7 | 8, 10–11 | T-002, T-007, T-012/013 |
| FR-004 | Manage nutrition records; user fixed CRUD extension | Full PUT update; preserve identity/created_at | 6–7, 9.1, AC-002 | 3–4, 11 | 3, 8, updateMealSchema in 18 | T-003, T-006, T-019, T-042 |
| FR-005 | Manage nutrition records; user fixed CRUD extension | Delete mandatory; no retained report contribution | 6–7, 10, AC-002 | 3–4, 11 | 8, 13, 22 | T-004, T-020 |
| FR-006 | Time-range and meal-type filtering | Both endpoints inclusive; consumption_date drives filtering | 6–7, 9.2, AC-003 | 6–7 | 4–5, 10 | T-007–011 |
| FR-007 | Pagination in all list APIs | page=1; page_size=20; maximum 100; reject 101; filters first | 7, 9.3, AC-004/005 | 7, 11 | 10–12, query schemas in 18 | T-012–015 |
| FR-008 | Weekly calorie intake trend | Monday–Sunday; complete data; no creation-date grouping | 7, 9.2, AC-005/006 | 6, 11 | 5, 12–13 | T-009–011, T-014/015, T-021 |
| FR-009 | Daily/weekly macro breakdown | Canonical grams; independently aggregated consumed totals | 7, 9.4 | 11 | 6, 12–13 | T-014/015, T-019/020, T-043 |
| FR-010 | Vitamin/mineral summary | Six named micros; known zero distinct from NULL | 7, 9.4, AC-007 | 11–12 | 2.4, 6–7, 12–13, 23 | T-016–018, T-037/043 |
| FR-011 | Goal-versus-actual charts | Matching elapsed dates/units; explicit current-target basis | 7, 9.5, AC-008 | 11, 16 | 9, 12–13 | T-022–024 |
| FR-012 | Nutrition-label photo extraction | JPEG/PNG/WebP; maximum 10 MB; backend AI | 7, 9.6, AC-009/010 | 8–10 | 14–15, 18–20 | T-025–031, T-034/035; D-008 |
| FR-013 | Plate-photo extraction | Same upload limits; editable portion estimate | 7, 9.6, AC-009/010 | 8–10 | 14–15, 18–20 | T-027–031, T-034/035; D-008 |
| FR-014 | Automatically prefill extracted nutrition | Editable unsaved draft; normal meal endpoint saves confirmation | 6–7, 9.6 | 3, 8–10 | 14–16, 21–24 | T-034–038 |
| FR-015 | API/frontend separation | React/Vite and Express separate; no client DB/provider access | 7–8, AC-013 | 1–4, 14–15 | 1, 8–9, 12, 14, 21, 24, 26 | D-001/003/005; T-038 |
| FR-016 | Persist food entries, goals, user data | Aiven PostgreSQL; singleton profile; migrations | 7–8, AC-013/015 | 5–6, 15 | 2, 9, 17, 26 | T-022, T-039/040; D-004 |
| FR-017 | Robust AI-powered entry | Gemini first; Grok only eligible failures; Zod; manual survives | 7, 9.6, AC-011 | 8–10, 13 | 14–20, 25–26 | T-029–036, T-041 |
| FR-018 | Personal app; multi-user is bonus | Mandatory single-user; no auth/account tables or ownership flow | 4–5, 7, 12 | 1–2, 14–16 | 1–2, 8–9, 21, 24 | D-002 |
| NFR-001 | Input validation | Authoritative backend Zod; unknown micros nullable | 8–10, AC-012 | 4, 6–8, 10, 12–13 | 4, 8–10, 14, 18, 20, 23 | T-005–008, T-012, T-025–028, T-031/036/037 |
| NFR-002 | Robust error handling and experience | Central errors; no false save success; reports refresh | 8, 10 | 3–4, 13 | 8–9, 14, 19, 22, 24–25 | T-019/020, T-032/038/044 |
| NFR-003 | Clean code, modularity, reusability | Easy to understand/explain; focused functions; no unnecessary architecture | 3, 8, AC-014 | 1–5, 16 | 1, 16–17, 26–27 | D-001/003 |
| NFR-004 | README setup/run instructions and assumptions | Separate apps; Aiven/CA/migrations; fixed decisions documented | 8, AC-015 | 15–16 | 26–27 | D-004; T-040 |
| NFR-005 | Comments explaining important logic/decisions | Latest clarification: comments must be present | 8, AC-014 | 12, 16 | 16–19, 26–27 | D-006 |
| NFR-006 | Robustness/security implied by uploads and persistence | Server-only keys; SQL parameters; MIME/size; CORS/Helmet/AI limits | 8, 9.6 | 5, 8–10, 14–15 | 8, 14, 17, 19–20, 24–26 | T-025–028, T-036/041; D-005 |
| NFR-007 | Usable browser workflows | Clear units, responsive forms, loading/empty/error states | 6, 8, 10 | 3, 11–13 | 21–24 | T-021, T-035/037/038/044; D-007 |
| NFR-008 | Maintainable, robust data/API implementation | Shared pg.Pool, SQL migrations/transactions, complete-data reports | 8–9 | 5, 7, 11, 15 | 2, 10–13, 17, 20, 26 | T-014/015, T-039–041 |

Fixed-stack coverage is explicit in HLD sections 1/5/8 and LLD sections 1/17/18/19/26: React, Vite, React Router, Recharts, useful React Hook Form/Zod, Node, Express, REST, authoritative Zod, Aiven PostgreSQL, pg, one shared pool, parameterized queries, migrations, transactions, Gemini, and Grok fallback. No stack substitution is proposed.

Bonus traceability is deliberately separate: conversational actions, multi-user authentication/private data, and PDF import remain PRD section 12 only, with no mandatory tables/endpoints/dependencies. The initial analysis's optional goal-history and account recommendations are superseded by this reviewed mandatory design.
