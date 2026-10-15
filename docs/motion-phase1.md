# TravelAI motion: Phase 1

This phase adds shared interaction polish. Route drawing, Companion completion choreography, reroute row movement and secondary-page presentation remain reserved for later approval.

## Changed files

| Group | Files and purpose |
| --- | --- |
| Motion foundation | `Frontend/src/motion/tokens.ts`, `MotionProvider.tsx`, `motion.css`: shared 120/180/240ms timing, easing, reduced motion, button feedback and keyboard focus. |
| Local helpers | `Frontend/src/motion/ActiveIndicator.tsx`, `useInteractionMotion.ts`, `usePopoverFocus.ts`: shared selection backgrounds, cancellable opacity/message entrances and dropdown focus management. |
| App integration | `Frontend/src/main.tsx`, `App.tsx`, `pages/PlannerStudioPage.tsx`: provider and local navigation transitions without remounting chat. |
| Navigation and tabs | `Frontend/src/components/Sidebar.tsx`, `Header.tsx`, `DashboardPanel.tsx`: moving selection highlights, menus, mobile navigation accessibility and tab fades. |
| Chat and dialogs | `Frontend/src/components/ChatPanel.tsx`, `ApiConfigModal.tsx`, `preferences/TripDetailsDialog.tsx`, `hooks/useModalFocus.ts`: live-message entrances, suggestions, composer feedback, dialog entrances and focus management. |
| Decorative status cleanup | `Frontend/src/components/tabs/CompanionMode.tsx`, `DayMapView.tsx`: remove perpetual decorative pulses; add only reroute-dialog entrance/focus behavior. No route or completion animations added. |
| Tests | `Frontend/tests/motion.test.ts`, `Frontend/e2e/motion.spec.ts`, `e2e/layout.spec.ts`, `e2e/fixtures/layout.ts`: message replay safety, accessibility, reduced motion, layout regressions and visual captures. |

## Interaction contract

- Chat messages animate only when appended during a live request. Initial history, restored conversations and hidden chat do not replay entrances.
- Plan and My Trip remain mounted. View fades do not introduce keys, change scrolling behavior or transform map containers.
- Controls remain interactive during entrances. Closing a dialog immediately unmounts it, releases its scroll lock and restores focus.
- Mobile navigation is inert while closed. Dropdowns retain normal Tab navigation and support Escape.
- Motion respects reduced-motion preferences, including existing CSS loops and portal-based controls. Leaflet retains control over marker and map transforms.
- Payment, booking, progress and reroute state changes continue to use existing server responses. Backend files, APIs, dependencies and database schemas are unchanged.

## Validation and previews

Commands: `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` from `Frontend`.

Results: TypeScript passed; 26 unit tests passed; all 60 browser regressions passed. After the final portal-control styling adjustment, the 18 affected desktop/mobile motion and layout checks passed again against a fresh production build. `git diff --check` passed.

Browser coverage runs on desktop Chromium and Pixel 7 emulation with mocked API responses. It covers booking/payment regressions, history and drafts, maps at laptop/mobile and zoom-equivalent sizes, keyboard focus, reroute cancellation, rapid tab changes, reduced motion and new-message replay prevention. These checks do not modify real account data or call external providers.

Local screenshots and WebM recordings are in `.cache/motion-phase1/`. Artifacts use synthetic Sydney fixture data and are ignored by Git. The build retains the existing warning about a JavaScript chunk larger than 500 kB; this phase adds no animation library.

## Visual review

1. Change trip tabs and sidebar destinations: highlights should move briefly without bounce.
2. Open Trip details, API Settings, profile and navigation: check smooth entrances, Escape and focus return.
3. Send a message, return from My Trip and refresh: only new messages should animate; drafts and history should remain intact.
4. Use More suggestions: input remains visible and controls keep their normal layout.
5. Enable reduced motion in the operating system: spatial motion and decorative loops should stop.

Phase 1 ends here. Phases 2 and 3 require separate approval.
