# Plan, My Trip and Companion

TravelAI uses separate full-width planning and trip review screens at every screen size. There is no automatic chat/itinerary split or chat drawer. Before generation, Plan is the main screen; a generated itinerary opens My Trip.

Plan provides a conversation, a compact preference summary and one Trip details form. Two suggested actions are shown initially; More suggestions reveals the rest. The message list scrolls independently while the input remains visible. Developer intent labels and API paths are hidden from the traveler interface.

My Trip provides Overview, Days & map, Flights, Hotels, Weather and Budget. It uses a compact Plus status badge, one Companion action and a More actions menu for exports and sharing. Selection and confirmed demo booking remain separate states. Existing payment and Companion access checks are preserved.

Edit with AI calls authenticated POST /api/trips/{id}/edit-session. The server verifies trip ownership and reuses an owned conversation linked to that trip with matching destination context. Older trips receive a correctly linked, seeded conversation. Opening the session does not regenerate or modify the trip. A conversation about another destination is never reused as its editing conversation.

Plan and My Trip remain mounted while hidden so ongoing requests and local view state survive navigation. URL parameters retain the view, trip ID and trip tab. Session storage retains per-user/conversation drafts and per-trip day, overview/details mode and scroll position. Returning from editing restores the selected trip view. Async conversation loads ignore superseded responses.

Trip details supports keyboard focus containment, Escape and focus restoration. The form stays within the viewport and scrolls on small screens. Laptop navigation uses a compact rail; mobile navigation retains its drawer. The itinerary follows page scrolling without a fixed-height directions panel.

Map and directions appear side by side only when their section is at least 960 CSS pixels wide, reserving 320px for directions. Otherwise directions follow the map. Map height adapts between 300px and 520px. Leaflet CSS is bundled locally; ResizeObserver recalculates map dimensions and route bounds after layout changes.

Verification includes backend edit-session ownership and reuse tests, frontend unit tests, TypeScript, a production build and desktop/mobile browser checks for generation, editing, refresh, bookings, exports and access. Layout coverage includes 1280x720, 1366x768, 1440x900, 1536x864, 1920x1080, tablet, mobile and zoom-equivalent sizes. Live application checks additionally verify owned session reuse, correct trip context, draft recovery and unchanged itinerary data.

Current live application screenshots are generated under .cache/simple-ui/ for laptop, desktop and mobile. Automated fixture previews are under .cache/layout-previews/. These local artifacts are ignored by Git.
