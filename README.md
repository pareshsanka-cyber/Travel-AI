# TravelAI — Autonomous Intelligent Travel Planning & Companion Platform

TravelAI is an autonomous, agentic travel planning and companion system powered by multi-agent architectures (LangGraph, FastAPI), intelligent retrieval (ChromaDB RAG), real-time live discovery (SerpApi), and a dynamic interactive React/Vite interface.

---

## 🏗️ System Architecture

TravelAI combines conversational slot extraction, multi-agent orchestration, time-aware itinerary scheduling, and live rerouting.

See the [current architecture and workflow guide](docs/architecture-workflow.md) for system diagrams, planning/booking/rerouting flows, data storage and the key concepts to explain during a demonstration.

![MVC Architecture](MVC%20ARCHITECTURE.png)
![MongoDB Data Model Architecture](architecture-mongodb.png)

---

## 📁 Repository Structure

```text
Travel-AI/
├── Backend/                        # FastAPI Python Backend
│   ├── app/
│   │   ├── ai/
│   │   │   ├── agents/             # Specialized agents (Attraction, Flight, Hotel, Route, etc.)
│   │   │   ├── orchestrator/       # LangGraph graph, planner & parser agents
│   │   │   ├── rag/                # ChromaDB vector store, embedder & regional knowledge
│   │   │   ├── reviewer/           # Verification & consistency agents
│   │   │   └── llm.py              # Groq generation client and rate coordination
│   │   ├── api/                    # API route controllers (trips, chat, auth)
│   │   ├── database/               # MongoDB client & connections
│   │   ├── models/                 # Pydantic document models; persistence uses PyMongo
│   │   ├── schemas/                # Request/response DTO schemas
│   │   ├── services/               # Chat, Reroute & Slot extraction services
│   │   └── main.py                 # FastAPI application entrypoint
│   ├── requirements.txt            # Python dependencies
│   └── .env.example                # Backend environment configuration template
│
├── Frontend/                       # React 19 + TypeScript + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/             # Reusable UI components & preference popovers
│   │   │   └── tabs/               # Day detail, maps, flights, hotels, companion mode
│   │   ├── pages/                  # Planner Studio, Bookings Desk, Hub, Auth
│   │   ├── services/               # API clients & Leaflet routing engines
│   │   └── types/                  # TypeScript interface definitions
│   ├── package.json                # Frontend dependencies
│   └── .env.example                # Frontend environment configuration template
│
└── docs/                           # Documentation and SRS specifications
    └── academic/                   # Software Requirements Specification (SRS) & evidence
```

---

## 🚀 Quickstart Guide

### 1. Prerequisites
- **Python**: 3.10+
- **Node.js**: 22.12+
- **MongoDB**: Local community instance or MongoDB Atlas cluster
- **Ollama for RAG**: Start Ollama and install the `nomic-embed-text` embedding model (`ollama pull nomic-embed-text`). Without it, retrieval cannot provide regional knowledge.

---

### 2. Backend Setup

```bash
# Navigate to the backend directory
cd Backend

# Create and activate virtual environment
python -m venv .venv
# On Windows:
.\.venv\Scripts\activate
# On Unix/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
cp .env.example .env
# Edit .env and supply your GROQ_API_KEY, SERPAPI_API_KEY, and MONGODB_URI

# Launch the FastAPI development server
uvicorn app.main:app --reload
```
The backend API documentation will be accessible at: `http://localhost:8000/docs`

The backend verifies MongoDB connectivity and creates indexes at startup. Backend dependencies are pinned to the versions used by the regression checks; `tzdata` supplies timezone support on Windows.

To load the regional travel guides, run `python -m app.ai.rag.ingest` from `Backend/` after starting Ollama. Re-running ingestion uses stable document IDs. Guide content should be reviewed for freshness; it is reference material, not live availability.

---

### 3. Frontend Setup

```bash
# Navigate to the frontend directory
cd Frontend

# Install packages
npm install

# Configure environment variables (optional, defaults to http://localhost:8000)
cp .env.example .env.local

# Start development server
npm run dev
```
The web application will launch at: `http://localhost:3000`

Authentication and travel requests share `VITE_FASTAPI_URL` (default `http://localhost:8000`) and the API configuration override. Set `CORS_ORIGINS` in the backend environment for your deployed frontend origin. Use HTTPS when deploying.

---

## 🔑 Key Features
- **Conversational Travel Assistant**: Intelligent intent detection and conversational memory.
- **Multi-Agent Engine**: Modular discovery agents for Attractions, Dining, Accommodations, and Flights.
- **Time-Aware Sequencing**: Geographic routing and schedule validation.
- **Companion Mode & Dynamic Rerouting**: Live on-trip rerouting, progress tracking, and fallback discovery.
- **Saved Travel Choices**: Flight and accommodation choices persist with your trip. Changes update the schedule and known costs while preserving custom visits; choices are frozen after Companion Mode begins.
- **Trip Readiness**: My Trip → Overview includes a collapsible checklist for planned flights and hotels, saved forecast coverage, incomplete or over-budget estimates, and venue opening hours. Links open the relevant review tab. It reads saved information without changing the trip; demo booking status is separate from planning selections and real reservations.
- **Useful Exports**: Download calendar events for actual visits, copy itinerary text, and print a clean itinerary to PDF. Calendar export respects activity timezones and daylight-saving changes.

## Sessions, schedules, and data limitations

- Sessions expire after 24 hours. MongoDB stores only token digests; logout revokes the current session. Every travel and conversation endpoint requires a verified bearer session and enforces ownership. The legacy `X-User-ID` header cannot select another user's data.
- Existing accounts can log in again; previously issued tokens will no longer work. Records without a `user_id` remain inaccessible through authenticated APIs. Do not automatically assign legacy records to whichever user logs in.
- Chat edits support removing or replacing an existing attraction/restaurant and changing visit duration. Replacements must come from the trip's discovered places. Unsupported or unsafe edits leave the schedule unchanged. Completed activities and travel stops are protected.
- Reroute previews expire after 15 minutes. Applying a preview uses the server's saved proposal and an atomic revision comparison. Progress writes also require the current revision; conflicts return HTTP 409.
- Travel Selections displays chosen options, not confirmed reservations. No ticket, room, transfer, PNR, or voucher is issued. The example places library is demo content.
- Budgets show a **known-cost subtotal**, with food, transport, return flights, and other missing prices disclosed. One-way flight prices are not doubled into an invented return fare.
- Weather uses destination coordinates and the requested dates. Dates outside the provider's 16-day window show unavailable; no forecast is fabricated. Unknown opening hours remain unverified.

## Demo payments and Trip Plus

Flight and hotel cards now offer **Book — Demo**, with separate checkout and booking history in **Travel Selections**. Successful demo bookings include Trip Plus and Companion Mode for that trip at no extra simulated charge. Fictional sample choices appear separately when priced results are unavailable. See [the demo-booking guide](docs/demo-bookings.md). No money is charged or real reservation made.

Open a saved trip and choose **Upgrade this trip**, or use **Payments** in the sidebar. Trip Plus costs a simulated ₹499 once per trip and unlocks Companion Mode, rerouting, calendar and printable exports. Basic planning and travel selections stay free. No real money, bank details or reservations are involved. Restart the backend to register the new payment routes and MongoDB indexes; no new credentials are required. See [the demo-payment guide](docs/demo-payments.md) for the flow, API and verification details.

## Verification commands

Planning progress reports actual backend stages through authenticated `/api/chat/requests` endpoints. Refresh checks the same saved request rather than creating another itinerary. Unavailable provider results remain labelled unavailable. Run the demo backend with one Uvicorn worker: interrupted requests are marked on restart; completed request records expire after seven days, while saved itineraries remain intact. Older backends retain the synchronous chat flow.

Generated `Frontend/dist`, browser reports, Vite caches and Python `__pycache__` folders are disposable and ignored by Git. Builds and tests regenerate them. Keep `.env`, the virtual environment, installed dependencies, MongoDB/Chroma data, source tests and `package-lock.json`; they are not cleanup targets. Local `.cache` also contains the MongoDB runtime, recovery backups and review screenshots, so do not delete it wholesale.

Run from `Frontend/`: `npm run lint`, `npm test`, and `npm run build`.

For desktop and mobile browser checks, run `npm run browsers:install` once, then `npm run test:e2e`. Tests use fixture APIs and do not create real accounts or call travel providers. The GitHub Actions workflow runs backend, frontend, and browser checks on pushes and pull requests.

Run these scripts from `Backend/` using the virtual environment's Python:

```text
python run_regressions.py
```

Or run individual suites:

```text
python security_consistency_tests.py
python activity_identity_audit_tests.py
python itinerary_engine_audit_tests.py
python dynamic_reroute_tests.py
python phase2_1_reroute_tests.py
```

The security/consistency suite uses isolated in-memory storage and mocks providers. Live graph, conversational, and flight audit scripts may call external services and require working provider credentials, MongoDB, and Ollama. Offline checks do not establish live provider availability.

The public `/health/ready` endpoint checks database availability. API responses include a request ID for diagnosing failures, and internal server errors are not returned to the browser. See [project quality notes](docs/project-quality.md) for current capabilities and limitations.
