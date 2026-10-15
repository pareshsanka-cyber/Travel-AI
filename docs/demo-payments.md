# Demo payments and Trip Plus

TravelAI includes a payment simulator for the student project. It never transfers money, contacts a bank, collects banking details, or reserves flights/hotels. No payment credentials, SDK or webhook are needed.

The simulator also supports [flight and hotel demo bookings](demo-bookings.md). Successful bookings include Trip Plus for that trip, and payment history/receipts show all three products. The standalone ₹499 upgrade remains an alternative.

## Traveler flow

Create or open a trip in Planner Studio. The **Upgrade this trip** card, a locked Companion/calendar/PDF action, or the separate Trip Plus card in Travel Selections opens checkout. The sidebar **Payments** page provides order history and demo receipts.

Trip Plus is a simulated **₹499 INR once per trip**. It enables Companion Mode, progress writes, dynamic rerouting, calendar download and printable itinerary export. Planning, maps, chat, travel selections, weather, budget viewing and text sharing remain free. Editing the purchased itinerary retains access without another payment.

Choose a demonstration method: UPI, Card or Net banking. The selection changes presentation only. Choose Success, Failure or Delayed confirmation in the demo controls and press **Pay ₹499 — Demo**. Normal confirmation takes three seconds; delayed confirmation takes twenty. Cancellation does not unlock access. A failed/cancelled order can be retried.

The order ID remains in the `payment_order` URL parameter to resume after refresh. Only its owning session can read or change it. Checkout polls once per second while pending. After thirty seconds it shows a pending notice and **Check status**; elapsed time alone never unlocks Plus.

A confirmed success refreshes the trip's server-derived access. Receipts say **Demo receipt**, show the order reference, trip snapshot, simulated amount, method and outcome, and offer print/save to PDF. They are not tax invoices or reservation confirmations.

## API and persistence

All routes require a bearer session:

| Method | Route | Request / result |
| --- | --- | --- |
| POST | `/api/payments/orders` | `{ "trip_id": "…" }`; create/retrieve canonical order |
| POST | `/api/payments/orders/{id}/simulate` | `{ "method": "upi\|card\|netbanking", "outcome": "success\|failure\|delayed\|cancel" }` |
| GET | `/api/payments/orders/{id}` | Owner's authoritative order status |
| GET | `/api/payments/history` | Owner's latest 100 orders |
| GET | `/api/payments/orders/{id}/receipt` | Successful demo receipt; otherwise HTTP 409 |

MongoDB's `payments` collection uses a partial unique `(user_id, trip_id, product)` index for standalone Trip Plus and a separate canonical booking index for flight/hotel quotes. Standalone orders include a trip-title/duration/traveler snapshot, fixed server price **49,900 paise**, INR, demo mode, timestamps, version and attempt history. Extra browser fields such as price, status and access are rejected.

State transitions use atomic version/status comparisons. Pending duplicates reuse the running attempt; successful orders cannot be paid again or downgraded. The intended outcome and settlement timestamp persist in MongoDB. Reading an order or history settles due attempts; no background process or animation is responsible for confirmation. A pending order whose trip was deleted is cancelled. Successful receipts remain available after trip deletion using the snapshot.

Trip responses expose `plus_access`; React maps it to `TripSummary.plusAccess`. Access is derived from the owning trip's successful canonical demo order, never from a stored/client trip flag. Trips without such an order remain free. Progress and both rerouting endpoints enforce access and return HTTP 402 for a free trip. Payment processing does not update the itinerary, its revision, or travel selections.

Restart the backend after updating to register the routes and indexes. Use the existing configured MongoDB and user session; no new environment variables are required.

## Verification

`python run_regressions.py` includes 17 dedicated payment checks plus 72 existing regressions. Coverage includes ownership, tampered prices/access, canonical and competing requests, retries, terminal success, cancellation, persisted timing, delayed confirmation, receipts, deleted trips, per-trip access and protected APIs.

`npm test` includes server-derived access and payment request checks. `npm run test:e2e` uses the production frontend with fixture APIs on desktop Chromium and Pixel 7: locked actions, checkout, keyboard method selection, refresh during processing, success, failure/retry, cancellation, thirty-second pending notices, history, receipt printing, Companion unlocking, travel-selection messaging and viewport width. `npm run lint` checks TypeScript.

Backend tests use isolated in-memory Mongo-style fixtures and a controlled clock. Browser tests mock HTTP responses; they do not verify a live MongoDB deployment or real concurrency under load. Start the configured backend to exercise persistent demo orders with your own trips.
