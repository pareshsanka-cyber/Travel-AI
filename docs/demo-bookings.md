# Demo bookings and included Companion Mode

Flight and hotel bookings are simulations. No money is charged, no bank is contacted, and no ticket or room reservation is created. Hostels are excluded.

## Try the flow

1. Open a trip in Planner Studio. Flight and hotel cards offer **Book flight — Demo** and **Book hotel — Demo** beside their selection controls. Booking an unselected discovered option first saves it safely. Selection conflicts stop checkout.
2. **Travel Selections** shows selected options, booking buttons and **My demo bookings**. Its separate **Try sample demo bookings** section appears when priced results are unavailable. Samples are fictional: ₹5,000 per traveler for a one-way flight, or ₹2,500 per room per night for a hotel, in INR. They do not replace travel selections or map locations.
3. Review the booking. Flights use the saved per-person estimate × trip travelers. Hotels use the saved nightly estimate × nights × rooms. Rooms default to one and allow 1–10. A one-day trip shows one night and following-day checkout. Room capacity and availability are unverified. Discovered currency is retained; no conversions, taxes or fees are invented.
4. Choose a demo method and Success, Failure or Delayed confirmation. Normal confirmation takes three seconds; delayed confirmation takes twenty. Refresh resumes the saved order. After thirty seconds, the UI stays pending and offers **Check status**.
5. A successful flight or hotel booking includes **Trip Plus at no extra simulated charge** for that trip: Companion Mode, progress/rerouting, calendar and printable itinerary exports. The standalone ₹499 demo upgrade remains an alternative.
6. View/print a **demo booking confirmation**, open Companion Mode, or return to the trip. Payments provides history and demo receipts for all products. These documents are not PNRs, tickets, hotel vouchers, tax invoices or reservation confirmations.

## Backend contract

All routes require the owning user's bearer session:

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/bookings/orders` | Create/retrieve a server-priced demo booking |
| GET | `/api/bookings/history` | Latest 100 owned flight/hotel orders |
| GET | `/api/bookings/status?trip_id=...` | All matching flight/hotel statuses for one owned trip, plus successful bookings for previous travel details |
| GET | `/api/bookings/orders/{id}/confirmation` | Successful demo booking confirmation |

POST accepts `trip_id`, `kind` (`flight`/`hotel`), `source` (`discovered`/`sample`), `option_id`, `expected_revision`, and optional `rooms`. Sample IDs are `sample-flight` and `sample-hotel`. Browser amounts, statuses and access flags are rejected. Zero/missing/invalid prices cannot proceed.

Existing `/api/payments` routes handle status, simulation and receipts for `trip_plus`, `flight_demo` and `hotel_demo`. Immutable booking snapshots contain option identity/source, route, dates, quantities, currency and amount. Identical booking details reuse the canonical order. A successful identical purchase is reused even when its current price changes; changed dates or quantities require a separate review.

Unpaid attempts validate the current trip revision; conflicts require **Review booking again**. Successful snapshots never change and display a notice when current dates, travelers, routes or selections differ. Deleting a trip cancels pending attempts while retaining successful owned confirmations and receipts.

Trip responses expose `plus_access` and `plus_access_source` (`booking`, `upgrade`, or null). Selection flags and browser outcomes do not grant access. Progress/rerouting APIs use the same entitlement check. Frontend hotel selection is `isSelected`, independent of demo booking status.

## Startup and verification

Restart the backend. Startup installs separate uniqueness constraints for standalone upgrades and canonical booking quotes, then replaces only the legacy all-products uniqueness index. It preserves orders and unrelated indexes. No new dependencies, environment variables, gateway account or credentials are needed.

Cards use one shared trip-scoped status hook, refreshed on session restoration, tab/trip changes, checkout return and window focus. Success takes priority over failed attempts; selections never imply payment. Unknown status disables purchase until a successful status check. Successful cards show **Booked — Demo**, the reference and **View confirmation**. Confirmation links survive refresh. Successful checkout offers **View booked flight/hotel** to open the corresponding tab.

Legacy itineraries can book their effective current hotel without rebuilding untimed routes. Missing selection metadata is saved with the revision comparison; route, prices, activity IDs and progress remain intact. Current-hotel booking is allowed during Companion Mode; switching hotels remains blocked. Untimed legacy hotel changes return an actionable HTTP 409. Unexpected failures return safe JSON with request references and CORS headers; server logs retain the operation and sanitized traceback frames.

Verified: 140 backend regressions (including 33 booking tests), 22 frontend unit tests, 36 desktop/mobile browser checks, TypeScript and the production build. Coverage includes pricing, rooms/nights, currencies, samples, hostel exclusion, stale revisions, duplicates, retries/cancellation, delayed confirmation, ownership, per-trip access, deleted trips, legacy selections, original-price reuse and immutable confirmations.

`cd Backend; .\.venv\Scripts\python.exe live_booking_check.py` is an opt-in live local HTTP check. It uses a disposable account and a copy of the existing legacy Sydney trip, checks current-hotel checkout with active Companion against MongoDB and server logs, then removes only its test data. It leaves the original trip and successful bookings untouched. Browser tests use mocked APIs; the live check separately verifies the real backend/database path. Provider availability and real reservations remain outside this demo.
