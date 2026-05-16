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

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
