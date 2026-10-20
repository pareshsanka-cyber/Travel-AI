# Routing reliability and performance fixes

Implemented after the 17 October 2026 review. Existing local configuration/offline-status changes were preserved.

## Behavior changes

- **Trip switching:** progress responses update their originating history/cache, then check the currently displayed trip before updating its progress/revision. Reroute responses also check their trip identity before changing displayed days, budget or execution state. Errors from an old trip do not replace the current trip's error state. A full local cache cannot turn a confirmed server save into an unsuccessful UI action.
- **Saved durations:** rerouting derives existing visit lengths from saved start/end times. Missing or inconsistent duration metadata cannot shorten a two-hour visit to one hour.
- **Completed stops:** completed/in-progress visits remain fixed even after the skipped row. Legacy progress keys use the existing identity-aware status resolver.
- **Whole-day feasibility:** candidate replacements must leave enough time for all subsequent visits. Current-time scheduling includes travel to the replacement even without a GPS fix. Fixed airport/transit stops retain their times. Custom bedtime, visit opening windows and midnight bounds are checked. Infeasible arrangements fall back to skipping only, preserving the saved schedule.
- **Safe skip-only acceptance:** the server's stored proposal determines this mode. Its proposed remainder must exactly match the original remainder. Acceptance records the skip/revision without replacing route details. Client-supplied mode/timings do not choose what is written.
- **Honest directions:** missing venue coordinates produce an unavailable leg, not an offset around a city center. Navigation is hidden for unavailable coordinates, and totals are labelled incomplete. Distance alone no longer converts a road journey into a flight; transport information/airport stops determine the classification.
- **Request lifecycle:** identical road requests share one in-flight request. Each caller can cancel independently; the underlying request is aborted when its last subscriber leaves. Day/mode changes cancel obsolete callers. Timeouts remain active through response-body parsing. Malformed geometry/estimates remain explicitly labelled fallbacks.
- **Bounded cache:** verified routes last five minutes and fallback estimates ten seconds, allowing provider recovery. Driving and cab share road geometry while retaining their own labels/mode. Cache entries are copied for callers and limited to 32 entries/40,000 coordinate pairs; individual geometries over 10,000 points are not cached.
- **CI:** the backend job now supplies a non-secret local MongoDB URI alongside its Groq placeholder. A fresh-process configuration regression checks importing the backend with dotenv disabled and placeholder CI configuration. The offline suites do not need a running MongoDB service.

No database migration, new payment behavior or new dependency was introduced.

## Measured build changes

Vite now separates React, Motion and Leaflet into reusable vendor chunks.

| Chunk | Before | After |
| --- | ---: | ---: |
| Application entry | 506.5 kB / 155.3 kB gzip | 156.0 kB / 44.3 kB gzip |
| Planner page | 318.3 kB / 86.6 kB gzip | 169.7 kB / 42.6 kB gzip |

React (~223.2 kB), Motion (~126.1 kB) and Leaflet (~149.7 kB) are now separate cacheable assets. The large-chunk warning is resolved. These numbers describe chunk boundaries and caching; they do not claim an equivalent reduction in total first-load network traffic.

## Main files

- Backend: `app/services/reroute_service.py`, `app/services/trip_consistency.py`, `app/api/trips.py`.
- Frontend: `src/hooks/useTravelApi.ts`, `src/services/routingService.ts`, `src/components/tabs/DayDetailView.tsx`, `RouteDirectionsDrawer.tsx`, `vite.config.ts`.
- CI: `.github/workflows/ci.yml`.
- Regressions: `Backend/routing_reliability_tests.py`, `Backend/run_regressions.py`, `Frontend/tests/routing.test.ts`, `Frontend/e2e/reliability.spec.ts`.

## Verification

- TypeScript checks passed.
- All 40 frontend unit tests passed, including shared-request cancellation, cache isolation/recovery, response-body timeout and coordinate/transport classification.
- All 11 backend suites passed (173 tests/scenarios across their summaries), including 11 new reliability cases and a fresh-process CI-configuration import. The final focused reliability rerun also passed all 11 cases.
- Ten final focused desktop/mobile browser checks passed for full browser storage, pending progress, pending reroute acceptance, missing coordinates, long road journeys and driving/cab reuse.
- Production build passed without the former large-chunk warning.
- All 98 full-suite desktop/mobile browser regressions passed before the final cache-full check was added. The final ten affected checks passed on the latest frontend build, bringing unique browser coverage to 100 checks.

Browser checks use authenticated fixture APIs; backend regressions use deterministic provider/database substitutes. Live provider availability, credentials and an actual GitHub Actions run were not verified. Restart the backend and frontend development processes to load these changes.
