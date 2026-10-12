# TravelAI — Autonomous Intelligent Travel Planning & Companion Platform

TravelAI is an autonomous, agentic travel planning and companion system powered by multi-agent architectures (LangGraph, FastAPI), intelligent retrieval (ChromaDB RAG), real-time live discovery (SerpApi), and a dynamic interactive React/Vite interface.

---

## 🏗️ System Architecture

TravelAI combines conversational slot extraction, multi-agent orchestration, time-aware itinerary scheduling, and live rerouting.

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
│   │   │   └── llm.py              # LLM client abstractions (Groq / Ollama)
│   │   ├── api/                    # API route controllers (trips, chat, auth)
│   │   ├── database/               # MongoDB client & connections
│   │   ├── models/                 # Motor / Pydantic data models
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
- **Node.js**: 18+
- **MongoDB**: Local community instance or MongoDB Atlas cluster

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
The web application will launch at: `http://localhost:5173`

---

## 🔑 Key Features
- **Conversational Travel Assistant**: Intelligent intent detection and conversational memory.
- **Multi-Agent Engine**: Modular discovery agents for Attractions, Dining, Accommodations, and Flights.
- **Time-Aware Sequencing**: Geographic routing and schedule validation.
- **Companion Mode & Dynamic Rerouting**: Live on-trip rerouting, progress tracking, and fallback discovery.
