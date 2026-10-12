"""Builds TravelAI_SRS.docx — an IEEE Std 830-1998 / ISO-IEC-IEEE 29148 style
Software Requirements Specification for the TravelAI system.

Every technical claim in this document was verified against the repository at
C:/Users/pares/TravelAI (source manifest and test evidence in
audit_evidence.json). Where the implementation diverges from an idealised
design, the document states what the code actually does.

Run:  python generate_srs.py   (from docs/academic/)
"""
import json
import os

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

import docx_helpers as H

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, 'figures')
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'TravelAI_SRS.docx')

with open(os.path.join(HERE, 'audit_evidence.json'), encoding='utf-8') as fh:
    EVIDENCE = json.load(fh)
SOURCE_FILES = len(EVIDENCE['source_manifest'])
AUDIT_DATE = EVIDENCE['audited_at_utc'][:10]


def h(doc, level, text):
    return doc.add_heading(text, level=level)


def para(doc, text, **kw):
    return H.body(doc, text, **kw)


def fr_card(doc, fr):
    h(doc, 3, f"{fr['id']} — {fr['title']}")
    H.kv_table(doc, [
        ('Requirement ID', fr['id']),
        ('Title', fr['title']),
        ('Category', fr['category']),
        ('Priority', fr['priority']),
        ('Preconditions', fr['pre']),
        ('Input Data', fr['input']),
        ('Processing Logic', fr['proc']),
        ('Expected Output', fr['output']),
        ('Acceptance Criteria', fr['accept']),
        ('Verification Method', fr['verify']),
    ])
    doc.add_paragraph()


# --------------------------------------------------------------------------
# Functional requirement catalogue (all fields code-grounded)
# --------------------------------------------------------------------------
FRS = [
 dict(id='FR-001', title='Traveler Account Registration', category='Security', priority='P2',
  pre='Backend running; MongoDB reachable; unique e-mail address.',
  input='POST /api/auth/register with JSON {name, email, password}.',
  proc='E-mail is lower-cased for uniqueness; a 16-byte random salt is generated; the password is stretched with PBKDF2-HMAC-SHA256 (100,000 iterations); {password_hash, salt} are stored in the users collection. Plain passwords are never persisted.',
  output='200 with the created user profile, or 400 when the e-mail already exists.',
  accept='A registered user can authenticate afterwards; the stored document contains no reversible password material.',
  verify='Code inspection of app/api/auth.py and app/utils/auth_utils.py; manual testing (no automated suite exists for auth).'),

 dict(id='FR-002', title='Login and Session Token Issuance', category='Security', priority='P2',
  pre='Account created under FR-001.',
  input='POST /api/auth/login with {email, password}.',
  proc='The stored PBKDF2 hash is recomputed and compared in constant time. On success the server issues a token that is a SHA-256 digest of user identity and timing data.',
  output='200 {token, user}; 401-equivalent error response on bad credentials.',
  accept='Correct credentials return a token; incorrect credentials never return one.',
  verify='Code inspection. Known gap: no endpoint validates the issued token; downstream endpoints trust the client-supplied x-user-id header (see Section 11).'),

 dict(id='FR-003', title='Conversational Travel Intake', category='Core Function', priority='P1',
  pre='Browser session open; API base URL configured.',
  input='POST /api/chat/message with a natural-language traveler message and a conversation id.',
  proc='chat_service routes the message; slot_extraction_service invokes the Groq model qwen/qwen3.8-27b (temperature 0) to extract destination, dates, budget, party size and preferences; conversation and message documents are persisted in MongoDB.',
  output='Assistant reply JSON with detected intent and any structured travel context; conversation history retrievable via GET /api/chat/conversations.',
  accept='A message such as "5 days in Paris for under 2000 EUR" yields a structured context containing those slots.',
  verify='Manual UI testing through the Planner Studio; LLM behaviour is non-deterministic in content but deterministic in slot schema.'),

 dict(id='FR-004', title='Intent Classification', category='Core Function', priority='P1',
  pre='FR-003 context available.',
  input='Traveler message plus conversation state.',
  proc='The LLM classifies the message into GENERATE_ITINERARY, MODIFY_ITINERARY, or question-answering intents; GENERATE_ITINERARY can invoke the same compiled LangGraph pipeline as the structured form.',
  output='Routed handler response; MODIFY_ITINERARY currently produces a narrative acknowledgement only — it does not mutate a stored itinerary.',
  accept='Generation requests reach the pipeline; modification requests return a coherent reply without altering persisted trips.',
  verify='Manual testing; the narrative-only behaviour of MODIFY_ITINERARY is documented as a limitation (Section 16).'),

 dict(id='FR-005', title='Structured Trip Planning Request', category='Core Function', priority='P1',
  pre='Travel context collected via form or chat.',
  input='POST /api/trips/plan with destination, duration, dates, budget, budget mode, travelers, interests, travel style, pace profile.',
  proc='FastAPI validates the payload with Pydantic v2 and invokes the compiled LangGraph state machine (FR-006).',
  output='TripResponse containing generated route_details, flights, hotels, weather, budget overview and an embedded execution_state with revision 1.',
  accept='A valid request returns HTTP 200 with a non-empty day_by_day_route; an invalid payload returns 422 from Pydantic validation.',
  verify='itinerary_engine_audit_tests.py (6 scenarios) exercises the generation path end-to-end with mocked external calls.'),

 dict(id='FR-006', title='LangGraph Agent Orchestration', category='Core Function', priority='P1',
  pre='Valid planning payload (FR-005).',
  input='Initial graph state: travel context and user identifier.',
  proc='parser_agent → planner_agent → parallel fan-out to flight, hotel, weather, attraction and restaurant agents → budget_agent → route_agent → reviewer_agent → synthesis_agent → END. The reviewer→planner retry edge is wired but presently unreachable after the single planner step.',
  output='Final graph state carrying all collected artefacts and the synthesized narrative.',
  accept='Every node executes exactly once per request in the stated order; a failing specialist degrades to its fallback tier rather than aborting the graph.',
  verify='Code inspection of app/ai/orchestrator/langgraph_graph.py; itinerary_engine_audit_tests.py Scenario E (missing-data resilience).'),

 dict(id='FR-007', title='Flight Information Retrieval', category='Integration', priority='P2',
  pre='SerpApi key configured (GOOGLE_FLIGHTS_API_KEY).',
  input='Origin, destination and departure date from the travel context.',
  proc='flight_agent queries SerpApi Google Flights. dataStatus is one of search_results, no_flights_found, historical_record, error; historical_record denotes an empty classification for past dates, not retrieval of an archive.',
  output='FlightOption list: airline, number, times, airports, duration, stops, price per person and total, booking deep links.',
  accept='A live search returns at least one priced option for a major city pair; failures surface dataStatus=error without crashing the graph.',
  verify='Manual testing against the live API; dynamic_reroute_tests.py mocks SerpAPI for deterministic behaviour.'),

 dict(id='FR-008', title='Hotel Recommendation', category='Integration', priority='P2',
  pre='SerpApi key configured.',
  input='Destination city from the travel context.',
  proc='hotel_agent queries SerpApi Hotels with fixed parameters: check-in = today + 30 days, two adults, regardless of the traveler’s actual dates or party size. If the search fails entirely, a synthetic entry "Grand Heritage Hotel" with plausible placeholder data is emitted.',
  output='HotelOption list with name, location, rating, review count, nightly and total price, image, booking policy fields.',
  accept='Recommendations render in the Bookings Desk; the synthetic fallback is labelled in code review as a known fidelity limitation.',
  verify='Code inspection of app/ai/agents/hotel_agent.py; documented in Sections 11–16.'),

 dict(id='FR-009', title='Destination Weather Forecast', category='Integration', priority='P2',
  pre='Internet access to api.open-meteo.com.',
  input='Destination coordinates resolved via Nominatim.',
  input_note='',
  proc='weather_agent calls Open-Meteo forecast endpoints and maps daily bars to the itinerary date window.',
  output='WeatherCondition: current temperature, feels-like, humidity, wind, UV, plus a per-day high/low and rain-chance forecast.',
  accept='Dashboard Weather tab renders a 7-day bar chart consistent with the destination.',
  verify='Manual testing; the agent participates in the parallel fan-out covered by FR-006 tests.'),

 dict(id='FR-010', title='Attraction Discovery with Multi-Tier Fallback', category='Integration', priority='P1',
  pre='At least one of Groq, SerpApi, Overpass or Nominatim reachable.',
  input='Destination, interests, must-visit list, travel style.',
  proc='attraction_agent tries layers in order — Groq LLM candidates, SerpApi Google Maps places, Overpass OpenStreetMap POIs, Nominatim geocoding — stopping at the first non-empty tier. OSM-derived entries receive a default rating of 4.5 when no rating exists; an unresolvable destination can fall back to a hard-coded Delhi geocode.',
  output='all_attractions: title, category, coordinates, place_id, rating, review count, recommended visit duration, priority rank, matched interest, fame level, why-visit text.',
  accept='A Goa-style request with a declared must-visit yields that attraction at top priority; an unknown destination still produces a structured (possibly Delhi-centred) list without an exception.',
  verify='itinerary_engine_audit_tests.py Scenarios A and E; code inspection of attraction_agent.py.'),

 dict(id='FR-011', title='Restaurant Discovery', category='Integration', priority='P2',
  pre='SerpApi or Overpass reachable.',
  input='Destination and cuisine interests.',
  proc='restaurant_agent applies the same tiered strategy (LLM → SerpApi Google Maps → Overpass) and tags meal sub-type (breakfast/lunch/dinner suitability) used by the scheduler and reroute engine.',
  output='Candidate restaurants with coordinates, price level, cuisine and operating metadata.',
  accept='Meal replacement in FR-018 can find a same-purpose candidate for each meal window.',
  verify='phase2_1_reroute_tests.py Scenario A (meal-aware reroute) and dynamic_reroute_tests.py (tiered discovery with mocked layers).'),

 dict(id='FR-012', title='Budget Allocation', category='Core Function', priority='P2',
  pre='Total budget and flight quotes available.',
  input='Traveler budget, budget mode, traveler count, flight prices.',
  proc='budget_agent computes a partial allocation: flights = fare × travelers × 2 (assumed return), accommodations and gastronomy shares by fixed ratios, remainder to an unallocated Safety Reserve. Actual activity pricing is not summed into the allocation.',
  output='BudgetOverview with breakdown items, percentages, consumption percentage and a savings insight string.',
  accept='Allocated amounts plus buffer equal the declared total; percentages sum to 100.',
  verify='Code inspection; Budget tab rendering verified manually. Partial-model status recorded in Section 16.'),

 dict(id='FR-013', title='Time-Aware Daily Scheduling', category='Core Function', priority='P1',
  pre='Attractions, restaurants, hotels and dates available.',
  input='Pace profile (relaxed/balanced/packed), destination name, authoritative start/end dates, candidate POIs.',
  proc='route_agent resolves an IANA zone by substring match on the destination name (default Asia/Kolkata), derives an inclusive day count from the date range (overriding a conflicting duration), classifies arrival/exploration/departure days, then walks a cursor per day: visit durations 135/105/75 minutes by pace, wake 08:30/08:00/07:30, lunch anchored at max(12:30, cursor), dinner at max(19:30, cursor), a 45-minute hotel breakfast, and Haversine transit estimates (walking 4.5 km/h under 1 km, else driving at 25 km/h, minimum 10 minutes). Bedtime acts as a recommendation, not a hard stop, during initial generation.',
  output='route_details.day_by_day_route with ordered ActivitySegment stops carrying start/end times, transit metadata and day classification.',
  accept='A Paris relaxed plan places lunch near 12:30 local and respects the Europe/Paris zone; a 6-day date range overrides days=3 to produce 6 days.',
  verify='itinerary_engine_audit_tests.py Scenarios B, C, D and F.'),

 dict(id='FR-014', title='Client-Side Street Routing and Map Rendering', category='UI', priority='P2',
  pre='Browser with network access to router.project-osrm.org and OSM tile servers.',
  input='Ordered stops with coordinates for a selected day.',
  proc='routingService.ts requests OSRM driving/walking/cab geometry per leg, with a 7-second abort timeout; legs over 500 km are labelled "flight"; Leaflet renders polylines and markers. The backend never calls OSRM — server-side transit is Haversine-only.',
  output='Rendered route map with real street geometry, leg distances/durations and Google Maps fallback URLs.',
  accept='Day detail view shows street-accurate polylines; on OSRM failure the leg status degrades to fallback straight-line geometry.',
  verify='Manual browser testing; code inspection of Frontend/src/services/routingService.ts.'),

 dict(id='FR-015', title='Trip Persistence, History and Deletion', category='Data Management', priority='P1',
  pre='Generated trip or client-authored trip payload.',
  input='Trip document; optional x-user-id header.',
  proc='POST /api/trips/plan inserts the generated trip (revision defaults to 1). GET /api/trips/history returns the newest 10 trips filtered by user_id when the header is present. DELETE /api/trips/{id} removes the document.',
  output='Saved trip list in the Itinerary Hub; deleted trip disappears.',
  accept='A generated trip reappears in history after a page reload; deletion is idempotent.',
  verify='Manual testing; history query inspected in app/api/trips.py.'),

 dict(id='FR-016', title='Execution State Tracking', category='Data Management', priority='P1',
  pre='Trip exists with embedded execution_state.',
  input='POST /api/trips/{id}/execution_state with {is_active, current_day_number, activity_log}.',
  proc='The endpoint wholesale-replaces the stored execution_state sub-document; it performs no per-key merge. The frontend maintains the merged activity_log (persistent id + legacy keys) before sending.',
  output='200 with the persisted state; failures leave the previous document intact.',
  accept='Marking an activity completed, then reloading, preserves the status; undo removes all keys for that activity.',
  verify='activity_identity_audit_tests.py Tests 4 and 5; phase2_1_reroute_tests.py Scenario D (completed-stop preservation).'),

 dict(id='FR-017', title='Persistent Activity Identity', category='Data Management', priority='P1',
  pre='Any itinerary stop without a stable id.',
  input='Activity type, title, optional place_id.',
  proc='activity_identity.py builds slug-based identifiers act_{type}_{slug≤32}[_{place≤8}][_{disambiguator}] (not content hashing). Status lookup precedence is persistent id → canonical key → legacy "{day}_{index}" → legacy "day_{d}_act_{i+1}" → pending. The frontend dual-writes new statuses under both persistent and legacy keys and migrates legacy logs on read.',
  output='Stable per-stop identity surviving reordering, insertion and reroute.',
  accept='Reordering or inserting stops never transfers a completed status to a different attraction; generated reroute stops all carry act_-prefixed unique ids.',
  verify='activity_identity_audit_tests.py Tests 1–7 (all passing).'),

 dict(id='FR-018', title='Dynamic Reroute Preview (Skip & Replace)', category='Core Function', priority='P1',
  pre='An activity on the selected day marked skipped; trip id known.',
  input='POST /api/trips/{id}/reroute/preview with day_number, skipped_activity_id, optional current_location (GPS), expected_revision.',
  proc='reroute_service loads the trip, classifies the skipped stop’s purpose (meal sub-type by time: breakfast before 10:30, dinner from 17:00), applies a chronological cutoff (max of skip time and current time), searches candidate tiers, scores attractions as distance minus 8 for category match minus 4 for interest match, reserves meal windows 07:00–10:30 / 11:40–15:30 / 18:30–22:00 with 45/60/75-minute durations, falls back to a synthetic meal break, reschedules later stops with a +10-minute overlap guard, and wraps times modulo 24 hours. The proposal (id prop_{epoch}_{day}) is returned to the client and is not stored server-side.',
  output='RerouteProposal: proposal_id, replacement_found, skipped/replacement activity, original_stops, proposed_stops, rescheduled_stops, reason.',
  accept='Skipping a lunch produces a restaurant replacement inside the lunch window; skipping an attraction produces the nearest scoring candidate; no candidate yields replacement_found=false with a reschedule-only proposal.',
  verify='phase2_1_reroute_tests.py Scenarios A, G; dynamic_reroute_tests.py (14 scenarios) with mocked discovery tiers.'),

 dict(id='FR-019', title='Reroute Apply with Revision Control', category='Core Function', priority='P1',
  pre='A proposal from FR-018 held by the client.',
  input='POST /api/trips/{id}/reroute/apply with proposed_stops, skipped_activity_id, replacement_activity_id, reason, expected_revision.',
  proc='The server reads the trip, compares expected_revision to the stored revision, and on mismatch returns 409. On match it writes the new day stops, appends an accepted entry to reroute_history, and increments revision. The update filter does not include revision, so the check is read-check-write, not an atomic compare-and-set; concurrent applies can lose an update.',
  output='200 with updated route_details, execution_state and revision; or 409 stale-revision error.',
  accept='An apply with a stale expected_revision returns 409 and leaves the trip unchanged; a fresh apply increments revision by exactly 1 and records history.',
  verify='phase2_1_reroute_tests.py Scenario H; dynamic_reroute_tests.py conflict scenario (409 via stale revision).'),

 dict(id='FR-020', title='Companion Mode Live Guidance', category='UI', priority='P1',
  pre='Trip open in the dashboard.',
  input='Tap interactions (complete/skip/undo), navigator.geolocation one-shot fix.',
  proc='CompanionMode.tsx resolves the current unfinished stop, day progress percentage, and skipped list from the migrated execution log; Skip persists the status first (FR-016) and then requests a preview (FR-018); navigation opens a Google Maps deep link with origin=GPS fix and destination_place_id when available.',
  output='Live day view, progress bar, reroute preview modal, success/info banners.',
  accept='Progress reflects completed/total; cancelling a proposal clears the modal locally with no server record (verified behaviour, see Section 10).',
  verify='Manual browser testing; server-side behaviours covered by reroute suites.'),

 dict(id='FR-021', title='RAG-Enhanced Travel Q&A', category='Integration', priority='P3',
  pre='Ollama running locally with nomic-embed-text; ChromaDB populated (collection travel_knowledge, WikiVoyage India guides).',
  input='Question about destinations covered by ingested guides.',
  proc='qa_service embeds the query via Ollama, retrieves top Chroma passages, and composes an LLM answer with live-data context. The retrieval chain is not part of the itinerary generation graph.',
  output='Grounded natural-language answer in chat.',
  accept='An India-destination question cites guide-derived content; with Ollama offline the service degrades to non-RAG answering.',
  verify='Code inspection of app/ai/rag/* and qa_service.py; manual chat testing.'),

 dict(id='FR-022', title='Places Memory', category='UI', priority='P3',
  pre='Browser session.',
  input='Place entries curated by the traveler (name, category, note, price, rating).',
  proc='Frontend-managed list persisted in localStorage under TRAVELAI_* keys; no server synchronisation exists.',
  output='Places Memory panel listing saved places.',
  accept='Entries survive a reload on the same browser profile.',
  verify='Manual testing; storage inspection of localStorage.'),

 dict(id='FR-023', title='Bookings Desk', category='UI', priority='P2',
  pre='Flights (FR-007) and hotels (FR-008) retrieved.',
  input='Selected trip context.',
  proc='Frontend tab presenting flight options with booking deep links and hotel cards; selection state is client-side; POST /api/trips/flights/search supports re-querying.',
  output='Rendered flight/hotel cards with prices and policies.',
  accept='Booking URLs open Google Flights/Hotels for the displayed option.',
  verify='Manual browser testing.'),

 dict(id='FR-024', title='API Status Indicator and Client Resilience Cache', category='UI', priority='P3',
  pre='Frontend served from any origin.',
  input='Pings to the configured API base URL.',
  proc='useTravelApi.ts tracks connection state (mode: live | mock-fallback), caches chat, context and execution data in localStorage under TRAVELAI_* keys, and allows a declared API base URL override.',
  output='Visible connection badge; cached data shown when the backend is unreachable.',
  accept='Stopping the backend flips the badge to mock-fallback without losing locally cached state.',
  verify='Manual testing with the backend stopped.'),
]

NFRS = [
 ('NFR-001 (PERF)', 'LLM call containment', 'Every Groq call is bounded by a process-local token coordinator: a rolling budget of 1,000 output tokens per 60 seconds, a concurrency semaphore of 1, a default max_tokens of 400, a 20-second timeout and one retry, at temperature 0.', 'Bounded worst-case latency and spend per request; verified by code inspection of app/ai/llm.py.'),
 ('NFR-002 (PERF)', 'Client routing latency ceiling', 'OSRM leg requests abort after 7 seconds and fall back to straight-line geometry so the map always renders.', 'Manual test with an OSRM endpoint blackholed.'),
 ('NFR-003 (REL)', 'Tiered data-source resilience', 'Discovery for attractions, restaurants, hotels and flights degrades through independent tiers (LLM → SerpApi → Overpass → Nominatim); a single provider outage cannot abort the graph.', 'itinerary_engine_audit_tests.py Scenario E; dynamic_reroute_tests.py mocked-tier scenarios.'),
 ('NFR-004 (REL)', 'Graceful persistence failure', 'Frontend execution-state writes fall back to localStorage caching with a visible non-blocking error banner; the session continues.', 'Manual test with backend stopped.'),
 ('NFR-005 (CONS)', 'Identity stability', 'Activity status survives reordering, insertion and reroute because identity is a content-derived slug, not a positional index (FR-017).', 'activity_identity_audit_tests.py Tests 1–7.'),
 ('NFR-006 (CONS)', 'Optimistic concurrency (partial)', 'Reroute apply compares expected_revision and rejects stale writes with 409. The comparison is not an atomic CAS, so a narrow lost-update window remains between read and write (Section 8.4).', 'dynamic_reroute_tests.py 409 scenario; race window documented by inspection.'),
 ('NFR-007 (SEC)', 'Password storage', 'PBKDF2-HMAC-SHA256, 100,000 iterations, 16-byte per-user salt, constant-time comparison.', 'Code inspection of auth_utils.py.'),
 ('NFR-008 (SEC)', 'Authorisation exposure', 'No server-side validation of issued tokens occurs; trip endpoints trust a client-supplied x-user-id header. This is an accepted academic-project constraint, recorded as a limitation rather than a requirement the system meets.', 'Penetration-style manual test: a foreign user id can read and mutate another user’s trip if the id is known (Section 11).'),
 ('NFR-009 (SEC)', 'Secret containment', 'Provider keys live only in Backend/.env (git-ignored); no secret values appear in source, logs or this document.', 'Grep audit of the repository.'),
 ('NFR-010 (USA)', 'Responsive companion UX', 'Companion Mode, day selector, progress bar and modals operate on desktop and mobile viewports without page reloads.', 'Manual browser testing at 375 px and 1,440 px.'),
 ('NFR-011 (USA)', 'Status transparency', 'Every mutation gives immediate feedback: banners for success, info and error; the connection badge distinguishes live from cached mode.', 'Manual testing.'),
 ('NFR-012 (MAINT)', 'Layered modularity', 'Routers, services, agents, orchestrator, models and utils are separate packages; reroute logic is isolated in reroute_service.py, enabling the mocked unit suites.', 'Repository structure; test import paths.'),
 ('NFR-013 (MAINT)', 'Regression harness', 'Four standalone Python suites (37 scenarios) run without a live database by monkeypatching discovery and persistence boundaries.', 'Section 15 evidence table.'),
]

USE_CASES = [
 ('UC-01', 'Plan a Complete Trip from the Form', 'Traveler',
  'Backend and MongoDB running.',
  ['1. Traveler submits destination, dates, budget, party, interests and pace.',
   '2. POST /api/trips/plan validates the payload (FR-005).',
   '3. The LangGraph pipeline collects flights, hotels, weather, attractions and restaurants (FR-006–FR-011).',
   '4. budget_agent allocates shares (FR-012); route_agent schedules each day (FR-013).',
   '5. reviewer and synthesis finalize the narrative; the trip is inserted with revision 1.',
   '6. The SPA renders the dashboard and Companion Mode (Figure 5).'],
  ['3a. A provider fails: that agent returns its fallback tier or empty collection; the pipeline continues.',
   '5a. Insert fails: HTTP 500 is returned; nothing is persisted.'],
  ['A persisted trip document with a complete day_by_day_route and execution_state.']),
 ('UC-02', 'Generate Through Conversation', 'Traveler',
  'Active chat session.',
  ['1. Traveler describes the trip in natural language.',
   '2. Slots are extracted and the intent GENERATE_ITINERARY is detected (FR-003, FR-004).',
   '3. The same compiled graph is invoked; results return as a rich chat card.'],
  ['2a. Ambiguous slots: the assistant asks a clarifying question instead of generating.'],
  ['Trip generated and conversation persisted.']),
 ('UC-03', 'Track Day Execution', 'Traveler', 'Trip open in Companion Mode.',
  ['1. Traveler taps Complete on the current stop.',
   '2. The frontend dual-writes the status under the persistent id and legacy keys (FR-017).',
   '3. POST /execution_state replaces the stored state (FR-016).',
   '4. Progress bar and next-stop card update.'],
  ['3a. Backend unreachable: localStorage cache retains the change; an error banner offers retry.'],
  ['Durable per-stop status.']),
 ('UC-04', 'Skip a Stop and Accept a Reroute', 'Traveler', 'A pending stop exists on the selected day.',
  ['1. Traveler taps Skip; the skip persists (UC-03 steps).',
   '2. POST reroute/preview returns a proposal (FR-018, Figure 6).',
   '3. Traveler taps Accept; POST reroute/apply sends proposed_stops with expected_revision.',
   '4. Server verifies revision, writes the day, appends history, increments revision (FR-019).',
   '5. The dashboard re-renders with the replacement stop.'],
  ['4a. Revision mismatch: 409 returned; the client shows a refresh prompt and the trip is unchanged.'],
  ['Updated itinerary with an auditable accepted reroute_history entry.']),
 ('UC-05', 'Skip a Stop and Keep the Original Schedule', 'Traveler', 'A proposal modal is open.',
  ['1. Traveler taps "Keep schedule".',
   '2. The modal clears locally; no server call is made and no rejection record exists.'],
  [],
  ['The stop remains skipped in execution_state; the itinerary text is untouched.']),
 ('UC-06', 'Review and Manage Saved Trips', 'Traveler', 'At least one saved trip.',
  ['1. GET /api/trips/history lists the ten newest trips for the header-supplied user.',
   '2. Traveler opens a trip in the dashboard or deletes it (DELETE /api/trips/{id}).'],
  ['1a. No x-user-id header: the endpoint returns the ten newest trips across all users.'],
  ['Trip selection or removal completed.']),
]


def build_cover(doc):
    for _ in range(4):
        doc.add_paragraph()
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('TravelAI'); r.font.size = Pt(44); r.font.bold = True
    r.font.color.rgb = RGBColor.from_string(H.NAVY)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('Software Requirements Specification'); r.font.size = Pt(24); r.font.bold = True
    r.font.color.rgb = RGBColor.from_string(H.ACCENT)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('An AI-Orchestrated, Time-Aware Travel Planning and Live Rerouting System')
    r.font.size = Pt(13); r.font.italic = True
    doc.add_paragraph()
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('Prepared in accordance with IEEE Std 830-1998 and ISO/IEC/IEEE 29148:2018')
    r.font.size = Pt(11)
    for _ in range(3):
        doc.add_paragraph()
    lines = ['[Student Name]', '[Roll Number]',
             '[Programme / Branch, Semester]', '[Department, Institute / University]',
             '[Guide Name]', 'October 2026']
    for i, t in enumerate(lines):
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(t)
        r.font.size = Pt(14 if i < 2 else 12)
        r.font.bold = i < 2
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('Version 1.2 — Revision covering Phase 1, Phase 2 and Phase 2.1 milestones')
    r.font.size = Pt(10); r.font.color.rgb = RGBColor.from_string(H.MUTED)


def build_front_matter(doc):
    h(doc, 1, 'Document Control')
    h(doc, 2, 'Document Identification')
    H.kv_table(doc, [
        ('Document title', 'TravelAI — Software Requirements Specification'),
        ('Document ID', 'TRAVELAI-SRS-1.2'),
        ('Standard followed', 'IEEE Std 830-1998 structure aligned with ISO/IEC/IEEE 29148:2018 content quality requirements'),
        ('System under specification', 'TravelAI (FastAPI + LangGraph backend, React 19 single-page frontend, MongoDB persistence)'),
        ('Repository baseline', f'Working tree at C:/Users/pares/TravelAI, branch {EVIDENCE["branch"]} at commit {EVIDENCE["head"][:10]}, audited {AUDIT_DATE}; {SOURCE_FILES} source files hashed (audit_evidence.json)'),
        ('Status', 'Complete; every requirement statement is traceable to implemented code or to an executed test scenario'),
    ])
    h(doc, 2, 'Revision History')
    H.table(doc, ['Version', 'Date', 'Milestone', 'Summary of change', 'Author'], [
        ['0.1', '[date]', 'Draft', 'Initial skeleton following IEEE 830.', '[Name]'],
        ['1.0', '[date]', 'Phase 1', 'Chat-driven planner, LangGraph pipeline, trip persistence, dashboard tabs.', '[Name]'],
        ['1.1', '[date]', 'Phase 2', 'Persistent activity identity, execution-state tracking, Companion Mode, legacy migration with dual-write.', '[Name]'],
        ['**1.2', f'**{AUDIT_DATE}', '**Phase 2.1', '**Dynamic Skip & Replace rerouting (preview/apply), revision control, four regression suites (37 scenarios), full empirical audit.', '[Name]'],
    ], widths=[0.8, 1.0, 1.0, 3.0, 0.9])
    h(doc, 2, 'Reviewers and Approvers')
    H.table(doc, ['Role', 'Name', 'Responsibility', 'Signature'], [
        ['Author', '[Student Name]', 'Specification content and evidence', '[  ]'],
        ['Project guide', '[Guide Name]', 'Academic review', '[  ]'],
        ['External examiner', '[Name]', 'Viva verification', '[  ]'],
    ], widths=[1.4, 1.8, 2.4, 1.0])
    h(doc, 2, 'Abstract')
    para(doc,
         'TravelAI is a full-stack, AI-orchestrated travel planning system that generates day-level, '
         'time-aware itineraries and then adapts them while the traveler is actually on the road. A React 19 '
         'single-page application collects traveler intent either conversationally or through a structured '
         'form; a FastAPI backend drives a LangGraph state machine whose parser, planner, five parallel '
         'specialist agents, budget, route, reviewer and synthesis nodes assemble the plan. Factual content is '
         'drawn through a deliberate multi-tier fallback chain — a Groq-hosted large language model, SerpApi '
         'Google search surfaces, Overpass OpenStreetMap and Nominatim — so that a single provider outage '
         'degrades quality but never aborts generation. The scheduling engine resolves IANA time zones, applies '
         'pace profiles, meal templates and Haversine-based transit buffers, and treats authoritative date '
         'ranges over declared durations. The Phase 2.1 contribution is a Skip & Replace rerouting subsystem: '
         'when a traveler skips a stop, the server classifies the stop’s purpose, searches equivalent '
         'candidates inside purpose-aware time windows, scores them by distance, category and interest, and '
         'returns an ephemeral proposal that the client may apply under optimistic revision control. '
         'Persistent, slug-derived activity identities make completion status survive reordering and reroute. '
         'This specification is written exclusively from audited source code and freshly executed evidence: four '
         'regression suites comprising 37 scenarios pass against the baseline, with a hash manifest proving no '
         'source file changed during the run. Where the implementation intentionally or knowingly falls short — '
         'unvalidated session tokens, non-atomic revision checks, synthetic fallback data, a client-only routing '
         'path — the document records the actual behaviour, because a specification that describes the system '
         'as built is the only specification a viva can defend.')
    para(doc,
         'Keywords: requirements specification, LangGraph, LLM orchestration, itinerary scheduling, dynamic '
         'rerouting, optimistic concurrency, activity identity, FastAPI, React, MongoDB.', italic=True, size=10.5)
    h(doc, 1, 'Table of Contents')
    H.toc_field(doc)
    para(doc, 'The automatic field above expands to numbered headings when the field is updated in Word. '
              'For offline reading, the section map is: 1 Introduction; 2 Overall Description; 3 System '
              'Architecture; 4 Functional Requirements; 5 Non-Functional Requirements; 6 External Interface '
              'Requirements; 7 Use Cases; 8 Data Model; 9 API Specifications; 10 Dynamic AI Rerouting '
              'Subsystem; 11 Security; 12 Error Handling and Resilience; 13 Performance; 14 Requirements '
              'Traceability Matrix; 15 Verification and Validation; 16 Known Limitations; 17 Future Scope; '
              '18 References.', size=10, italic=True)


def s1_introduction(doc):
    h(doc, 1, '1. Introduction')
    h(doc, 2, '1.1 Purpose')
    para(doc, 'This document specifies the functional and non-functional requirements of TravelAI as it is '
              'actually implemented at the audited baseline. It serves three audiences: the academic reviewer, '
              'who needs a defensible statement of scope, behaviour and verification; the maintainer, who needs '
              'each requirement tied to a concrete module and test; and the examiner’s follow-up question, which '
              'this specification pre-empts by stating known gaps honestly rather than aspirationally.')
    h(doc, 2, '1.2 Document Conventions')
    H.bullets(doc, [
        ('RFC 2119 usage. ', '"Shall" states a requirement the implemented system meets; "should" states a '
         'recommendation; observed-but-unrequired behaviour is described in the indicative.'),
        ('Identifiers. ', 'Functional requirements are FR-nnn, non-functional requirements NFR-nnn, use cases '
         'UC-nn, user needs N-nn. Identifiers are stable and reused in the traceability matrix (Section 14).'),
        ('Priority classes. ', 'P1 = core to the demonstrated product; P2 = significant supporting capability; '
         'P3 = auxiliary or client-side convenience.'),
        ('Typography. ', 'Code identifiers, endpoints and collection names appear in the body text exactly as '
         'they occur in the repository. Bracketed placeholders such as [Student Name] mark submission-time '
         'fields only; no requirement statement is a placeholder.'),
    ])
    h(doc, 2, '1.3 Intended Audience and Reading Suggestions')
    para(doc, 'Examiners and reviewers should read Sections 2, 4, 10, 15 and 16. A maintainer extending the '
              'system should read Sections 3, 8 and 9 first. Section 14 maps every user-visible capability to '
              'its implementing module and its passing test scenario.')
    h(doc, 2, '1.4 Project Scope')
    para(doc, 'TravelAI targets the independent leisure traveler. Phase 1 delivered conversational and '
              'structured itinerary generation with a multi-tab dashboard. Phase 2 added live execution '
              'tracking with persistent activity identity. Phase 2.1 added on-the-ground Skip & Replace '
              'rerouting with optimistic revision control. Out of scope by design: real bookings or payments '
              '(the system deep-links to Google surfaces instead), mobile-native clients, multi-user trip '
              'collaboration, and any service-level deployment — the system runs as an academic prototype.')
    h(doc, 2, '1.5 Definitions, Acronyms and Abbreviations')
    H.table(doc, ['Term', 'Definition as used in this document'], [
        ['LangGraph', 'Graph runtime composing TravelAI’s agent pipeline as a StateGraph of nodes and edges with a shared state dictionary.'],
        ['Node / agent', 'One named processing step of the graph (parser, planner, flights, hotels, weather, attractions, restaurants, budget, route, reviewer, synthesis).'],
        ['Groq', 'Inference provider hosting the model qwen/qwen3.8-27b used for slot extraction, personalization and candidate generation.'],
        ['Token coordinator', 'Process-local Groq guard: 1,000 output tokens per rolling 60 s, semaphore 1, max_tokens 400, 20 s timeout, 1 retry, temperature 0.'],
        ['SerpApi', 'Paid search-scraping API used for Google Flights, Google Hotels and Google Maps results.'],
        ['Overpass / Nominatim', 'OpenStreetMap query and geocoding services forming the third and fourth discovery tiers.'],
        ['OSRM', 'Open Source Routing Machine; here called only by the browser (router.project-osrm.org), never by the backend.'],
        ['Haversine estimate', 'Great-circle distance converted to walking (4.5 km/h, min 5 min under 1 km) or driving (25 km/h, min 10 min) time.'],
        ['Pace profile', 'relaxed / balanced / packed templates setting wake and bed times and 135/105/75-minute base visit durations.'],
        ['ActivitySegment', 'One scheduled stop: id, type, times, coordinates, transit and metadata fields.'],
        ['Persistent activity id', 'Slug identifier act_{type}_{slug≤32}[_{place≤8}][_{disambiguator}]; content-derived, not hashed.'],
        ['execution_state', 'Embedded trip sub-document: is_active, current_day_number, activity_log map, reroute_history list.'],
        ['Reroute proposal', 'Ephemeral Skip & Replace answer returned to the client; the server stores no copy.'],
        ['Revision', 'Integer trip counter (default 1) compared before apply and incremented after; not an atomic CAS key.'],
        ['RAG', 'Retrieval-augmented generation via ChromaDB + Ollama nomic-embed-text, used only in the Q&A path.'],
        ['Dual-write', 'Frontend practice of storing each status under the persistent id and the legacy positional key.'],
        ['Mock-fallback', 'Frontend mode in which cached localStorage data stands in for an unreachable API.'],
    ], widths=[1.6, 5.1])
    h(doc, 2, '1.6 References')
    para(doc, 'See Section 18 for the complete numbered reference list.')


USER_NEEDS = [
    ('N-01', 'Plan a full trip from a short request without consulting five websites.'),
    ('N-02', 'Trust the plan’s facts (places, fares, hours) or at least see through its sources.'),
    ('N-03', 'Get a realistic day: local time zones, meals, travel time, arrival and departure days.'),
    ('N-04', 'Budget the trip against a declared total and see where the money goes.'),
    ('N-05', 'Follow the plan on the ground: what is happening now, what is next, navigate there.'),
    ('N-06', 'Mark stops done, skip what no longer fits, undo mistakes.'),
    ('N-07', 'When a stop is skipped, get a concrete replacement proposal, not a shrug.'),
    ('N-08', 'Decide myself whether to accept a proposed change; keep my schedule if I decline.'),
    ('N-09', 'Never lose progress status when stops get reordered or replaced.'),
    ('N-10', 'Return to any past trip and continue it.'),
    ('N-11', 'Ask free-form destination questions in the same assistant.'),
    ('N-12', 'Book flights and hotels where I want, via deep links, without the app touching money.'),
]


def s2_overall(doc):
    h(doc, 1, '2. Overall Description')
    h(doc, 2, '2.1 Product Perspective')
    para(doc, 'TravelAI is a standalone three-tier product: a presentation tier (React 19 SPA built with Vite 6, '
              'Tailwind 4 and Leaflet), an application tier (FastAPI with Pydantic v2 schemas hosting the '
              'LangGraph runtime and the reroute service), and a persistence/knowledge tier (MongoDB document '
              'store plus a ChromaDB vector store backed by local Ollama embeddings). Figure 1 shows the system '
              'boundary and every external integration. One boundary fact deserves early emphasis: street-level '
              'routing (OSRM) is performed by the browser, while the backend’s scheduling arithmetic uses '
              'Haversine distances only. The two are deliberately separate subsystems, and the specification '
              'never describes them as one server-side routing chain.')
    H.add_figure(doc, os.path.join(FIG, 'figure1_system_context.png'),
                 'Figure 1: System context and external integrations. Solid arrows are server-side calls; '
                 'dashed arrows are client-side or degraded paths. The annotation records the audited split '
                 'between backend Haversine estimation and frontend OSRM routing.')
    h(doc, 2, '2.2 Product Functions')
    H.bullets(doc, [
        'Conversational and form-driven trip intake with LLM slot extraction (FR-003–FR-005).',
        'Agentic itinerary generation over five parallel specialist agents with multi-tier factual fallback (FR-006–FR-011).',
        'Time-aware daily scheduling with pace profiles, meal templates, transit buffers and authoritative dates (FR-013).',
        'Budget allocation with an unallocated safety reserve (FR-012).',
        'Street-accurate client-side map rendering with graceful fallback (FR-014).',
        'Trip persistence, history, deletion (FR-015) and persistent activity identity (FR-017).',
        'Live Companion Mode with complete/skip/undo and GPS-aware navigation deep links (FR-016, FR-020).',
        'Dynamic Skip & Replace rerouting: purpose-aware preview and revision-checked apply (FR-018, FR-019, Section 10).',
        'RAG-grounded destination Q&A (FR-021), bookings deep-link desk (FR-023), places memory (FR-022), API status and cache resilience (FR-024).',
    ])
    h(doc, 2, '2.3 User Characteristics')
    para(doc, 'Primary user: a tech-comfortable leisure traveler using a modern browser on desktop or phone. '
              'Secondary persona: the administrator-developer who configures provider keys in Backend/.env and '
              'runs the Python test suites. No domain expertise is assumed; no accessibility conformance level '
              'is claimed.')
    h(doc, 2, '2.4 Constraints')
    H.bullets(doc, [
        'Academic prototype: no load balancer, no containerisation, single process per tier.',
        'LLM access is constrained by the Groq token coordinator (NFR-001), which serialises model calls.',
        'Free-tier and personal-key provider quotas bound external calls; Overpass and Nominatim require conservative request volumes.',
        'MongoDB is the only durable store; ChromaDB persistence is optional and local.',
        'The browser is a first-class computation participant (OSRM routing, localStorage cache, geolocation).',
        'React 19.0.1, Vite 6.2.3, TypeScript 5.8.2, Tailwind 4.1.14, Leaflet 1.9.4; FastAPI with Pydantic v2 on Python.',
    ])
    h(doc, 2, '2.5 Assumptions and Dependencies')
    H.bullets(doc, [
        'Provider keys for Groq and SerpApi exist and are valid; Open-Meteo, Overpass and Nominatim are reachable without keys.',
        'Ollama with nomic-embed-text runs locally only when the RAG Q&A path (FR-021) is exercised.',
        'Travelers grant browser geolocation permission for GPS-aware features; the app must remain usable when they decline (one-shot prompt, no hard dependency).',
        'Single-user-per-trip collaboration model; the x-user-id header identifies the caller (Section 11).',
    ])
    h(doc, 2, '2.6 Apportioning of Requirements')
    para(doc, 'Phase 1 comprises FR-003–FR-015 and FR-021–FR-024. Phase 2 adds FR-016 and FR-017. Phase 2.1 '
              'adds FR-018 and FR-019 and the verification evidence of Section 15. Priorities P1–P3 are '
              'assigned per card in Section 4; deployment ordering is out of scope for a prototype.')


def s3_architecture(doc):
    h(doc, 1, '3. System Architecture')
    h(doc, 2, '3.1 Architectural Style')
    para(doc, 'The system instantiates a three-tier architecture with an orchestration layer inside the '
              'application tier. Routers (app/api/) are thin: validation, serialisation and status codes. '
              'Services (app/services/) hold use-case logic: chat, slots, conversation, Q&A and reroute. '
              'Agents (app/ai/) are stateless collaborators over a shared LangGraph state '
              '(app/orchestrator/state.py). Persistence is document-oriented: a trip embeds its route, '
              'execution state and reroute history in one MongoDB document, which is why wholesale '
              'execution_state replacement and non-atomic revision checks are tractable at this scale.')
    H.add_figure(doc, os.path.join(FIG, 'figure2_three_tier.png'),
                 'Figure 2: Three-tier architecture. The presentation tier hosts the Planner Studio, '
                 'Dashboard, Itinerary Hub, Places Memory and Bookings Desk; the application tier hosts '
                 'routers, services and the LangGraph agent pool; the persistence tier holds MongoDB and the '
                 'ChromaDB/Ollama knowledge store.')
    h(doc, 2, '3.2 Agent Orchestration and Factual Discovery')
    para(doc, 'Figure 3 traces the compiled graph. The parser extracts structured slots through the LLM but '
              'skips the model entirely when the caller already supplied structured context; the planner '
              'drafts deterministically; five specialist agents fan out in parallel; budget and the time-aware '
              'route agent then serialise; the reviewer gate can in principle reject, but its retry edge back '
              'to the planner is presently unreachable because planning runs a single step — a fact the figure '
              'annotates rather than hides. Below the graph, every factual agent walks the same four-tier '
              'discovery ladder (LLM → SerpApi → Overpass → Nominatim), stopping at the first non-empty tier. '
              'Two documented fallback fabrications exist and are stated in Section 16: the Delhi geocode '
              'default and the synthetic "Grand Heritage Hotel".')
    H.add_figure(doc, os.path.join(FIG, 'figure3_agents_discovery.png'),
                 'Figure 3: Agent orchestration and multi-tier factual discovery, including the unreachable '
                 'reviewer retry edge and the per-tier fallback order.')
    h(doc, 2, '3.3 Time-Aware Scheduling Engine')
    para(doc, 'The route agent (app/ai/agents/route_agent.py) is the deterministic core. Time zones resolve by '
              'IANA substring match against the destination name with Asia/Kolkata as the default. Inclusive '
              'start/end dates override a conflicting duration declaration. Arrival, exploration and departure '
              'days use distinct templates — airport check-in and clearance, hotel check-in/out, transfers — '
              'while exploration days loop over priority-ranked attractions, inserting meal stops when the '
              'cursor reaches their anchor window and adding Haversine transit between consecutive stops. '
              'Bedtime truncates recommendations rather than hard-capping the loop, and initial generation '
              'performs no global overlap or opening-hours guarantee; reroute preview applies its own narrower '
              'checks (Section 10).')
    H.add_figure(doc, os.path.join(FIG, 'figure4_time_engine.png'),
                 'Figure 4: Time-aware daily itinerary engine inputs, loops and outputs, with the audited '
                 'note that initial generation performs no final global overlap or opening-hour verification.')
    h(doc, 2, '3.4 Deployment View')
    para(doc, 'Backend: uvicorn serving app/main.py, CORS configured for the frontend origin, MongoDB via '
              'PyMongo (Atlas or local). Frontend: Vite dev server on port 3000 or a static build. Optional '
              'local Ollama for embeddings. No secrets are in source; all provider keys load from '
              'Backend/.env, which is excluded from this document and from version control.')
    h(doc, 2, '3.5 Source Inventory')
    para(doc, f'The audited baseline contains {SOURCE_FILES} hashed source files across '
              'Backend/app (api, services, models, schemas, ai/agents, ai/orchestrator, ai/rag, ai/reviewer, '
              'utils, database) and Frontend/src (components, hooks, services, types, context, pages). '
              'The frontend’s largest concentration of behaviour is the 874-line useTravelApi.ts hook, '
              'services/api.ts and services/routingService.ts, plus the tab components including the '
              '1,217-line CompanionMode.tsx.')


def s4_functional(doc):
    h(doc, 1, '4. Functional Requirements')
    para(doc, 'Twenty-four functional requirements are specified below, each as a ten-field card. Processing '
              'logic describes the implemented algorithm, not an idealised one. Where behaviour is '
              'client-side-only or intentionally approximate, the card says so and Section 16 records the '
              'consequence.')
    h(doc, 2, '4.1 Catalogue Summary')
    H.table(doc, ['ID', 'Title', 'Category', 'Priority'],
            [[f['id'], f['title'], f['category'], f['priority']] for f in FRS],
            widths=[0.9, 3.0, 1.6, 0.8])
    h(doc, 2, '4.2 Requirement Cards')
    for fr in FRS:
        fr_card(doc, fr)


def s5_nonfunctional(doc):
    h(doc, 1, '5. Non-Functional Requirements')
    para(doc, 'Each NFR names the attribute, the implemented mechanism and how the claim is verified. NFR-008 '
              'is deliberately phrased as a recorded exposure, not a satisfied requirement.')
    H.table(doc, ['ID / Class', 'Title', 'Requirement statement', 'Verification'],
            [[a, b, c, d] for a, b, c, d in NFRS], widths=[1.1, 1.5, 3.0, 1.4])


def s6_interfaces(doc):
    h(doc, 1, '6. External Interface Requirements')
    h(doc, 2, '6.1 User Interfaces')
    para(doc, 'Browser UI (React 19 SPA): Planner Studio chat and form intake; Dashboard tabs — Route Map '
              '(Leaflet/OSRM), Companion Mode (live day), Flights, Hotels, Weather, Budget; Itinerary Hub for '
              'saved trips; Places Memory; Bookings Desk. Companion Mode is specified in FR-020; all '
              'interactions are keyboard-reachable buttons with visible focus in the shipped build.')
    h(doc, 2, '6.2 Hardware Interfaces')
    para(doc, 'None beyond a geolocation-capable device (navigator.geolocation, one-shot fix, FR-020).')
    h(doc, 2, '6.3 Software and Communication Interfaces')
    H.table(doc, ['Interface', 'Direction', 'Protocol / binding', 'Notes'], [
        ['Groq chat completions', 'Backend → external', 'HTTPS/JSON via langchain-groq ChatGroq', 'Model qwen/qwen3.8-27b; guarded by NFR-001.'],
        ['SerpApi Google Flights / Hotels / Maps', 'Backend → external', 'HTTPS/JSON', 'Keys in environment; tier 2 of discovery.'],
        ['Overpass API', 'Backend → external', 'HTTPS (QL queries)', 'Tier 3; OSM facts, default rating 4.5 caveat.'],
        ['Nominatim', 'Backend → external', 'HTTPS/JSON', 'Tier 4 geocoding; Delhi fallback documented.'],
        ['Open-Meteo', 'Backend → external', 'HTTPS/JSON', 'No key required.'],
        ['Google Places API v1', 'Backend → external', 'HTTPS/JSON', 'Opening-hours and photography enrichment path.'],
        ['MongoDB', 'Backend → store', 'PyMongo wire protocol', 'Collections: trips, users, conversations, messages.'],
        ['ChromaDB + Ollama', 'Backend → store', 'Local HTTP / embedded', 'Collection travel_knowledge; Q&A path only.'],
        ['OSRM public demo', 'Browser → external', 'HTTPS/JSON', '7-second client abort; never called by the backend.'],
        ['REST API (this system)', 'Browser → Backend', 'HTTPS/JSON, CORS', 'Full contract in Section 9.'],
    ], widths=[1.7, 1.1, 1.7, 2.5])


def s7_usecases(doc):
    h(doc, 1, '7. Use Cases')
    for uid, title, actor, pre, flow, alt, post in USE_CASES:
        h(doc, 2, f'{uid} — {title}')
        H.kv_table(doc, [
            ('Actor', actor), ('Preconditions', pre),
            ('Main flow', '\n'.join(flow)),
            ('Alternative flows', '\n'.join(alt) if alt else 'None.'),
            ('Postconditions', post[0] if post else '—'),
        ])
        doc.add_paragraph()


def s8_data(doc):
    h(doc, 1, '8. Data Model')
    h(doc, 2, '8.1 Conceptual Schema')
    para(doc, 'Figure 7 shows the persisted model. A trip document embeds route_details (day_by_day_route with '
              'stops), execution_state and reroute_history; users, conversations and messages are separate '
              'collections; conversations reference a trip logically through current_trip_id, not through a '
              'foreign-key constraint.')
    H.add_figure(doc, os.path.join(FIG, 'figure7_data_model.png'),
                 'Figure 7: Trip, execution-state and identity data model. The red annotation records that '
                 'the revision check is a conditional read-check-write, not an atomic compare-and-set.')
    h(doc, 2, '8.2 Trip Document')
    H.table(doc, ['Field', 'Type', 'Semantics'], [
        ['_id / id', 'ObjectId / string', 'Trip identifier; serialised to id in responses.'],
        ['user_id', 'string', 'Client-supplied identity via x-user-id header (Section 11).'],
        ['destination, timezone, revision', 'string, string, int', 'Human destination; IANA zone; concurrency counter, default 1.'],
        ['travel_context', 'embedded', 'Dates, budget, party, interests, pace, style captured at planning time.'],
        ['all_attractions / restaurants / hotels / flights', 'arrays', 'Discovery outputs feeding the scheduler and the UI tabs.'],
        ['route_details', 'embedded', 'destination_timezone plus day_by_day_route[] with day, date, title, is_flight_day, stops[].'],
        ['execution_state', 'embedded', 'See 8.3.'],
        ['created_at / updated_at', 'ISO datetime', 'Maintenance timestamps; history sorts on created_at descending.'],
    ], widths=[1.9, 1.3, 3.8])
    h(doc, 2, '8.3 Execution State and Activity Identity')
    para(doc, 'execution_state holds is_active, current_day_number, an activity_log keyed map and '
              'reroute_history. Each log entry records status (pending/in_progress/completed/skipped), '
              'activity_id, activity_title, actual timestamps and optional notes. Keys are the persistent '
              'slug identifiers act_{type}_{slug≤32}[_{place≤8}][_{disambiguator}] — deliberately '
              'content-derived and human-inspectable rather than hashed — with legacy positional keys '
              '("{day}_{index}", "day_{d}_act_{i+1}") retained by frontend dual-write. Resolution precedence '
              'is persistent id → canonical key → legacy positional → pending, so a trip generated before '
              'Phase 2 migrates transparently on first read.')
    h(doc, 2, '8.4 Concurrency Semantics')
    para(doc, 'Apply-flow concurrency is optimistic: the client echoes the revision it saw; the server reads '
              'the document, compares, then writes day stops, an accepted history entry and revision+1. '
              'Because the update filter does not include revision, two applies that both pass the compare '
              'can interleave and the second write silently overwrites the first — a bounded lost-update '
              'window acceptable for single-traveler use and recorded in Sections 12, 16 and 17. Similarly, '
              'the execution_state endpoint replaces the whole sub-document, so concurrent trackers of '
              'different stops would clobber each other; the product assumes one device per trip.')
    h(doc, 2, '8.5 Other Collections')
    para(doc, 'users: lower-cased unique email, PBKDF2 hash, 16-byte salt, created_at. conversations: title, '
              'status, travel_context, current_trip_id. messages: role, content, intent, structured data, '
              'linked conversation id. No TTL indexes exist anywhere; reroute proposals are never persisted.')


def s9_api(doc):
    h(doc, 1, '9. API Specifications')
    para(doc, 'All endpoints are HTTPS/JSON with CORS enabled for the frontend origin. Status semantics: '
              '400 malformed or rejected domain input; 403 caller is not the trip owner (header-based); '
              '404 unknown trip or resource; 409 stale revision on apply; 500 unexpected failure with a '
              'detail string. The five core contracts follow; auth and chat contracts are summarised in '
              'Section 6.3 and FR-001–FR-004.')
    h(doc, 2, '9.1 POST /api/trips/plan')
    para(doc, 'Request: destination, origin, dates (start/end ISO), days, nights, travelers, budget, '
              'budget_mode, interests, travel_style, pace. Processing: full graph invocation (Figure 5). '
              'Response: the complete trip document including route_details, discovery arrays, '
              'execution_state and revision: 1. Errors: 422 Pydantic validation, 500 persistence failure.')
    H.add_figure(doc, os.path.join(FIG, 'figure5_generation_sequence.png'),
                 'Figure 5: Itinerary generation sequence from form submission to dashboard render, with '
                 'graph-stage notes and the persistence of revision 1.')
    h(doc, 2, '9.2 POST /api/trips/{id}/reroute/preview')
    para(doc, 'Request: {day_number, skipped_activity_id, current_location?: {lat, lon}, expected_revision?}. '
              'Response: RerouteProposal — proposal_id (prop_{epoch}_{day}), day_number, revision, '
              'replacement_found, skipped_activity, replacement_activity|null, original_stops, proposed_stops, '
              'rescheduled_stops, reason. The server stores nothing: the proposal lives only in the client. '
              'Errors: 403 non-owner, 404 unknown trip, 400 unknown activity id.')
    h(doc, 2, '9.3 POST /api/trips/{id}/reroute/apply')
    para(doc, 'Request: {day_number, skipped_activity_id, proposed_stops, replacement_activity_id?, reason, '
              'expected_revision}. Behaviour: revision compare, day replacement, accepted-entry append to '
              'reroute_history, revision+1 (Section 8.4). Response: {status, trip_id, revision, route_details, '
              'execution_state, reroute_record}. Errors: 409 stale revision (trip unchanged), 403, 404, 500.')
    h(doc, 2, '9.4 POST /api/trips/{id}/execution_state')
    para(doc, 'Request: {is_active, current_day_number, activity_log}. Behaviour: wholesale replacement of the '
              'embedded execution_state document (no merge). Response: persisted state. The frontend merges '
              'locally, dual-writes persistent and legacy keys, and caches to localStorage on failure.')
    h(doc, 2, '9.5 GET /api/trips/history and DELETE /api/trips/{id}')
    para(doc, 'History returns the ten newest trip documents filtered by user_id when the x-user-id header is '
              'present; without the header it returns the ten newest trips system-wide — a documented '
              'exposure (Section 11). Delete removes the document and is idempotent from the client’s view.')
    h(doc, 2, '9.6 Payload Example (preview → apply)')
    H.callout(doc, 'Example.',
              'preview request {"day_number":2,"skipped_activity_id":"act_attraction_colosseum","'
              'current_location":{"lat":41.89,"lon":12.49},"expected_revision":3} → proposal with '
              'replacement_found true; apply request echoes proposed_stops and expected_revision 3 → '
              '200 with revision 4 and one reroute_history entry, or 409 if another apply advanced the '
              'counter first.')


def s10_reroute(doc):
    h(doc, 1, '10. Dynamic AI Rerouting Subsystem (Phase 2.1)')
    h(doc, 2, '10.1 Scope and Interaction Contract')
    para(doc, 'The subsystem answers one question: the traveler just skipped a stop mid-day — what should the '
              'rest of the day look like? app/services/reroute_service.py computes a proposal; the client '
              'decides. The server never holds a proposal copy, so apply re-submits the full proposed_stops '
              'payload it received from preview. Figure 6 sequences the whole interaction, including the '
              'persist-skip-before-preview ordering and the local-only cancel path.')
    H.add_figure(doc, os.path.join(FIG, 'figure6_reroute_sequence.png'),
                 'Figure 6: Skip, preview and apply sequence. Annotations state the absence of proposal TTL, '
                 'retrieval, rejection audit and signed binding, and the non-atomic revision comparison.')
    h(doc, 2, '10.2 Purpose Classification and Cutoff')
    para(doc, 'The skipped stop is classified as attraction, meal (breakfast before 10:30, dinner from 17:00, '
              'lunch otherwise), transit or template stop. A chronological cutoff — the maximum of the skip '
              'time and the current time — freezes everything earlier: only future stops are rescheduled.')
    h(doc, 2, '10.3 Candidate Search and Scoring')
    H.bullets(doc, [
        ('Attractions. ', 'Candidates come from the same discovery tiers as generation (FR-010), mocked in '
         'tests via app.services.reroute_service.discover_via_serpapi and Overpass equivalents. Score = '
         'distance penalty minus 8 for category match minus 4 for interest match; the least-bad candidate wins.'),
        ('Meals. ', 'Replacement must fit its window (07:00–10:30, 11:40–15:30, 18:30–22:00) with durations '
         '45/60/75 minutes; if no candidate qualifies, a synthetic meal-break stop is inserted so the day '
         'never loses its meal structure.'),
        ('Rescheduling. ', 'Later stops shift by the delta with a +10-minute overlap guard; times wrap modulo '
         '24 hours, a behaviour tests assert explicitly.'),
    ])
    h(doc, 2, '10.4 Proposal Lifecycle and Apply Semantics')
    para(doc, 'Proposal ids encode generation time (prop_{epoch_seconds}_{day}) but carry no TTL, no '
              'server-side storage, no retrieval endpoint, no rejection record and no signature — an expired '
              'or tampered proposal is only constrained by the revision check at apply. Apply performs the '
              'read-compare-write of Section 8.4 and appends an accepted entry (reason, timestamps, revision) '
              'to reroute_history. Cancel performs nothing server-side at all.')
    h(doc, 2, '10.5 Identity Interaction')
    para(doc, 'Every generated or rescheduled stop receives a persistent act_-prefixed id before it reaches '
              'the client, so statuses recorded against old stops cannot migrate to new ones — the property '
              'activity_identity_audit_tests.py Test 6 pins down (all generated stops uniquely id’d).')


def s11_security(doc):
    h(doc, 1, '11. Security')
    para(doc, 'This section reports the security posture of the audited code, not a target design.')
    h(doc, 2, '11.1 Implemented Controls')
    H.bullets(doc, [
        'Password storage: PBKDF2-HMAC-SHA256 with 100,000 iterations, 16-byte per-user salt, constant-time comparison (FR-001).',
        'Secret containment: provider keys load from Backend/.env, which is git-ignored; no key value appears in source, logs or this document (NFR-009).',
        'Input validation: Pydantic v2 schemas on every request body; MongoDB queries use driver-bound parameters, not string interpolation.',
        'CORS restricted to the frontend origin; booking flows are delegated to Google deep links, so the system holds no payment data.',
    ])
    h(doc, 2, '11.2 Recorded Exposures (implemented as-is)')
    H.bullets(doc, [
        'Session tokens are SHA-256 digests that no endpoint ever validates; authentication state is effectively client-asserted.',
        'Ownership checks compare the x-user-id header to trip.user_id; a caller can set any header value, so identification is by trust, not proof. dynamic_reroute_tests.py proves the 403 path fires when the header mismatches — but only against an honest client.',
        'GET /api/trips/history without the header returns the ten newest trips of all users.',
        'The execution_state and apply endpoints accept client-authored stop payloads; a malicious owner could persist arbitrary itinerary content (self-XSS surface in UI rendering).',
        'No rate limiting, no audit logging, no transport hardening beyond deployment TLS if any.',
    ])
    H.callout(doc, 'Specification stance.',
              'These are stated as exposures (NFR-008), not as met requirements. Section 17 lists the '
              'server-validated token middleware, header-independent identity and history scoping that '
              'would close them.')


def s12_errors(doc):
    h(doc, 1, '12. Error Handling and Resilience')
    h(doc, 2, '12.1 Server-Side Semantics')
    H.table(doc, ['Condition', 'Response', 'State after failure'], [
        ['Malformed body / unknown activity / bad day', '400 or 422', 'Trip unchanged.'],
        ['Caller header ≠ trip.user_id', '403', 'Trip unchanged (honest-client assumption noted).'],
        ['Unknown trip id', '404', '—'],
        ['Stale expected_revision on apply', '409', 'Trip unchanged; client prompts refresh.'],
        ['Provider tier failure during discovery', 'Next tier or empty collection', 'Generation continues; degraded factuality.'],
        ['Persistence failure', '500 with detail', 'No partial document (single insert).'],
    ], widths=[2.6, 1.7, 2.4])
    h(doc, 2, '12.2 Client-Side Resilience')
    H.bullets(doc, [
        'OSRM leg timeout (7 s) falls back to straight-line geometry with leg status fallback so maps always render.',
        'API unreachable → mock-fallback mode from localStorage caches (TRAVELAI_* keys) with a visible badge (FR-024).',
        'Failed execution-state writes surface a dismissible error banner while the local log keeps the change for retry.',
        'Geolocation denial is logged at debug level and degrades navigation links to destination-only URLs.',
        'Legacy positional logs migrate on read; dual-write keeps old clients coherent (FR-017).',
    ])
    h(doc, 2, '12.3 Residual Risks')
    para(doc, 'The Section 8.4 lost-update window; silent staleness of an accepted proposal whose revision '
              'moved while the modal sat open (apply then 409s — correct, but the traveler loses the '
              'suggestion); and no server-side record of rejections, which forecloses post-hoc analysis of '
              'proposal quality.')


def s13_performance(doc):
    h(doc, 1, '13. Performance')
    para(doc, 'Measured numbers below come from the audit run of Section 15; no end-to-end production '
              'benchmark exists for this prototype and none is claimed.')
    H.table(doc, ['Aspect', 'Implemented bound / measurement', 'Source'], [
        ['LLM containment', '1,000 output tokens / rolling 60 s, semaphore 1, max_tokens 400, 20 s timeout, 1 retry, temperature 0.', 'app/ai/llm.py (NFR-001)'],
        ['Graph wall-clock', 'Not benchmarked; dominated by sequential LLM-guarded calls and provider latency.', 'Audit statement (honest gap)'],
        ['Client routing', 'OSRM per-leg request aborted at 7 s; >500 km legs treated as flight.', 'routingService.ts (NFR-002, FR-014)'],
        ['History query', 'Ten newest trips per user, indexed-free sort on created_at.', 'trips.py (FR-015)'],
        ['Test suite runtime', '37 scenarios across four suites in 49.2 s total (14.5 / 11.0 / 13.0 / 10.8 s).', 'audit_evidence.json'],
        ['Frontend bundle surface', 'Single 874-line API hook; Companion Mode component 1,217 lines — maintainability, not runtime, signal.', 'Source inventory (3.5)'],
    ], widths=[1.5, 3.6, 1.9])


def s14_rtm(doc):
    h(doc, 1, '14. Requirements Traceability Matrix')
    para(doc, 'Rows trace each user need through requirement cards, implementing modules and the concrete '
              'passing test scenario that evidences it. "Manual UI" marks capabilities verified by browser '
              'testing only; Section 16 lists that verification gap as a limitation.')
    rows = [
        ['N-01', 'FR-003, FR-005, FR-006', 'app/api/trips.py; app/ai/orchestrator/langgraph_graph.py', 'itinerary_engine_audit_tests.py A–F'],
        ['N-02', 'FR-007–FR-011', 'app/ai/agents/{flight,hotel,weather,attraction,restaurant}_agent.py', 'dynamic_reroute_tests.py (tier mocks); Manual UI'],
        ['N-03', 'FR-013, FR-014', 'app/ai/agents/route_agent.py; Frontend/src/services/routingService.ts', 'itinerary_engine_audit_tests.py B, C, D, F'],
        ['N-04', 'FR-012', 'app/ai/agents/budget_agent.py', 'Manual UI (partial model, §16)'],
        ['N-05', 'FR-020', 'Frontend/src/components/tabs/CompanionMode.tsx', 'Manual UI'],
        ['N-06', 'FR-016, FR-017', 'app/api/trips.py (execution_state); app/utils/activity_identity.py', 'activity_identity_audit_tests.py 1–7'],
        ['N-07', 'FR-018', 'app/services/reroute_service.py', 'phase2_1_reroute_tests.py A–G; dynamic_reroute_tests.py'],
        ['N-08', 'FR-019, FR-020', 'app/api/trips.py (apply); CompanionMode modal', 'phase2_1_reroute_tests.py H–J; dynamic 409/403 scenarios'],
        ['N-09', 'FR-017', 'app/utils/activity_identity.py; api.ts dual-write', 'activity_identity_audit_tests.py 1–4, 6'],
        ['N-10', 'FR-015', 'app/api/trips.py (history, delete)', 'Manual UI'],
        ['N-11', 'FR-004, FR-021', 'app/services/chat_service.py; app/ai/rag/*; qa_service.py', 'Manual chat testing'],
        ['N-12', 'FR-007, FR-008, FR-023', 'flight/hotel agents; Bookings Desk component', 'Manual UI'],
    ]
    H.table(doc, ['Need', 'Requirements', 'Backend / frontend modules', 'Test evidence'], rows,
            widths=[0.7, 1.5, 2.6, 2.0])
    h(doc, 2, '14.1 Reverse Traceability')
    para(doc, 'Every FR card in Section 4 names at least one need above or is a UI/security auxiliary '
              '(FR-001, FR-002, FR-022, FR-024 trace to N-10/N-12 and Section 11 concerns). No orphan test '
              'exists: all four suites map to rows above. No orphan requirement exists.')


def s15_vv(doc):
    h(doc, 1, '15. Verification and Validation')
    h(doc, 2, '15.1 Evidence Method')
    para(doc, f'The audit hashed {SOURCE_FILES} source files, executed all four regression suites '
              'against the working tree with provider calls mocked, and re-hashed afterwards: the manifest '
              'records zero source changes during testing (source_changes: []). The application code was '
              'never modified to produce this document; only docs/academic artifacts were added.')
    h(doc, 2, '15.2 Executed Suites')
    rows = []
    for t in EVIDENCE['test_results']:
        rows.append([t['suite'], str(t['expected_scenarios']),
                     'PASS' if t['passed'] else 'FAIL', f"{t['elapsed_seconds']} s",
                     f"python -B {t['suite']}", t['working_directory']])
    H.table(doc, ['Suite', 'Scenarios', 'Result', 'Elapsed', 'Command', 'CWD'], rows,
            widths=[2.4, 0.9, 0.7, 0.9, 1.7, 0.9])
    H.bullets(doc, [
        ('phase2_1_reroute_tests.py (A–J). ', 'Meal-aware reroute, transit buffer, breakfast insertion, '
         'completed-stop preservation, category preservation, past-time handling, meal-break fallback, '
         'apply/revision increment, cancel path, full-day integrity.'),
        ('dynamic_reroute_tests.py (A–N). ', 'Preview/apply contracts with mocked SerpAPI/Overpass, 409 '
         'stale-revision conflict, 403 cross-user rejection, tier ordering, cutoff behaviour, scoring.'),
        ('itinerary_engine_audit_tests.py (A–F). ', 'Goa must-visit priority, Paris relaxed pacing under '
         'Europe/Paris, Sydney transit under Australia/Sydney, pace-profile comparison, missing-data '
         'resilience, authoritative date-range override (6 days beat days=3).'),
        ('activity_identity_audit_tests.py (1–7). ', 'Reordering stability, status-transfer prevention, '
         'insertion, skip/undo by persistent id, legacy migration, generated-stop uniqueness, JSON '
         'round-trip.'),
    ])
    h(doc, 2, '15.3 Validation Against This Specification')
    para(doc, 'Each P1 functional requirement is exercised by at least one executed scenario (Section 14). '
              'P2/P3 integration and UI requirements (FR-009, FR-014, FR-020–FR-024) rest on manual '
              'browser verification; the document says so per card rather than implying automated coverage. '
              'Requirement statements were re-read against source after the suites ran; two aspirational '
              'claims circulating in project notes were corrected to implemented fact during drafting: '
              'deterministic identity is slug-based, and hotel search parameters are fixed.')


def s16_limitations(doc):
    h(doc, 1, '16. Known Limitations')
    para(doc, 'Stated plainly because each is visible to any examiner who opens the code.')
    H.table(doc, ['#', 'Limitation', 'Consequence'], [
        ['L1', 'Tokens are never validated; x-user-id is trusted.', 'Identity spoofing between users is possible on a willing network (Section 11.2).'],
        ['L2', 'Revision check is read-check-write, not atomic CAS.', 'Narrow lost-update window under concurrent applies (8.4).'],
        ['L3', 'Proposals are ephemeral: no TTL, storage, retrieval, rejection audit or signature.', 'Stale proposals 409 at apply; proposal quality cannot be analysed post-hoc.'],
        ['L4', 'Backend transit is Haversine; OSRM is client-side only.', 'Scheduled times can disagree with street reality; maps and math are separate subsystems.'],
        ['L5', 'Initial generation lacks a final global overlap/opening-hour pass; bedtime is advisory.', 'Rare late-running days; opening_hours agent node is disconnected from the main graph.'],
        ['L6', 'Documented fallback fabrications: Delhi geocode default, synthetic Grand Heritage Hotel, OSM rating 4.5 default.', 'Plausible-looking false data on provider failure; labelled in code, disclosed here.'],
        ['L7', 'Hotel search fixes check-in to today+30 and two adults; budget model is partial (fare × pax × 2 plus ratios).', 'Recommendations and allocations can misrepresent the actual party and dates.'],
        ['L8', 'MODIFY_ITINERARY is narrative-only; RAG is absent from the generation path; "VERIFIED_OPEN" is not visit-time verified; Google Flights historical_record denotes an empty classification.', 'Conversational editing does not mutate trips; retrieval value is confined to Q&A.'],
        ['L9', 'execution_state is wholesale replacement; single-device assumption.', 'Two trackers on one trip clobber each other.'],
        ['L10', 'No automated coverage for auth, chat, UI tabs or frontend; no CI.', 'P2/P3 verification is manual (15.3).'],
    ], widths=[0.5, 3.6, 2.9])


def s17_future(doc):
    h(doc, 1, '17. Future Scope')
    H.bullets(doc, [
        'Server-validated bearer tokens (signed, expiring) and ownership enforced from token subject, not headers; history scoping by default (closes L1).',
        'Atomic conditional update (filter includes revision) turning apply into true CAS; retry-with-refetch UX on 409 (closes L2).',
        'Durable proposal store with TTL, GET /proposals/{id}, signed payloads bound to (trip, revision, day), and recorded rejections feeding a proposal-quality dashboard (closes L3).',
        'Self-hosted OSRM in the backend so scheduling math and rendered geometry share one source (closes L4).',
        'Post-generation global validation pass: overlap resolution, opening-hour verification at visit time, hard bedtime constraint; wire the reviewer retry edge to a real replanning loop (closes L5).',
        'Configurable hotel search from actual dates and party size; activity-level budget roll-up from discovered prices (closes L7).',
        'Conversational itinerary mutation (structured MODIFY_ITINERARY) and RAG grounding inside the generation graph (closes L8).',
        'Field-level execution-state merge; multi-device conflict resolution (closes L9).',
        'CI harness running the four suites plus Playwright stories for Companion Mode (closes L10).',
    ])


def s18_refs(doc):
    h(doc, 1, '18. References')
    refs = [
        '[1] IEEE, "IEEE Std 830-1998: Recommended Practice for Software Requirements Specifications," 1998.',
        '[2] ISO/IEC/IEEE, "29148:2018 Systems and software engineering — Life cycle processes — Requirements '
        'engineering," 2018.',
        '[3] S. Bradner, "Key words for use in RFCs to Indicate Requirement Levels," RFC 2119, 1997.',
        '[4] LangChain AI, "LangGraph documentation: Graph API and StateGraph," docs.langchain.com, accessed 2026.',
        '[5] FastAPI maintainers, "FastAPI documentation (Pydantic v2 integration)," fastapi.tiangolo.com, accessed 2026.',
        '[6] MongoDB Inc., "MongoDB Manual: documents, update filters and atomicity," mongodb.com/docs, accessed 2026.',
        '[7] Groq Inc., "GroqCloud API documentation," console.groq.com/docs, accessed 2026.',
        '[8] SerpApi LLC, "Google Flights / Google Hotels / Google Maps Results API," serpapi.com/docs, accessed 2026.',
        '[9] OpenStreetMap Foundation, "Overpass API manual" and "Nominatim services," overpass-turbo.eu, nominatim.org, accessed 2026.',
        '[10] D. K. Arvind et al., "Open-Meteo: free weather API," open-meteo.com, accessed 2026.',
        '[11] OSRM Project, "OSRM HTTP APIs," project-osrm.org, accessed 2026.',
        '[12] Chroma, "ChromaDB vector database documentation," docs.trychroma.com, accessed 2026.',
        '[13] Ollama, "Embeddings and nomic-embed-text model," ollama.com/docs, accessed 2026.',
        '[14] Google LLC, "Places API (v1) — opening hours," developers.google.com, accessed 2026.',
        '[15] OWASP Foundation, "API Security Top 10," owasp.org, 2023.',
        '[16] TravelAI repository, source baseline audited ' + AUDIT_DATE + ' (manifest and test evidence in '
        'docs/academic/audit_evidence.json).',
    ]
    for r in refs:
        H.body(doc, r, size=10.5)


def main():
    doc = Document()
    H.setup_styles(doc)
    sec0 = doc.sections[0]
    H.margins(sec0)
    build_cover(doc)

    sec1 = doc.add_section(WD_SECTION_START.NEW_PAGE)
    H.margins(sec1)
    H.running_header(sec1, 'TravelAI — Software Requirements Specification')
    H.running_footer(sec1, 'Confidential — Academic Project Submission')

    build_front_matter(doc)
    first_h1 = [p for p in doc.paragraphs if p.style.name == 'Heading 1']
    # ensure the first numbered section does not add a stray blank page
    for p in first_h1:
        p.paragraph_format.page_break_before = False
        break

    s1_introduction(doc)
    s2_overall(doc)
    s3_architecture(doc)
    s4_functional(doc)
    s5_nonfunctional(doc)
    s6_interfaces(doc)
    s7_usecases(doc)
    s8_data(doc)
    s9_api(doc)
    s10_reroute(doc)
    s11_security(doc)
    s12_errors(doc)
    s13_performance(doc)
    s14_rtm(doc)
    s15_vv(doc)
    s16_limitations(doc)
    s17_future(doc)
    s18_refs(doc)

    doc.save(OUT)
    print('saved', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
