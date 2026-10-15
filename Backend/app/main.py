import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.trips import router as trips_router
from app.api.chat import router as chat_router
from app.api.auth import router as auth_router
from app.api.payments import router as payments_router
from app.api.bookings import router as bookings_router
from contextlib import asynccontextmanager
from app.database.mongodb import db, client
from app.services.conversation_service import setup_indexes
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import logging
import time
import uuid

@asynccontextmanager
async def lifespan(app):
    client.admin.command("ping")
    setup_indexes()
    db.users.create_index("email", unique=True)
    db.sessions.create_index("token_hash", unique=True)
    db.sessions.create_index("expires_at", expireAfterSeconds=0)
    db.reroute_proposals.create_index("expires_at", expireAfterSeconds=0)
    db.trips.create_index([("user_id", 1), ("created_at", -1)])
    from app.services.booking_service import setup_indexes as setup_payment_indexes
    setup_payment_indexes(db)
    db.conversations.create_index([("user_id", 1), ("updated_at", -1)])
    yield
    client.close()

app = FastAPI(title="TravelAI API", lifespan=lifespan)
logger = logging.getLogger('travelai.api')


@app.middleware('http')
async def request_logging(request, call_next):
    request.state.request_id = uuid.uuid4().hex
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception as error:
        # Return inside CORSMiddleware, including failures outside route handlers.
        response = await unexpected_error(request, error)
    response.headers['X-Request-ID'] = request.state.request_id
    logger.info('%s %s status=%s duration_ms=%d request_id=%s', request.method,
                request.url.path, response.status_code, int((time.monotonic() - started) * 1000), request.state.request_id)
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request, error):
    detail = error.detail if error.status_code < 500 else 'The service could not complete this request. Please try again.'
    return JSONResponse(status_code=error.status_code, content={'detail': detail,
        'request_id': getattr(request.state, 'request_id', None)}, headers=error.headers)


@app.exception_handler(Exception)
async def unexpected_error(request, error):
    request_id = getattr(request.state, 'request_id', None)
    import traceback
    frames = [(frame.filename, frame.lineno, frame.name) for frame in traceback.extract_tb(error.__traceback__)]
    logger.error('Unhandled %s operation=%s %s request_id=%s frames=%s', type(error).__name__, request.method, request.url.path, request_id, frames)
    return JSONResponse(status_code=500, content={'detail':'An unexpected error occurred. Please try again.', 'request_id':request_id})

# Next.js default port is 3000, Vite default port is 5173
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", ",".join(ALLOWED_ORIGINS)).split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

app.include_router(trips_router, prefix="/api/trips", tags=["Trips"])
app.include_router(chat_router, tags=["Chat"])
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(payments_router, prefix='/api/payments', tags=['Demo payments'])
app.include_router(bookings_router, prefix='/api/bookings', tags=['Demo bookings'])

# Direct Flights API route alias
from app.api.trips import search_flights_endpoint
app.post("/api/flights/search", tags=["Flights"])(search_flights_endpoint)

@app.get("/")
def read_root():
    return {"status": "ok", "message": "TravelAI API is running."}


@app.get('/health/ready', tags=['Health'])
def readiness():
    try:
        client.admin.command('ping')
    except Exception:
        return JSONResponse(status_code=503, content={'status':'unavailable','message':'Database unavailable. Please try again shortly.'})
    return {'status':'ok','message':'TravelAI is ready.'}
