# TravelAI implementation review — 14 October 2026

The repository now enforces authenticated ownership, applies supported chat changes to the structured schedule, and protects itinerary writes against concurrent changes. Provider failures and unavailable data are represented explicitly.

## Changes

- Replaced unverified tokens with 24-hour opaque sessions stored as SHA-256 digests in MongoDB. Added verification, logout revocation, expiration checks, ownership filtering, email uniqueness, and bounded registration inputs. Removed browser-created authentication fallback sessions and validated restored sessions.
- Unified frontend API configuration at `VITE_FASTAPI_URL`, defaulting to port 8000. Documented frontend port 3000, deployed CORS configuration, MongoDB startup checks, and the Ollama embedding requirement. Added and installed Windows timezone support; pinned backend dependencies to the checked environment.
- Added constrained structured chat edits: remove or replace a discovered attraction/restaurant, or change its duration. Validate transit timing, protected activities, opening hours, duplicate IDs, and bedtime. Regenerate itinerary text, summary, and known costs from the updated schedule. Unsafe or unsupported edits leave the schedule unchanged.
- Saved reroute previews on the server with 15-minute expiration and verified user ownership. Apply the saved proposal instead of accepting browser-supplied stops. Compare the current revision inside the MongoDB write filter, including legacy records without a revision. Apply the same revision protection to progress writes and conversational edits. Preserve completed activities and normalize legacy progress keys.
- Wired opening-hours validation into the planning graph and removed the reviewer bypass. Unknown hours remain unverified; closed venues are excluded from generated visits. Fixed budgets reject known-cost overruns.
- Used actual backend costs in the budget UI, removed invented return-flight multiplication, and disclosed missing prices. Used trip dates and destination geocoding for weather; display real daily forecasts or unavailable. Removed fabricated hotel fallback names/prices and booking confirmations, voucher codes, driver contacts, and direct insertion of demo places into saved schedules.
- Lazy-loaded pages to reduce initial JavaScript. Removed import-time demo knowledge seeding and gave regional guide ingestion stable document IDs.

## Verification

- Backend: 27 security/consistency checks, 7 activity identity checks, 6 itinerary engine scenarios, 14 dynamic rerouting scenarios, and 10 meal-aware rerouting scenarios passed (64 total).
- Frontend: six service regression tests, TypeScript checking, and the production build passed.
- `pip check` passed; `git diff --check` passed.
- Provider discovery and persistence are mocked in the new security/consistency suite. A smoke check runs the actual LangGraph workflow with mocked discovery nodes. These checks do not establish live Groq/SerpApi availability or real MongoDB behavior under concurrent load. Browser interaction and live bookings were not tested.

Run `python run_regressions.py` from Backend using its virtual environment, and `npm run lint`, `npm test`, and `npm run build` from Frontend.

## Operational notes

Restart the backend and log in again. Existing account passwords remain compatible; legacy session tokens do not. Startup creates unique email and token indexes plus expiry indexes for sessions and proposals. Duplicate legacy emails must be resolved before the unique index can be created. Unowned legacy records are deliberately not assigned to a newly logged-in user.

Supported conversational edits are limited to the operations above. Forecasts outside the available date window and prices absent from provider results remain unavailable. Travel Selections does not issue reservations. The current Chroma wrapper emits a deprecation warning; its installed version is pinned and its replacement migration remains future maintenance.

Implementation references: [MongoDB conditional atomic updates](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [Open-Meteo forecast date window](https://open-meteo.com/en/docs), [FastAPI dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/), and [Groq supported models](https://console.groq.com/docs/models).
