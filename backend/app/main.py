import asyncio
import logging
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from .api import api
from .config import settings
from .db import engine
from .models import Competition, now
from .services import finalize

log = logging.getLogger("smarttrack")


def finalize_due():
    with Session(engine()) as db:
        ids = db.scalars(
            select(Competition.id)
            .where(
                Competition.status == "FINALIZING", Competition.finalize_after <= now()
            )
            .limit(100)
        ).all()
    for cid in ids:
        with Session(engine()) as db, db.begin():
            finalize(db, cid)


async def worker():
    while True:
        if settings().database_url:
            try:
                await asyncio.to_thread(finalize_due)
            except Exception:
                log.exception("Finalization worker failed; will retry")
        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="SmartTrack API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings().cors_origins.split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(api)

# Per-process protection; production ingress must enforce a shared rate limit.
windows = defaultdict(deque)


@app.middleware("http")
async def protect(request: Request, call_next):
    try:
        length = int(request.headers.get("content-length", "0") or 0)
    except ValueError:
        return JSONResponse({"detail": "Invalid content length"}, 400)
    if length > 256000:
        return JSONResponse({"detail": "Request too large"}, 413)
    key = request.client.host if request.client else "unknown"
    stamp = time.monotonic()
    q = windows[key]
    while q and q[0] < stamp - 60:
        q.popleft()
    if len(q) >= 600:
        return JSONResponse(
            {"detail": "Too many requests; retry shortly"},
            429,
            headers={"Retry-After": "60"},
        )
    q.append(stamp)
    if len(windows) > 10000:
        for k in list(windows):
            if not windows[k] or windows[k][-1] < stamp - 60:
                windows.pop(k, None)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(IntegrityError)
async def integrity(request, exc):
    return JSONResponse(
        {
            "detail": "This change conflicts with an existing record or database constraint"
        },
        409,
    )


@app.exception_handler(SQLAlchemyError)
async def unavailable(request, exc):
    log.exception("Database request failed")
    return JSONResponse({"detail": "Database temporarily unavailable"}, 503)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "configured": bool(settings().database_url and settings().supabase_url),
    }


@app.get("/ready")
def ready():
    if not settings().database_url:
        return JSONResponse({"status": "not_configured"}, 503)
    with engine().connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ready"}
