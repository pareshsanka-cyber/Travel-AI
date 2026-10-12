import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.trips import router as trips_router
from app.api.chat import router as chat_router
from app.api.auth import router as auth_router

app = FastAPI(title="TravelAI API")

# Next.js default port is 3000, Vite default port is 5173
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trips_router, prefix="/api/trips", tags=["Trips"])
app.include_router(chat_router, tags=["Chat"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])

# Direct Flights API route alias
from app.api.trips import search_flights_endpoint
app.post("/api/flights/search", tags=["Flights"])(search_flights_endpoint)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "TravelAI API is running."}