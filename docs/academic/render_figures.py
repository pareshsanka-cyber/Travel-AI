"""Programmatically renders the seven SRS figures as high-resolution PNGs
(300 DPI) using Pillow. Figures describe the implemented system; caption text
lives in the SRS generator."""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 2400, 1600
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figures')
os.makedirs(OUT, exist_ok=True)

NAVY = (27, 54, 93)
STEEL = (46, 90, 140)
LIGHT = (238, 243, 248)
AMBER = (245, 197, 66)
AMBER_FILL = (253, 243, 219)
GREEN = (46, 125, 90)
GREEN_FILL = (224, 240, 231)
RED = (176, 58, 46)
RED_FILL = (248, 228, 225)
GRAY = (110, 118, 128)
DASH = (150, 160, 172)
INK = (30, 36, 44)
WHITE = (255, 255, 255)

F = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 26)
FB = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 26)
FS = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 21)
FSB = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 21)
FT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 34)


def canvas():
    img = Image.new('RGB', (W, H), WHITE)
    return img, ImageDraw.Draw(img)


def wrap(draw, text, font, maxw):
    words, lines, cur = text.split(), [], ''
    for word in words:
        trial = (cur + ' ' + word).strip()
        if draw.textlength(trial, font=font) <= maxw:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def box(draw, xy, title, subtitle='', fill=LIGHT, outline=NAVY, width=3, radius=14,
        title_font=None, sub_font=None, tcolor=INK, scolor=GRAY):
    tf = title_font or F
    sf = sub_font or FS
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    tl = wrap(draw, title, tf, x1 - x0 - 24)
    sl = wrap(draw, subtitle, sf, x1 - x0 - 24) if subtitle else []
    th = len(tl) * (tf.getmetrics()[0] + tf.getmetrics()[1])
    sh = len(sl) * (sf.getmetrics()[0] + sf.getmetrics()[1])
    lh = tf.getmetrics()[0] + tf.getmetrics()[1]
    ls = sf.getmetrics()[0] + sf.getmetrics()[1]
    y = y0 + (y1 - y0 - (th + sh + (10 if sl else 0))) // 2
    for line in tl:
        tw = draw.textlength(line, font=tf)
        draw.text(((x0 + x1) / 2 - tw / 2, y), line, font=tf, fill=tcolor)
        y += lh
    if sl:
        y += 10
        for line in sl:
            tw = draw.textlength(line, font=sf)
            draw.text(((x0 + x1) / 2 - tw / 2, y), line, font=sf, fill=scolor)
            y += ls
    return xy


def arrow(draw, p0, p1, color=NAVY, width=4, label='', dashed=False, lcolor=GRAY, font=None, head=16):
    lf = font or FS
    if dashed:
        _dash(draw, p0, p1, color, width)
        _dashhead(draw, p0, p1, color, head)
    else:
        draw.line([p0, p1], fill=color, width=width)
        _head(draw, p0, p1, color, head)
    if label:
        mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        lines = wrap(draw, label, lf, 460)
        lh = lf.getmetrics()[0] + lf.getmetrics()[1]
        y0 = my - (len(lines) * lh) / 2
        bw = max([draw.textlength(t, font=lf) for t in lines]) + 14
        draw.rectangle([mx - bw / 2, y0 - 4, mx + bw / 2, y0 + len(lines) * lh + 2], fill=WHITE)
        for i, t in enumerate(lines):
            draw.text((mx - draw.textlength(t, font=lf) / 2, y0 + i * lh), t, font=lf, fill=lcolor)


def _head(draw, p0, p1, color, head):
    import math
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    for da in (math.radians(155), math.radians(-155)):
        draw.line([p1, (p1[0] + head * math.cos(ang + da), p1[1] + head * math.sin(ang + da))], fill=color, width=4)


def _dashhead(draw, p0, p1, color, head):
    import math
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    for da in (math.radians(155), math.radians(-155)):
        draw.line([p1, (p1[0] + head * math.cos(ang + da), p1[1] + head * math.sin(ang + da))], fill=color, width=3)


def _dash(draw, p0, p1, color, width):
    import math
    dist = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    n = max(2, int(dist / 22))
    for i in range(0, n - 1, 2):
        a = (p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n)
        b = (p0[0] + (p1[0] - p0[0]) * (i + 1) / n, p0[1] + (p1[1] - p0[1]) * (i + 1) / n)
        draw.line([a, b], fill=color, width=width)


def title(draw, text):
    draw.text((40, 24), text, font=FT, fill=NAVY)
    draw.line([(40, 78), (40 + draw.textlength(text, font=FT), 78)], fill=AMBER, width=5)


def figure1():
    img, d = canvas()
    title(d, 'System Context and External Integrations')
    box(d, (80, 200, 380, 330), 'Traveler', 'Browser (desktop/mobile)', fill=GREEN_FILL, outline=GREEN)
    box(d, (600, 150, 1060, 330), 'React 19 SPA (Vite)', 'Presentation tier; Leaflet maps;\nnavigator.geolocation', tcolor=NAVY)
    box(d, (1290, 150, 1760, 330), 'FastAPI Backend', 'REST/JSON; Pydantic v2;\nCORS; LangGraph runtime', tcolor=NAVY)
    arrow(d, (380, 265), (600, 240), label='HTTPS / UI')
    arrow(d, (1060, 240), (1290, 240), label='REST JSON')
    arrow(d, (600, 300), (1290, 300), color=STEEL, dashed=True, label='OSRM + OSM tiles\n(direct client calls)')
    exts = [
        ('Groq LLM API', 'qwen/qwen3.8-27b · personalization + slot extraction'),
        ('SerpApi', 'Google Flights · Google Maps · Google Hotels'),
        ('Overpass API', 'OpenStreetMap factual fallback (POI tags)'),
        ('Nominatim', 'Forward/reverse geocoding of places'),
        ('Open-Meteo', 'Destination weather forecast'),
        ('Google Places API v1', 'Opening hours + photography enrichment'),
    ]
    for i, (t, s) in enumerate(exts):
        y = 140 + i * 205
        box(d, (1990, y, 2340, y + 160), t, s, sub_font=FS, title_font=FSB, fill=AMBER_FILL, outline=AMBER)
        arrow(d, (1760, 240 + (i - 2.5) * 18), (1990, y + 80), color=STEEL, width=3, label='')
    box(d, (1290, 460, 1760, 610), 'MongoDB (Atlas/local)', 'trips · users · conversations · messages', sub_font=FS, tcolor=NAVY)
    arrow(d, (1525, 330), (1525, 460), label='PyMongo (pymongo)')
    box(d, (1990, 980, 2340, 1130), 'Ollama (local)', 'nomic-embed-text embeddings → ChromaDB vector store', sub_font=FS, fill=AMBER_FILL, outline=AMBER)
    arrow(d, (1760, 560), (1990, 1040), color=STEEL, width=3, dashed=True, label='RAG embeddings')
    box(d, (80, 980, 1060, 1130), 'Browser localStorage', 'Chat messages, travel context, execution-state cache;\ndeclared API base URL override (client-side resilience cache)', sub_font=FS, fill=LIGHT, outline=GRAY)
    arrow(d, (600, 980), (830, 330), color=GRAY, dashed=True, label='')
    note = ('Audited boundary: backend transit estimation is Haversine-based; OSRM street routing is executed '
            'by the frontend. The two subsystems are therefore not a single server-side routing chain.')
    d.rectangle([80, 1380, 2340, 1470], fill=LIGHT, outline=NAVY, width=2)
    y = 1392
    for line in wrap(d, note, FS, 2200):
        d.text((100, y), line, font=FS, fill=INK)
        y += 28
    img.save(os.path.join(OUT, 'figure1_system_context.png'), dpi=(300, 300))


def figure2():
    img, d = canvas()
    title(d, 'Three-Tier Application Architecture')
    d.rounded_rectangle([70, 120, 2330, 430], radius=20, outline=NAVY, width=3)
    d.text((100, 140), 'Presentation tier — React 19 / TypeScript / Tailwind 4', font=FB, fill=NAVY)
    pres = [('Planner Studio', 'Chat + preference intake'), ('Dashboard', 'Route · Companion'), ('Itinerary Hub', 'Saved-trip management'), ('Places Memory', 'Curated place list'), ('Bookings Desk', 'Flight/hotel context')]
    for i, (t, s) in enumerate(pres):
        x = 110 + i * 444
        box(d, (x, 205, x + 400, 390), t, s, title_font=FSB, sub_font=FS)
    d.rounded_rectangle([70, 470, 2330, 980], radius=20, outline=STEEL, width=3)
    d.text((100, 490), 'Application and orchestration tier — FastAPI + LangGraph', font=FB, fill=STEEL)
    app = [('API routers', '/trips · /chat · /auth'), ('Chat & slot service', 'intent + context'), ('Reroute service', 'Skip & Replace'), ('Q&A service', 'RAG/live data'), ('LangGraph', 'parser→planner→agents'), ('Agent pool', 'attractions · flights · hotels · route')]
    for i, (t, s) in enumerate(app):
        x = 110 + (i % 3) * 750
        y = 545 + (i // 3) * 205
        box(d, (x, y, x + 700, y + 160), t, s, title_font=FSB, sub_font=FS, fill=WHITE, outline=STEEL)
    d.rounded_rectangle([70, 1020, 2330, 1350], radius=20, outline=GREEN, width=3)
    d.text((100, 1040), 'Persistence and knowledge tier', font=FB, fill=GREEN)
    box(d, (110, 1100, 1100, 1300), 'MongoDB document store', 'Trip documents, embedded route_details, execution_state,\nrevision counter, conversations, users', title_font=FSB, sub_font=FS, fill=GREEN_FILL, outline=GREEN)
    box(d, (1260, 1100, 2290, 1300), 'ChromaDB + Ollama embeddings', 'WikiVoyage-derived travel knowledge; retrieval is used in the Q&A path.', title_font=FSB, sub_font=FS, fill=GREEN_FILL, outline=GREEN)
    arrow(d, (1200, 430), (1200, 470), label='Component / service calls')
    arrow(d, (600, 980), (600, 1020), label='PyMongo')
    arrow(d, (1770, 980), (1770, 1020), label='Retrieval')
    img.save(os.path.join(OUT, 'figure2_three_tier.png'), dpi=(300, 300))


def figure3():
    img, d = canvas()
    title(d, 'Agent Orchestration and Multi-Tier Factual Discovery')
    box(d, (90, 140, 400, 260), 'parser', 'LLM slots · structured skip', title_font=FSB)
    box(d, (90, 340, 400, 460), 'planner', 'deterministic draft text', title_font=FSB)
    box(d, (570, 130, 860, 235), 'flights', 'SerpApi Google Flights', title_font=FSB)
    box(d, (570, 250, 860, 355), 'hotels', 'SerpApi Hotels/Maps', title_font=FSB)
    box(d, (570, 370, 860, 475), 'weather', 'Open-Meteo', title_font=FSB)
    box(d, (570, 490, 860, 595), 'attractions', 'LLM + SerpApi + OSM', title_font=FSB)
    box(d, (570, 610, 860, 715), 'restaurants', 'SerpApi + OSM', title_font=FSB)
    box(d, (1030, 340, 1290, 460), 'budget', 'partial cost estimate', title_font=FSB)
    box(d, (1410, 340, 1680, 460), 'route', 'time-aware scheduler', title_font=FSB)
    box(d, (1800, 340, 2060, 460), 'reviewer', 'validation gate', title_font=FSB)
    box(d, (1800, 600, 2060, 720), 'synthesis', 'deterministic narrative', title_font=FSB)
    box(d, (2170, 600, 2330, 720), 'END', '', title_font=FSB)
    for p in [(400, 200, 570, 182), (400, 240, 570, 297), (400, 260, 570, 412), (400, 280, 570, 527), (400, 300, 570, 647)]:
        arrow(d, p[:2], p[2:], width=3)
    arrow(d, (240, 260), (240, 340))
    for x in (860,) * 1:
        for y in (182, 297, 412, 527, 647):
            arrow(d, (x, y), (1030, 400), width=2, color=STEEL)
    arrow(d, (1290, 400), (1410, 400))
    arrow(d, (1680, 400), (1800, 400))
    arrow(d, (1930, 460), (1930, 600), label='approve', color=GREEN)
    arrow(d, (1800, 420), (400, 420), dashed=True, color=RED, label='retry is presently unreachable after a single planner step')
    arrow(d, (2060, 660), (2170, 660))
    tiers = [('Layer 1 — Groq LLM', 'candidate generation and slot extraction', LIGHT),
             ('Layer 2 — SerpApi', 'Google Maps / Flights / Hotels enrichment', AMBER_FILL),
             ('Layer 3 — Overpass OSM', 'factual POI fallback', AMBER_FILL),
             ('Layer 4 — Nominatim', 'coordinate and place resolution', LIGHT)]
    for i, (t, s, fill) in enumerate(tiers):
        x = 100 + i * 580
        box(d, (x, 950, x + 520, 1080), t, s, title_font=FSB, sub_font=FS, fill=fill)
        if i < 3:
            arrow(d, (x + 520, 1015), (x + 580, 1015), width=3, color=GRAY)
    d.text((100, 870), 'Fallback order differs by specialist agent; nonempty layer halts later layers.', font=FS, fill=GRAY)
    note = ('Known fallback caveat: an unknown destination geocode can resolve to the documented Delhi fallback, '
            'and a failed hotel search can emit a synthetic “Grand Heritage Hotel” entry.')
    d.text((100, 1150), note, font=FS, fill=GRAY)
    img.save(os.path.join(OUT, 'figure3_agents_discovery.png'), dpi=(300, 300))


def figure4():
    img, d = canvas()
    title(d, 'Time-Aware Daily Itinerary Engine')
    box(d, (80, 130, 520, 280), 'Authoritative dates', 'start/end inclusive day count overrides days', title_font=FSB)
    box(d, (700, 130, 1120, 280), 'IANA destination time', 'destination name → ZoneInfo; default Asia/Kolkata', title_font=FSB)
    box(d, (1300, 130, 1740, 280), 'Day classification', 'arrival · exploration · departure', title_font=FSB)
    arrow(d, (520, 205), (700, 205))
    arrow(d, (1120, 205), (1300, 205))
    box(d, (80, 370, 460, 510), 'Pace profile', 'relaxed/balanced/packed visit duration and bedtime', title_font=FSB)
    box(d, (580, 370, 960, 510), 'Wake / bedtime', '08:30 / 08:00 / 07:30 wake; 21:30 / 22:00 / 22:30 bed', title_font=FSB)
    box(d, (1080, 370, 1500, 510), 'Meal templates', 'hotel breakfast · lunch 12:30 · dinner 19:30', title_font=FSB)
    box(d, (1620, 370, 2040, 510), 'Transit estimate', 'Haversine · walking <1 km · driving otherwise', title_font=FSB)
    arrow(d, (460, 440), (580, 440))
    arrow(d, (960, 440), (1080, 440))
    arrow(d, (1500, 440), (1620, 440))
    box(d, (80, 630, 1010, 810), 'Exploration-day loop', 'select highest-priority or nearest attraction; append meal stop when its window is reached; advance cursor by visit + transit.', title_font=FSB, sub_font=FS)
    box(d, (1100, 630, 2040, 810), 'Arrival / departure templates', 'airport check-in, arrival clearance, hotel check-in/out, airport transfer; departure uses fixed template times.', title_font=FSB, sub_font=FS)
    arrow(d, (2040, 440), (2040, 630), width=3, color=STEEL)
    box(d, (700, 900, 1360, 1050), 'Daily ActivitySegment[]', 'start_time, end_time, id, type, coordinates, transit metadata', title_font=FSB, sub_font=FS, fill=GREEN_FILL, outline=GREEN)
    arrow(d, (545, 810), (860, 900))
    arrow(d, (1570, 810), (1190, 900))
    note = ('The engine formats times as minutes within a day. A final global overlap, opening-hour, fixed-flight, or\n'
            'custom-bedtime guarantee is not performed by initial route generation; reroute preview has a narrower set of checks.')
    d.text((80, 1150), note, font=FS, fill=GRAY)
    img.save(os.path.join(OUT, 'figure4_time_engine.png'), dpi=(300, 300))


def swim(draw, x0, y0, y1, label):
    draw.line([(x0, y0), (x0, y1)], fill=NAVY, width=3)
    draw.rectangle([x0 - 190, y0 - 50, x0 + 190, y0 + 50], fill=NAVY)
    lines = wrap(draw, label, FSB, 340)
    for i, t in enumerate(lines):
        draw.text((x0 - draw.textlength(t, font=FSB) / 2, y0 - 20 + i * 30 - (len(lines) - 1) * 12), t, font=FSB, fill=WHITE)


def figure5():
    img, d = canvas()
    title(d, 'Itinerary Generation Sequence')
    # lanes: 0=Traveler, 1=React SPA, 2=FastAPI /trips/plan, 3=LangGraph pipeline, 4=MongoDB
    xs = [250, 720, 1180, 1620, 2130]
    labels = ['Traveler', 'React SPA', 'FastAPI /trips/plan', 'LangGraph agent pipeline', 'MongoDB']
    for x, label in zip(xs, labels):
        swim(d, x, 160, 1420, label)
    def seq(y, a, b, label, color=NAVY, dashed=False, width=4):
        arrow(d, (xs[a], y), (xs[b], y), color=color, dashed=dashed, width=width, label=label)
    def note(y, text, color=STEEL):
        x = xs[3] + 26
        draw_lines = wrap(d, text, FS, 380)
        lh = FS.getmetrics()[0] + FS.getmetrics()[1]
        d.rectangle([x, y - 6, x + 402, y + len(draw_lines) * lh + 6], fill=WHITE, outline=color, width=2)
        for i, line in enumerate(draw_lines):
            d.text((x + 10, y + i * lh), line, font=FS, fill=color)
    seq(265, 0, 1, 'submit travel form', GREEN)
    seq(355, 1, 2, 'POST /api/trips/plan', GREEN)
    seq(445, 2, 3, 'invoke compiled graph')
    note(530, 'parser → planner → parallel specialist agents')
    note(650, 'budget → time-aware route_agent')
    note(770, 'reviewer → synthesis (retry loop unreachable)')
    seq(900, 3, 2, 'final graph state: itinerary payload', GREEN, dashed=True)
    seq(990, 2, 4, 'insert trip (revision defaults to 1)')
    seq(1070, 4, 2, 'saved trip', GREEN, dashed=True)
    seq(1150, 2, 1, 'TripResponse', GREEN, dashed=True)
    seq(1230, 1, 0, 'render dashboard and Companion Mode', GREEN, dashed=True)
    d.text((60, 1330), 'Note: /api/chat/message can invoke the same graph for a conversational GENERATE_ITINERARY intent.', font=FS, fill=GRAY)
    img.save(os.path.join(OUT, 'figure5_generation_sequence.png'), dpi=(300, 300))


def figure6():
    img, d = canvas()
    title(d, 'Dynamic Skip, Reroute Preview, and Apply Sequence')
    # lanes: 0=Traveler, 1=Companion UI, 2=execution_state API, 3=reroute preview/apply API, 4=MongoDB
    xs = [220, 650, 1090, 1540, 2110]
    labels = ['Traveler', 'Companion Mode UI', 'execution_state API', 'reroute preview/apply API', 'MongoDB']
    for x, label in zip(xs, labels):
        swim(d, x, 160, 1470, label)
    def seq(y, a, b, label, color=NAVY, dashed=False):
        arrow(d, (xs[a], y), (xs[b], y), color=color, dashed=dashed, label=label)
    seq(250, 0, 1, 'Tap Skip')
    seq(315, 1, 2, 'POST execution_state: status=skipped')
    seq(380, 2, 4, 'persist skip entry')
    seq(445, 1, 3, 'POST reroute/preview (GPS, expected_revision)')
    seq(510, 3, 4, 'load trip + target day')
    for y, text in ((575, 'classify purpose; apply chronological cutoff'), (640, 'candidate tiers + distance scoring')):
        x = xs[3] + 26
        d.rectangle([x, y - 6, x + 448, y + 34], fill=WHITE, outline=STEEL, width=2)
        d.text((x + 8, y), text, font=FS, fill=STEEL)
    seq(690, 3, 1, 'proposal_id + proposed_stops (server holds no copy)', GREEN, dashed=True)
    seq(750, 1, 0, 'preview modal', GREEN, dashed=True)
    box(d, (450, 790, 2290, 1200), '', '', fill=(250, 251, 253), outline=DASH)
    d.text((470, 803), 'Accept path', font=FB, fill=GREEN)
    seq(870, 0, 1, 'Accept', color=GREEN)
    seq(930, 1, 3, 'POST apply: proposed_stops + expected_revision')
    seq(995, 3, 4, 'read; compare revision (not atomic CAS)')
    seq(1060, 3, 4, 'write day + accepted history + revision+1')
    seq(1130, 3, 1, '200 updated state / 409 stale revision', RED, dashed=True)
    box(d, (450, 1240, 2290, 1410), '', '', fill=(250, 251, 253), outline=DASH)
    d.text((470, 1253), 'Reject/cancel path', font=FB, fill=RED)
    seq(1340, 0, 1, 'Keep schedule — clears modal locally; no server record', RED, dashed=True)
    d.text((60, 1500), 'No proposal TTL, proposal retrieval endpoint, rejection audit record, or signed proposal binding exists.', font=FS, fill=GRAY)
    img.save(os.path.join(OUT, 'figure6_reroute_sequence.png'), dpi=(300, 300))


def entity(draw, xy, name, fields, fill=LIGHT, outline=NAVY):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=12, fill=fill, outline=outline, width=3)
    draw.rectangle([x0 + 3, y0 + 3, x1 - 3, y0 + 58], fill=outline)
    draw.rounded_rectangle([x0 + 3, y0 + 3, x1 - 3, y0 + 60], radius=10, fill=outline)
    draw.text((x0 + 18, y0 + 15), name, font=FB, fill=WHITE)
    y = y0 + 76
    for f in fields:
        draw.text((x0 + 18, y), f, font=FS, fill=INK)
        y += 30


def figure7():
    img, d = canvas()
    title(d, 'Trip, Execution-State, and Identity Data Model')
    entity(d, (80, 140, 760, 730), 'trip', ['_id / id: ObjectId', 'user_id: string (client-trusted)', 'destination, timezone, revision', 'travel_context, all_attractions', 'restaurants, hotels, flights', 'route_details (embedded)', 'execution_state (embedded)', 'created_at / updated_at'])
    entity(d, (890, 140, 1590, 560), 'route_details', ['destination_timezone', 'day_by_day_route[]', 'day, date, title', 'is_flight_day', 'stops[]', 'activities[]', 'formatted_date'])
    entity(d, (1700, 140, 2330, 700), 'stops / ActivitySegment', ['id = act_{type}_{slug}_{disambig}', 'type, category, sub_type', 'start_time, end_time, duration', 'lat, lon, place_id', 'status_label, rescheduled', 'replacement metadata', 'opening-hours metadata'])
    entity(d, (890, 680, 1590, 1080), 'execution_state', ['is_active, current_day_number', 'activity_log: persistent-key map', 'status + actual times', 'reroute_history: accepted records', 'legacy position key retained'])
    entity(d, (80, 860, 760, 1130), 'users', ['_id, name, lower-case email', 'password_hash: PBKDF2-HMAC-SHA256', 'created_at'])
    entity(d, (1700, 860, 2330, 1190), 'conversations + messages', ['conversation_id, title, status', 'travel_context, current_trip_id', 'message_id, role, content', 'intent, structured data'])
    arrow(d, (760, 300), (890, 300), label='1:1', width=3)
    arrow(d, (1590, 420), (1700, 420), label='1:N', width=3)
    arrow(d, (760, 850), (890, 800), label='1:1', width=3)
    arrow(d, (1330, 680), (1330, 560), label='embedded', width=3, dashed=True, color=STEEL)
    arrow(d, (760, 995), (1700, 995), label='conversation references trip by current_trip_id (logical)', color=GRAY, dashed=True)
    d.text((80, 1330), 'Revision is conditionally checked before apply and incremented; the update filter does not contain revision, hence this is not CAS.', font=FS, fill=RED)
    d.text((80, 1390), 'Execution state is a document replacement path, not an activity-level merge endpoint.', font=FS, fill=GRAY)
    img.save(os.path.join(OUT, 'figure7_data_model.png'), dpi=(300, 300))


if __name__ == '__main__':
    for f in (figure1, figure2, figure3, figure4, figure5, figure6, figure7):
        f()
    print('figures rendered:', sorted(os.listdir(OUT)))
