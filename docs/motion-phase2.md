# TravelAI motion: Phase 2

Phase 2 adds the approved travel signatures and a schedule-based Companion countdown. It builds on Phase 1; Phase 3 presentation changes remain excluded.

## Files and behavior

| Group | Files | Purpose |
| --- | --- | --- |
| Countdown | `Frontend/src/components/CompanionCountdown.tsx`, `Frontend/src/motion/countdown.ts` | Isolated clock updates, subtle changed digits, explicit timezone validation and honest unavailable/past states. |
| Journey feedback | `Frontend/src/motion/useCompanionMotion.ts`, `rerouteDiff.ts`, `tokens.ts` | Confirmed completion/Undo feedback, one-time event consumption, server snapshot comparisons and shared route timing. |
| Map reveal | `Frontend/src/motion/routeMotion.ts`, `Frontend/src/components/tabs/DayMapView.tsx` | Cancellable SVG masks preserving dashed strokes, capped marker stagger, per-trip/day replay suppression and in-place leg selection. |
| Screen integration | `Frontend/src/components/tabs/CompanionMode.tsx`, `DayDetailView.tsx`, `RouteDirectionsDrawer.tsx` | Compact upcoming-stop counter, progress transforms, stable timeline IDs, reroute row transitions and selected-leg emphasis. |
| Data compatibility | `Frontend/src/types/index.ts`, `Frontend/src/services/api.ts` | Optional explicit `scheduleTimezone` independent of the existing display default, and preservation of saved per-stop dates. Existing API contracts are unchanged. |
| Verification | `Frontend/tests/countdown.test.ts`, `Frontend/e2e/journey.spec.ts`, `Frontend/e2e/fixtures/journey.ts` | Timezone/DST boundaries, clock recovery, confirmed feedback, map lifecycle and reroute compatibility. |

## Timing and safety

- The timer targets the first unfinished stop on the selected day. It never auto-completes, skips or reschedules activities.
- Start times use saved per-stop dates and timezones. Non-airport stops may use an explicitly supplied trip timezone; airport stops require their own. The display fallback to India is never accepted as verified timing.
- Invalid dates, missing times, invalid zones, repeated daylight-saving hours and daylight-saving gaps produce an unavailable counter with the saved schedule information.
- A real clock calculation runs inside the timer component, once per second within 24 hours and once per minute farther out. Hidden tabs pause scheduling and recalculate on return. Screen readers receive readable scheduled-start information rather than per-second announcements.
- Restored completion states, day switching and reduced-motion changes never replay a consumed feedback event. New feedback follows existing confirmed API results only.
- Route drawing lasts at most 550ms. Markers use the Phase 1 content duration and at most 160ms total stagger. Fallback geometry stays dashed and receives only a fade; flight dash styling remains intact.
- Leg selection updates existing Leaflet paths without rebuilding or recentering the map. View changes, map movement and disposal cancel drawing and remove masks.
- Reroute transitions follow server activity IDs and timing/coordinate changes. Completed/in-progress rows are excluded. Legacy `skip_only` acceptance shows confirmation without row movement.

## Checks and previews

Use `npm run lint`, `npm test`, `npm run build` and `npm run test:e2e` in `Frontend`.

Final results: TypeScript passed; all 34 unit tests passed; the production build passed; all 80 desktop/mobile browser checks passed. After the final timing-label presentation adjustment, the 8 affected reroute/preview checks passed again against a fresh production build. A day-switch completion-replay regression found during verification was fixed and verified on both screen sizes. `git diff --check` passed.

Unit tests include Australian/Indian/Nepalese timezones, airport timezone boundaries, malformed schedules, New York and Lord Howe DST transitions, countdown formatting, reroute identity comparisons and route replay suppression. Browser checks use synthetic API fixtures on desktop Chromium and Pixel 7 emulation. They do not edit real trip/account data or contact booking/payment providers.

Screenshots and short WebM recordings are under `.cache/motion-phase2/` and are ignored by Git. The existing build warning for a JavaScript chunk over 500 kB remains; no new animation dependency is installed.

## Visual inspection

1. On an itinerary with explicit activity dates, times and timezones, open Companion and watch the small upcoming-stop countdown.
2. Complete a stop, reload, switch days and Undo: only a newly confirmed action should animate.
3. Open a day map and choose legs: route reveals should be brief, and leg selection should preserve your map view.
4. Review and accept a reroute: changed rows receive local feedback. Legacy untimed trips keep their saved schedules.
5. Enable reduced motion: counters update directly, and route/checkmark/layout drawing is disabled.

No backend API, database schema, pricing or access-rule changes are included. Phase 3 requires separate approval.
