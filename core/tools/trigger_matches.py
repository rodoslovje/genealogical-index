#!/usr/bin/env python3
"""Queue and run cross-contributor match computation.

Usage:
    # All contributors
    docker compose exec api python tools/trigger_matches.py --all

    # One contributor
    docker compose exec api python tools/trigger_matches.py --contributor "Smith"

    # Stop running computation (marks jobs stopped, cancels active queries)
    docker compose exec api python tools/trigger_matches.py --stop

    # Clear pending jobs without running them
    docker compose exec api python tools/trigger_matches.py --clear

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


def queue_pairs(db, pairs):
    """Queue a list of (contributor_a, contributor_b) pairs for matching."""
    if not pairs:
        return
    db.execute(
        text("""
            INSERT INTO match_jobs (contributor_a, contributor_b, status, queued_at)
            VALUES (:a, :b, 'pending', NOW())
            ON CONFLICT (contributor_a, contributor_b) DO UPDATE
                SET status = 'pending', queued_at = NOW()
        """),
        [{"a": a, "b": b} for a, b in pairs],
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
    total = sum(r.n for r in rows)
    print(f"Current match_jobs status ({total} pairs total):")
    for r in rows:
        print(f"  {r.status:10s}  {r.n}")


def main():
    parser = argparse.ArgumentParser(
        description="Queue and run cross-contributor match computation."
    )
    parser.add_argument("--all", action="store_true", help="Queue all contributors")
    parser.add_argument(
        "--contributor",
        metavar="NAME",
        action="append",
        dest="contributors",
        help="Queue a specific contributor (repeatable)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel workers for match computation (default: 4)",
    )
    parser.add_argument(
        "--drop-all",
        action="store_true",
        help="Delete all existing match results before queuing (use with --all for a clean rebuild)",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove all pending jobs from the queue without running them",
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="Mark running and pending jobs as stopped; also cancels their active "
        "PostgreSQL queries so the compute_matches process exits after the "
        "current INSERT finishes",
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

        if args.stop:
            # Mark pending and running jobs as stopped so workers find nothing to claim
            n = db.execute(
                text(
                    "UPDATE match_jobs SET status = 'stopped' WHERE status IN ('pending', 'running')"
                )
            ).rowcount
            db.commit()
            # Cancel any active PostgreSQL queries belonging to compute_matches workers
            cancelled = db.execute(text("""
                SELECT COUNT(*) FROM (
                    SELECT pg_cancel_backend(pid)
                    FROM pg_stat_activity
                    WHERE query LIKE '%INSERT INTO matches%'
                      AND state = 'active'
                      AND pid <> pg_backend_pid()
                ) AS q
            """)).scalar()
            db.commit()
            print(f"Stopped {n} job(s). Cancelled {cancelled} active query/queries.")
            print("Workers will exit after their current INSERT completes.")
            return

        if not args.all and not args.contributors:
            print_status(db)
            print("\nUse --all or --contributor NAME to queue jobs.")
            return

        if args.drop_all:
            n = db.execute(text("DELETE FROM matches")).rowcount
            db.commit()
            print(f"Dropped {n} existing match record(s).")

        if args.all:
            names = [
                r.name
                for r in db.execute(
                    text("SELECT name FROM contributors ORDER BY name")
                ).fetchall()
            ]
            if not names:
                print("No contributors found in database.")
                return
            pairs = [
                (names[i], names[j])
                for i in range(len(names))
                for j in range(i + 1, len(names))
            ]
            print(
                f"Considering {len(pairs)} pair(s) for {len(names)} contributor(s)..."
            )
            queue_pairs(db, pairs)
            print(f"Queued {len(pairs)} pairs.")
        else:
            # Validate requested contributors.
            targets = []
            for name in args.contributors:
                row = db.execute(
                    text("SELECT name FROM contributors WHERE name = :n"), {"n": name}
                ).fetchone()
                if row:
                    targets.append(row.name)
                else:
                    print(
                        f"Warning: contributor '{name}' not found in database, skipping."
                    )
            if not targets:
                print("No valid contributors to queue.")
                return

            # Queue every pair that involves any of the requested contributors so
            # all their matches are refreshed after a data change.
            all_names = [
                r.name
                for r in db.execute(text("SELECT name FROM contributors")).fetchall()
            ]
            pairs = set()
            for t in targets:
                for other in all_names:
                    if other != t:
                        a, b = (t, other) if t < other else (other, t)
                        pairs.add((a, b))
            pairs = sorted(pairs)
            print(f"Considering {len(pairs)} pair(s) for: {', '.join(targets)}")
            queue_pairs(db, pairs)
            print(f"Queued {len(pairs)} pairs.")
    finally:
        db.close()

    # Run compute_matches directly in the same process
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import compute_matches

    compute_matches.main(workers=args.workers)


if __name__ == "__main__":
    main()
