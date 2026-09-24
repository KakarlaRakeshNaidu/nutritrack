# Multi-user verification

## Scope and design

NutriTrack now provides JWT-based email/password signup, login, logout, and
current-session lookup. A signed JWT is carried only in an HttpOnly cookie.
PostgreSQL stores a SHA-256 hash of the issued token together with its JWT
session ID, owner, expiry, and revocation state. Passwords are salted with Node
scrypt (N=16384, r=8, p=1); plaintext passwords and session tokens are never
stored or logged.

Every profile, goals row, meal query, list count, and report aggregate is scoped
by the authenticated user ID derived from the validated JWT and active session.
Nutrition image and text routes authenticate before multipart/AI work and use
the authenticated profile timezone. State-changing cookie requests require the
exact configured browser Origin. Signup/login share a bounded per-IP rate
limit.

Optional welcome messages use Nodemailer SMTP. Delivery failure does not roll
back a successfully committed account, and the message explicitly does not
claim email ownership verification.

## Fresh evidence

| Behavior | Evidence | Result |
| --- | --- | --- |
| Forward migration and idempotent runner | Randomized owned-schema database suite applied migrations 001 and 002 twice | PASS |
| Legacy preservation | Representative legacy profile, goals, and meal retained under the reserved non-login owner | PASS |
| Operator assignment | Randomized-schema test rejected a modified target, then transactionally moved the preserved profile, goals, and meal to an empty existing account | PASS |
| Independent signup state | Signup transaction creates one default profile, one all-null goals row, and no copied meals | PASS |
| Meal ownership | Two-user database test proved other-owner reads, updates, and deletes are indistinguishable from missing IDs | PASS |
| Lists, counts, goals, reports | User-scoped repository and randomized-schema integration assertions | PASS |
| Password and login handling | Auth HTTP tests cover normalized email, non-plaintext hash, duplicate signup, and generic incorrect login | PASS |
| JWT session lifecycle | Auth HTTP tests cover cookie issue, current session, expiry rejection, logout revocation, and post-logout rejection | PASS |
| CSRF and AI boundary | Wrong/missing Origin is rejected; unauthenticated extraction returns 401 before provider invocation | PASS |
| Protected client routing | Client route tests cover session loading and authenticated application routing | PASS |
| Type safety and static quality | Server and client typecheck/lint completed on the final candidate | PASS |
| Production artifacts | Server compiled build and client Vite production build completed | PASS |
| Real browser account switch | Isolated development and production-preview runs covered signup, private meal/report, logout/login, second-user isolation, keyboard activation, and 375px layout | PASS |

The final server unit suite passed 166/166 tests and the final client suite passed
62/62 tests. The randomized database suite was run after ownership integration. Transient fixed-port/database setup failures
were isolated; each affected database test was rerun after its harness-specific
fix and passed. The owned schemas and pools were cleaned by the harness. No live
Gemini call was repeated; previously passing Gemini evidence applies because
provider behavior was not changed.

## Security and limitations

- Email is trimmed and lowercased; passwords remain byte-for-byte as entered and
  are bounded to 12-128 characters.
- The database uniqueness constraint enforces one normalized email.
- The cookie is HttpOnly and scoped to /api/v1. Development uses SameSite=Lax;
  production uses Secure and SameSite=None for the currently supported
  cross-origin topology. A same-site deployment or same-origin /api proxy is
  recommended because browsers may restrict third-party cookies.
- Return paths accept only internal absolute paths and reject protocol-relative
  values.
- No authentication token is stored in localStorage.
- Password reset, email verification, social login, account deletion, and
  administration are intentionally outside this feature. A successful SMTP
  welcome email is not proof of address ownership.

## Cleanup and status

No production migration, deployment, branch change, commit, push, or live
configuration change was performed. Only randomized owned schemas and local
processes are permitted for verification.

Owned randomized browser schemas (including one left by an interrupted harness),
local client/backend processes, temporary scripts, and the dedicated Chrome profile
were removed. Ordinary application data and the real environment file were not
modified.

**MULTI-USER FEATURE PASSED**
