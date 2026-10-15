# TravelAI: current project quality

This pass makes the main travel workflow usable from a real browser, with saved choices and working exports. It builds on the authenticated ownership and schedule-consistency changes described in [the implementation review](implementation-review.md).

## Working workflow

1. Register or sign in with a real server session. Failed connections and expired sessions return to login.
2. Describe the destination, duration, traveler count, and budget, or set them in the preference controls. Ordinary wording such as “Plan a 2-day trip from Hyderabad to Goa for 2 adults with a budget of INR 15000” is supported.
3. Review the schedule, flight results, accommodation options, known costs, and available forecast.
4. Choose a flight or stay. Choices are saved with the trip, survive refresh, and update known costs. Hotel changes update accommodation anchors and transit timing while preserving custom visits and durations. Flight changes must fit the existing arrival day and airports. Unsafe changes leave the saved trip untouched.
5. Copy the actual itinerary text for free. Upgrade the trip with a simulated ₹499 payment to unlock calendar and printable itinerary exports.
6. With Trip Plus, open Companion Mode, mark progress, and preview/apply reroutes. Travel choices are frozen while the trip is active so completed activities cannot be rewritten by a different hotel or flight selection. Payments, history and demo receipts are documented in [the payment guide](demo-payments.md).

## Improvements

- The trip dropdown uses saved trips rather than nonexistent presets. Labels consistently use Planner Studio and Travel Selections.
- Removed fabricated notifications, demo account credentials, and simulated password-reset success. Recovery now accurately states that an email recovery service is not configured.
- Fixed horizontal overflow and overlapping panels on small screens. Desktop and mobile browser tests verify that the itinerary flow stays within the viewport.
- Calendar events use the actual dates, times, stable event identities, revisions, and timezones; invalid times are rejected. Event text is escaped and Unicode lines are folded for iCalendar compatibility.
- HTTP conflicts retain their status instead of falsely marking the backend disconnected. Selection conflicts refresh the saved trip before another attempt.
- Added readiness checking, request IDs, safe server-error responses, and GitHub Actions checks.
- Removed unused frontend server/AI dependencies and updated the vulnerable source-map-js transitive dependency. The final npm audit reported no known vulnerabilities.

## Local verification

- Backend checks include 24 demo-booking, 17 date/schedule, 17 demo-payment, 36 security/consistency, 7 identity, 6 itinerary, 14 rerouting, and 10 meal-aware rerouting cases.
- Frontend unit coverage includes next-day arrival dates, booking/currency requests, hotel selection identity, payment access, exports and API handling.
- All 26 desktop/mobile browser checks passed, including flight/hotel checkout, samples, room repricing, confirmations, Companion access, conflicts and the previous payment/travel flows.
- TypeScript checking, the production build, `pip check`, and `git diff --check` passed.

Browser tests exercise the real React interface and mock API responses. Backend checks use isolated storage and mock provider discovery. These results do not establish live provider accuracy, real MongoDB behavior under concurrent load, or deployment availability. The CI workflow is configured but has not been run on GitHub from this workspace.

## Remaining practical limits

- ISO date ranges are parsed without splitting internal hyphens. Flight imports preserve provider departure/arrival dates; overnight arrivals and hotel check-in appear on the correct day. Saved options missing arrival dates use their duration or midnight rollover for compatibility. Trip dates stay unchanged. Stops that cannot fit are explained; arrival outside the requested dates requires extending the trip or another flight.

- Flights, stays, weather, and retrieval need configured providers. Booking remains a provider transaction; TravelAI does not issue reservations.
- Food, transport, and other unknown prices remain explicitly excluded from known-cost totals. Transit durations are planning estimates.
- Chat edits are constrained to removing/replacing discovered visits and changing duration. A different airport or an incompatible overnight flight requires a new plan.
- Password recovery requires an email delivery integration. No reset email is claimed or sent.
- The pinned Chroma wrapper still has a deprecation warning; replacing it can be a later dependency-maintenance change.

## Commands

From Backend, with its virtual environment activated: `python run_regressions.py`.

From Frontend: `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e`. Install the browser once with `npm run browsers:install`.

Implementation references: [iCalendar RFC 5545](https://www.rfc-editor.org/rfc/rfc5545), [Playwright web server configuration](https://playwright.dev/docs/test-webserver), and [MongoDB conditional atomic writes](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).
