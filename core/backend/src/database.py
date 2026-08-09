import os
import urllib.parse
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()


def _build_database_url() -> str:
    """Prefer building the URL from individual env vars so special characters
    in the password (e.g. ``!``, ``@``, ``:``) are properly percent-encoded.
    Falls back to a pre-built ``DATABASE_URL`` if no individual vars are set,
    which keeps the local-dev path working when someone exports a full DSN."""
    user = os.getenv("POSTGRES_USER")
    db = os.getenv("POSTGRES_DB")
    if user and db:
        password = urllib.parse.quote(os.getenv("POSTGRES_PASSWORD", ""), safe="")
        host = os.getenv("POSTGRES_HOST", "db" if os.path.exists("/.dockerenv") else "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        return f"postgresql://{user}:{password}@{host}:{port}/{db}"
    return os.getenv("DATABASE_URL")


DATABASE_URL = _build_database_url()

# Pool sizing has to cover uvicorn's worker threadpool. Every route handler in
# api.py is a sync ``def``, so Starlette runs it in anyio's threadpool — 40
# threads by default. When the pool can serve fewer connections than that, a
# traffic burst leaves threads blocked in ``QueuePool._do_get`` waiting for a
# connection that never frees, and every DB-backed route stops answering while
# Postgres itself sits idle. Keep pool_size + max_overflow >= the thread count,
# and the total well under Postgres ``max_connections`` (default 100) — the
# import/match tools open their own separate engines on top of this.
POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
# Fail in seconds rather than hanging: a 500 shows up in the logs and the
# client retries, whereas a hung request just looks like the site is down.
POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "10"))
# Server-side guards so neither a runaway query nor an abandoned transaction
# can pin a pooled connection indefinitely. These apply only to the API; the
# tools in core/tools/ build their own engines and stay unrestricted.
STATEMENT_TIMEOUT_MS = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "60000"))
IDLE_TX_TIMEOUT_MS = int(os.getenv("DB_IDLE_TX_TIMEOUT_MS", "60000"))

engine = create_engine(
    DATABASE_URL,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    # Validate a pooled connection before handing it out. Without this, a
    # connection killed server-side (db restart, pg_terminate_backend, an idle
    # timeout) is handed to a request that then blocks on a dead socket.
    pool_pre_ping=True,
    pool_recycle=300,
    connect_args={
        "connect_timeout": 10,
        "options": (
            f"-c statement_timeout={STATEMENT_TIMEOUT_MS}"
            f" -c idle_in_transaction_session_timeout={IDLE_TX_TIMEOUT_MS}"
        ),
    },
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
