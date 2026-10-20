# Dynamic Routing V2

Companion uses **Review → Compare → Confirm**. Opening or cancelling a review writes no trip/progress data. The server stores an owned, expiring proposal; confirmation sends only its ID, an option ID and the expected revision. V1 clients remain supported.

## Traveler behavior

- **Skip / replace** and **Place closed** offer up to two purpose-matched replacements plus skip-only. Closure is a traveler report, never a verified live claim.
- **Running late** uses 15/30/60 minutes from the saved start, retaining all visits and their durations. Server time determines today's earliest feasible arrival.
- Saved candidates are searched first. A review shortlists at most twelve candidates in total: up to six saved choices and, if none fits, up to six from existing optional discovery providers. Candidates are deduplicated before scheduling and ranked only after the complete remaining day passes feasibility checks.
- Completed/in-progress stops, must-visit stops, fixed flight/hotel commitments and other days are protected. No whole-day reordering or silent visit removal.
- Remaining flexible visits include five-minute transition buffers; fixed appointments require ten minutes. Listed opening windows and bedtime are checked. Unknown prices/hours stay unknown.
- Historical days and incomplete/unverified timings permit progress-only skipping. Cross-timezone flight days conservatively retain their saved timings rather than treating different local clocks as one timeline.
- **Use my location** appears for today's schedule only. It requests one fix. The server accepts fixes no older than 60 seconds, accuracy at most 200m and within 100km of the planned origin. Rejected fixes use the disclosed planned origin. No raw GPS is stored in proposals or trips.
- A timing prompt is dismissible and never applies changes. Confirmation may require a fresh review if its timings have already passed.

## Configuration and rollout

Deploy/restart the compatible backend **before** the frontend. Existing collections, trip IDs, bookings and payment records need no migration. The existing proposal TTL index continues to expire proposals after 15 minutes.

```powershell
cd Backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Then, in a second terminal from the project root:

```powershell
cd Frontend
npm run dev
```

Open `http://localhost:3000`, choose an owned Plus trip, open **Companion**, and use **Skip / replace**, **Running late** or **Place closed**. Older trips without verified timing information intentionally show skip-only rather than invented times.

Road routing configuration is documented in `Backend/.env.example`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROUTING_DRIVING_URL` | `https://router.project-osrm.org` | OSRM-compatible driving endpoint; blank disables external lookup |
| `ROUTING_DRIVING_PROFILE` | `driving` | Profile actually supported by that endpoint |
| `ROUTING_WALKING_URL` | blank | Separate walking dataset; absent means labelled walking estimates |
| `ROUTING_WALKING_PROFILE` | `foot` | Profile supported by the configured walking dataset |

The public demo is best-effort, without live traffic or availability guarantees. Use a **single worker/process**: the in-process coordinator serializes public requests at least one second apart. Multiple deployment processes require a shared coordinator or your own routing service. See the [OSRM demo policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).

The shared routing service batches a bounded matrix, shares pair estimates between candidate/day requests, coalesces concurrent identical requests and caches provider successes for five minutes and failures for ten seconds. External routing work has an eight-second deadline including rate-limit waits. Detailed geometry/instructions are fetched only for the opened day. Geometry failures retain a dashed straight-line map connection, never a verified road line. Walking never uses the default car dataset.

## API

- `POST /api/trips/{id}/reroute/preview`: `version:2`, `day_number`, `target_activity_id`, `trigger` (`skip`, `closed`, `delay`), `travel_mode`, `expected_revision`; optional `delay_minutes` and one `current_location` containing `lat`, `lon`, `timestamp`, `accuracy`.
- `POST /api/trips/{id}/reroute/apply`: `version:2`, `proposal_id`, `option_id`, `expected_revision`. Browser-supplied schedule fields cannot override the saved option.
- `GET /api/trips/{id}/directions?day_number=1&travel_mode=driving`: authenticated and owned, **free**; shares routing estimates and returns provenance, revision, geometry and instructions. Rerouting continues to require Plus.

Acceptance uses one revision-guarded document update for schedule, progress, revision, known-cost budget and history. Repeated or conflicting acceptance cannot write twice. Successful booking snapshots/selections are preserved.

## Verification

Run `Backend/run_regressions.py`, then frontend `npm run lint`, `npm test`, `npm run build` and `npm run test:e2e`.

`reroute_v2_tests.py` covers the engine, authenticated handlers and routing coordinator without real provider calls. `routingV2.spec.ts` covers review/cancel, selected settings, confirmation payloads, duplicate clicks, GPS refusal, stale previews, focus restoration, mobile layout, both themes and reduced motion. Existing planning, payment, booking, export and Companion tests remain in the full regression suite.

Preview logs include latency, fallback count, option count and rejection reason counts, without coordinates. Coordinate-bearing httpx request logs are suppressed inside routing work. Browser screenshots and recordings are generated under `.cache/dynamic-routing-v2/`.

Production MongoDB/provider availability and accuracy require a separate deployment smoke check; fixture regressions do not establish those guarantees.

An additional local Chromium smoke check exercised the actual FastAPI handlers with isolated in-memory storage and disabled external routing: two review options, unchanged revision/progress after cancel, one confirmed revision increment, and restoration after reload. Its observed preview request times were 0–14ms with two labelled fallback lookups and no candidate rejections. These are local fixture measurements, not live-provider latency claims.

## Files by purpose

- Backend engine: `Backend/app/services/reroute_v2.py`; shared routing/cache/coordinator: `Backend/app/services/road_routing.py`; versioned handlers and free directions: `Backend/app/api/trips.py`.
- Existing discovery helpers accept an optional bounded timeout. Existing callers keep their default timeout behavior. Routing endpoints/profiles are configured through `Backend/.env.example`.
- Review presentation/types/client normalization: `Frontend/src/components/RerouteReviewDialog.tsx`, `Frontend/src/services/rerouteV2.ts`. Companion actions, optional location and timing prompt: `Frontend/src/components/tabs/CompanionMode.tsx`.
- Maps use owned server directions in `Frontend/src/components/tabs/DayDetailView.tsx`; `useModalFocus.ts` retains the original review opener across the asynchronous request; `rerouteDiff.ts` recognizes normalized times without animating unchanged rows.
- Regression coverage: `Backend/reroute_v2_tests.py`, `Frontend/tests/rerouteV2.test.ts`, `Frontend/e2e/routingV2.spec.ts` and updated existing journey/motion/reliability fixtures. `Backend/run_regressions.py` includes V2.

## Completion checks (2026-10-17)

- All twelve backend regression suites passed. The final V2 suite contains 32 passing checks, including the last timezone/profile guards and discovery fallback changes; the other eleven suites contain 173 existing checks/scenarios.
- TypeScript and all 44 frontend unit tests passed. Production build passed without oversized-chunk warnings.
- Full desktop/mobile browser run: **110 passed**. After the final pending-stop prompt refinement, the affected Companion/V2 browser suites were rerun: **32 passed**, including two new desktop/mobile in-progress-stop checks.
- Both themes, reduced motion, focus restoration, stale responses, maps, bookings, payments, exports, planning and progress were exercised. Desktop/mobile PNGs and WebM recordings are in `.cache/dynamic-routing-v2/`; `real-api-confirmed.png` captures the isolated actual-handler smoke test.
- Temporary test servers were stopped. No production trip/payment records were edited by verification, and no GitHub push was performed.
