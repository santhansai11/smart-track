from functools import lru_cache
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from .config import settings


@lru_cache
def engine():
    url = settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not configured")
    if not url.startswith("postgresql+psycopg://"):
        raise RuntimeError("Production storage requires PostgreSQL with psycopg")
    return create_engine(
        url,
        pool_pre_ping=True,
        hide_parameters=True,
        pool_size=settings().db_pool_size,
        max_overflow=settings().db_max_overflow,
        pool_timeout=10,
        connect_args={"prepare_threshold": None},
    )


def database():
    with Session(engine(), expire_on_commit=False) as db:
        with db.begin():
            yield db
