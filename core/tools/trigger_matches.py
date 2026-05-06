#!/usr/bin/env python3
"""Queue and run cross-contributor match computation.

Usage:
    # All contributors
    docker compose exec api python tools/trigger_matches.py --all

    # One contributor
    docker compose exec api python tools/trigger_matches.py --contributor "Smith"

    # Multiple contributors
    docker compose exec api python tools/trigger_matches.py --contributor "Smith" --contributor "Jones"

Without arguments, prints current job queue status.
"""

import argparse
import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

try:
    from dotenv import load_dotenv
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    try:
        load_dotenv("../.env")
    except Exception:
        pass
    DATABASE_URL = (
        f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}"
        f"@localhost:5432/{os.getenv('POSTGRES_DB')}"
    )

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def queue_contributors(db, contributors):
    for c in contributors:
        db.execute(
            text("""
                INSERT INTO match_jobs (contributor, status, queued_at)
                VALUES (:c, 'pending', NOW())
                ON CONFLICT (contributor) DO UPDATE SET status = 'pending', queued_at = NOW()
            """),
            {"c": c},
        )
    db.commit()


def print_status(db):
    rows = db.execute(text("""
        SELECT status, COUNT(*) AS n
        FROM match_jobs
        GROUP BY status
        ORDER BY status
    """)).fetchall()
    if not rows:
        print("match_jobs table is empty — no matches have been computed yet.")
        return
    print("Current match_jobs status:")
    for r in rows:
        print(f"  {r.status:10s}  {r.n}")


def main():
    parser = argparse.ArgumentParser(description="Queue and run cross-contributor match computation.")
    parser.add_argument("--all", action="store_true", help="Queue all contributors")
    parser.add_argument("--contributor", metavar="NAME", action="append", dest="contributors",
                        help="Queue a specific contributor (repeatable)")
    parser.add_argument(
        "--workers", type=int, default=2,
        help="Number of parallel workers for match computation (default: 2)"
    )
    parser.add_argument(
        "--clear", action="store_true",
        help="Remove all pending jobs from the queue without running them"
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.clear:
            n = db.execute(
                text("DELETE FROM match_jobs WHERE status = 'pending'")
            ).rowcount
            db.commit()
            print(f"Cleared {n} pending job(s) from queue.")
            return

        if not args.all and not args.contributors:
            print_status(db)
            print("\nUse --all or --contributor NAME to queue jobs.")
            return

        if args.all:
            rows = db.execute(text("SELECT name FROM contributors ORDER BY name")).fetchall()
            targets = [r.name for r in rows]
            if not targets:
                print("No contributors found in database.")
                return
            print(f"Queuing {len(targets)} contributor(s)...")
        else:
            # Validate that requested contributors exist
            targets = []
            for name in args.contributors:
                row = db.execute(
                    text("SELECT name FROM contributors WHERE name = :n"), {"n": name}
                ).fetchone()
                if row:
                    targets.append(row.name)
                else:
                    print(f"Warning: contributor '{name}' not found in database, skipping.")
            if not targets:
                print("No valid contributors to queue.")
                return

        queue_contributors(db, targets)
        print(f"Queued: {', '.join(targets)}")
    finally:
        db.close()

    # Run compute_matches directly in the same process
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import compute_matches
    compute_matches.main(workers=args.workers)


if __name__ == "__main__":
    main()
