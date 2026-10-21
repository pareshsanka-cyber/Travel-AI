# Live travel search and destination recovery

## What changed

Bengaluru was absent from destination suggestions even though the backend already resolved Bengaluru and Bangalore to BLR. Both names now find **Bengaluru, India**. Hyderabad, Chennai and Kolkata are also available; the original first six popular destinations remain unchanged. A selected suggestion stays visible, custom places remain supported, and Apply updates planning preferences only.

The configured SerpApi account has exhausted its allowance. This is a provider limit, not evidence that Bengaluru lacks flights or hotels. Code cannot replenish credits. Both travel tabs now explain the actual failure, offer external searches based on the saved route/dates, and provide an explicit availability check.

Fictional demo choices appear separately only when that product has no usable priced results (including nearby hotels). They reuse the existing authenticated checkout and booking-status flow: INR 5,000 per traveler for a one-way flight, INR 2,500 per room/night for a hotel. They never become discovered selections or map locations. Successful sample confirmations remain available in booking/payment history even if live choices later return.

## Request flow

1. Open Flights or Hotels → authenticated discovery-status request.
2. The account check reports quota, credentials, rate limit, connectivity or provider availability. Checks share one in-flight operation and cache the result for 60 seconds, keyed by a fingerprint of the configured credential.
3. **Check live availability** submits the product and expected trip revision. Duplicate clicks are disabled and identical concurrent refresh requests share one result.
4. Known exhausted quota or rejected credentials prevent flight, hotel and related Maps fallback searches. Account checks do not consume search credits.
5. Successful discovery merges choices into that owned trip. A revision change during the search returns 409 without overwriting newer work. The UI offers **Refresh trip** before retrying.
6. Trip switching discards the old panel's responses. Existing planning, progress, booking and export behavior continues to use authoritative trip state.

## API

Both routes require the owning user's bearer session:

```text
GET  /api/trips/{id}/discovery-status
POST /api/trips/{id}/travel-options/refresh
     { "product": "flight" | "hotel", "expected_revision": 1 }
```

Status returns the trip ID/revision, account availability and saved product metadata. Refresh returns `{ trip, availability }`. `availability.failure_reason` distinguishes `quota_exhausted`, `missing_credentials`, `invalid_credentials`, `rate_limited`, `connection_failure`, `provider_unavailable`, `invalid_request` and `empty_results`. Absence of a failure reason indicates availability; result counts and `data_status` still determine whether choices were returned.

Optional `hotel_metadata` and flight failure metadata preserve compatibility with older records. Search errors update only the relevant metadata and revision; existing results stay intact. Legacy exception strings are suppressed when trips are serialized. Safe error messages and HTTP log redaction prevent credential-bearing URLs from being returned or logged.

An explicit refresh bypasses the ordinary one-hour flight cache when searching is allowed. It cannot present that cache as newly checked live availability while the account is known to have no credits.

## Data safeguards

- Flight identity uses flight segments/numbers, airports, dates/times and cabin; hotel identity uses provider property identity, with conservative name/location matching for older records. Price and result position do not define identity.
- Existing IDs are materialized before merging. Equivalent returning offers keep their existing ID. New offers get deterministic hash IDs.
- Selected and successfully purchased offers retain their original saved quotes. Other matching offers can receive refreshed estimates. Existing choices are retained when a provider omits them; a saved estimate is not a reservation or a guarantee of current availability.
- Effective selections are recorded before new options are added. Empty trips retain explicit null selections, preventing the first refreshed result from becoming selected implicitly. Budget calculations also honor explicit null selections.
- Refresh does not rebuild routes, replace activity IDs, change itinerary days, write Companion progress, update stored budget totals, create bookings or rewrite confirmations.
- Updates use revision comparison and one atomic MongoDB write. Same-request results are shared/cached for 60 seconds, ownership is rechecked, and a newer revision invalidates reuse.

Account/refresh coalescing is process-local. Continue using the existing single-worker demo deployment; multiple processes would need shared coordination. No destructive database migration, paid integration or new credential is required. Backend reload/restart registers the new routes before the frontend calls them.

## Verification, 21 October 2026

- Backend regressions: 252 checks across 15 suites, including 19 discovery checks for cache expiry/coalescing, quota blocking, credential failures, safe errors, ownership, duplicate requests, stable identities, pinned quotes and revision conflicts.
- Frontend unit tests: 80 passed; TypeScript and production build passed.
- All 184 desktop/mobile browser checks passed, covering suggestions/custom values/cancellation, quotas, refresh, restored results without selection, late responses after trip switching, and existing planning, payments, bookings and Companion flows.
- A separate browser session used the running localhost frontend, FastAPI and real MongoDB with one isolated temporary account/trip. Hotel and flight sample checkouts succeeded, persisted Booked — Demo after reload, and left the itinerary, selections, budget and progress unchanged. No browser page errors were observed. Temporary test records and session material were removed afterwards.
- Account API returned 200 before/after verification: **250 searches used, zero remaining**. No search credits were consumed by the live checks. Restored-credit/provider-result behavior was verified with controlled offline fixtures; real live fares cannot be verified until credits return.
- Dark/light desktop/mobile screenshots, keyboard focus and reduced-motion checks are recorded under ignored `.cache/discovery/`. Local evidence includes `live-results.json` and `provider-status.json` without provider credentials.

To check manually, open My Trip → Flights or Hotels. Confirm the exhausted-credit explanation and external link, then use a sample demo button to test checkout. When provider credits return, wait up to 60 seconds and choose Check live availability; no planning request or new itinerary is required.
