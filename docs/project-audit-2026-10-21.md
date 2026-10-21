# Project review — 21 October 2026

Reviewed the application entry points, frontend state/authentication and API clients, backend planning/recovery, trip consistency, demo payments, routing, configuration, dependencies and automated coverage. All 62 backend application Python files parsed successfully; TypeScript checked the frontend source. Images, academic documents and local databases were preserved rather than treated as executable code.

## Problems corrected

1. **Session recovery erased useful state on outages.** A failed `/api/auth/me` request previously cleared saved login/context even for connection failures and HTTP 503. Only rejected sessions now clear automatically. Temporary failures display a reconnect screen, preserve preferences/drafts and require successful server verification before opening the workspace. Malformed session responses cannot grant access.
2. **Incomplete planning responses could leave recovery stuck.** Server-reported success without a readable response now offers status recovery instead of a permanent progress indicator. No replacement planning request is silently created.
3. **Vite dependency advisory.** npm audit identified the installed Vite 6.4.3 as affected by launch-editor advisories, including Windows command handling. Updated within the existing major version to 6.4.5 and removed the duplicate runtime dependency declaration. The updated npm audit reports zero known vulnerabilities.
4. **Raw provider errors in acknowledgements.** A fallback preference acknowledgement could include an exception body. It now provides a readable explanation without exposing provider details.
5. **Running backend connectivity.** The existing backend process failed provider calls while a fresh authenticated inference probe worked. Restarted the verified local development processes with no active planning work. The subsequent real browser workflow succeeded. This establishes recovery after restart, not a definitive root-cause diagnosis of the old process's connection failure.

## Final checks

| Check | Result |
|---|---|
| Backend application syntax | 62 Python files parsed |
| Backend regressions | 233 checks across 14 suites passed |
| Python dependency compatibility | `pip check`: no broken requirements |
| Frontend TypeScript | Passed |
| Frontend unit tests | 76 passed |
| Production build | Passed with Vite 6.4.5 |
| Complete desktop/mobile browser suite | 176 passed |
| Frontend dependency audit | Zero known vulnerabilities reported |
| Patch whitespace checks | Passed |

Browser regressions cover booking/payment success and failure, delayed confirmation, ownership-related UI behavior, calendars, saved preferences, responsive layouts, keyboard focus, reduced motion, Companion progress/undo, rerouting, stale responses, session recovery and refresh handling. Those regression tests use fixture APIs.

## Separate live verification

A temporary account exercised the real React interface at `http://localhost:3000`, the running FastAPI server, configured planning providers and MongoDB:

- Actual login, authenticated workspace, planning progress and a single persisted itinerary.
- Simulated Trip Plus checkout, saved success, readable receipt and server-derived access.
- Companion completion persisted to the database and survived refresh.
- Reroute preview followed by cancellation left revision and execution state unchanged.
- Mobile viewport fitted without horizontal page overflow; no browser JavaScript exceptions were recorded.

Only that temporary account and its associated test records were deleted afterward. Existing accounts, itineraries, bookings and progress were preserved. Local evidence is in `.cache/project-audit/` and is ignored by Git.

## Limits that remain

- The Chroma wrapper emits a deprecation warning. Startup and the tested workflows still work; replacing the wrapper is a separate dependency migration.
- Provider availability, quotes, road endpoints and forecast horizons remain external dependencies. Missing information must continue to be labelled unavailable or estimated. The readiness endpoint verifies the database, not every provider.
- Payments/bookings are demonstrations and do not create real reservations or charge money.
- Passing these checks is not an exhaustive proof of every possible input, production concurrency behavior or deployment security. The documented single-worker demo constraints remain applicable.

Development frontend/backend were left running. Changes from this review and the preceding recovery implementation remain local until explicitly pushed.
