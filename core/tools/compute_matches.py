#!/usr/bin/env python3
"""Background script: compute cross-contributor record matches after data import.

Optimised for large datasets (millions of records, hundreds of contributors):
- Pure SQL INSERT...SELECT — no Python roundtrip for match rows
- Parallel workers — multiple contributors processed concurrently
- SELECT FOR UPDATE SKIP LOCKED — safe concurrent job claiming
- Per-session work_mem — lets PostgreSQL use in-memory hash joins

Usage:
    docker compose exec api python tools/compute_matches.py [--workers N]

Triggered automatically by import_to_db.py; can also be run via trigger_matches.py.
"""

import argparse
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

try:
    from dotenv import load_dotenv
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# --- tuning knobs ---
YEAR_TOLERANCE     = 5       # max year difference still considered a match
CONFIDENCE_MIN     = 0.72    # records below this threshold are not stored
TRGM_THRESHOLD     = 0.65    # pg_trgm.similarity_threshold for the % join operator
WORK_MEM           = "256MB" # per-session work_mem; raise if you have spare RAM
PG_PARALLEL_WORKERS = 4      # PostgreSQL-internal parallel workers per query
                              # (independent of Python --workers; requires max_worker_processes
                              #  >= Python_workers * PG_PARALLEL_WORKERS on the server)

# --- DB setup ---
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

# pool_size matches typical --workers usage; overflow handles bursts
engine = create_engine(DATABASE_URL, pool_size=8, max_overflow=4)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# Pure SQL INSERT...SELECT — all filtering and insertion done server-side.
# Confidence is computed once in the 'scored' CTE and reused in WHERE + SELECT.
# ---------------------------------------------------------------------------

_BIRTH_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH cands AS (
        SELECT
            b1.id AS a_id,
            b2.id AS b_id,
            b2.contributor AS b_contrib,
            similarity(b1.surname, b2.surname) AS s_sur,
            similarity(b1.name,    b2.name)    AS s_name,
            CASE WHEN COALESCE(b1.place_of_birth,'') != ''
                      AND COALESCE(b2.place_of_birth,'') != ''
                 THEN similarity(b1.place_of_birth, b2.place_of_birth)
                 ELSE NULL END AS s_place,
            CASE WHEN b1.date_of_birth ~ '\d{4}' AND b2.date_of_birth ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(b1.date_of_birth FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(b2.date_of_birth FROM '\d{4}') AS INT))
                 ELSE NULL END AS yr_diff
        FROM births b1
        JOIN births b2
            ON  b1.contributor  = :contrib
            AND b2.contributor != :contrib
            AND b1.surname % b2.surname
            AND b1.name    % b2.name
        WHERE (
            NOT (b1.date_of_birth ~ '\d{4}' AND b2.date_of_birth ~ '\d{4}')
            OR ABS(
                CAST(SUBSTRING(b1.date_of_birth FROM '\d{4}') AS INT) -
                CAST(SUBSTRING(b2.date_of_birth FROM '\d{4}') AS INT)
            ) <= :yr_tol
        )
    ),
    scored AS (
        SELECT a_id, b_id, b_contrib, s_sur, s_name, s_place, yr_diff,
            s_sur  * 0.35 +
            s_name * 0.30 +
            COALESCE(s_place, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
            AS conf
        FROM cands
    )
    SELECT :contrib, b_contrib, 'birth', a_id, b_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL
                              THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored
    WHERE conf >= :conf_min
""")

_FAMILY_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH cands AS (
        SELECT
            f1.id AS a_id,
            f2.id AS b_id,
            f2.contributor AS b_contrib,
            similarity(f1.husband_surname, f2.husband_surname) AS s_hsur,
            similarity(f1.wife_surname,    f2.wife_surname)    AS s_wsur,
            CASE WHEN COALESCE(f1.husband_name,'') != ''
                      AND COALESCE(f2.husband_name,'') != ''
                 THEN similarity(f1.husband_name, f2.husband_name)
                 ELSE NULL END AS s_hname,
            CASE WHEN COALESCE(f1.wife_name,'') != ''
                      AND COALESCE(f2.wife_name,'') != ''
                 THEN similarity(f1.wife_name, f2.wife_name)
                 ELSE NULL END AS s_wname,
            CASE WHEN COALESCE(f1.place_of_marriage,'') != ''
                      AND COALESCE(f2.place_of_marriage,'') != ''
                 THEN similarity(f1.place_of_marriage, f2.place_of_marriage)
                 ELSE NULL END AS s_place,
            CASE WHEN f1.date_of_marriage ~ '\d{4}' AND f2.date_of_marriage ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(f1.date_of_marriage FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(f2.date_of_marriage FROM '\d{4}') AS INT))
                 ELSE NULL END AS yr_diff
        FROM families f1
        JOIN families f2
            ON  f1.contributor  = :contrib
            AND f2.contributor != :contrib
            AND f1.husband_surname % f2.husband_surname
            AND f1.wife_surname    % f2.wife_surname
        WHERE (
            NOT (f1.date_of_marriage ~ '\d{4}' AND f2.date_of_marriage ~ '\d{4}')
            OR ABS(
                CAST(SUBSTRING(f1.date_of_marriage FROM '\d{4}') AS INT) -
                CAST(SUBSTRING(f2.date_of_marriage FROM '\d{4}') AS INT)
            ) <= :yr_tol
        )
    ),
    scored AS (
        SELECT a_id, b_id, b_contrib, s_hsur, s_wsur, s_hname, s_wname, s_place, yr_diff,
            s_hsur * 0.25 +
            s_wsur * 0.25 +
            COALESCE(s_hname, 0.5) * 0.15 +
            COALESCE(s_wname, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.10 +
            COALESCE(s_place, 0.5) * 0.10
            AS conf
        FROM cands
    )
    SELECT :contrib, b_contrib, 'family', a_id, b_id, conf,
        jsonb_build_object(
            'husband_surname', round(s_hsur::numeric, 3),
            'wife_surname',    round(s_wsur::numeric, 3),
            'husband_name',    CASE WHEN s_hname IS NOT NULL
                                    THEN round(s_hname::numeric, 3) END,
            'wife_name',       CASE WHEN s_wname IS NOT NULL
                                    THEN round(s_wname::numeric, 3) END,
            'place',           CASE WHEN s_place IS NOT NULL
                                    THEN round(s_place::numeric, 3) END,
            'year_diff',       yr_diff
        )::text
    FROM scored
    WHERE conf >= :conf_min
""")

_DEATH_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH cands AS (
        SELECT
            d1.id AS a_id,
            d2.id AS b_id,
            d2.contributor AS b_contrib,
            similarity(d1.surname, d2.surname) AS s_sur,
            similarity(d1.name,    d2.name)    AS s_name,
            CASE WHEN COALESCE(d1.place_of_death,'') != ''
                      AND COALESCE(d2.place_of_death,'') != ''
                 THEN similarity(d1.place_of_death, d2.place_of_death)
                 ELSE NULL END AS s_place,
            CASE WHEN d1.date_of_death ~ '\d{4}' AND d2.date_of_death ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(d1.date_of_death FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(d2.date_of_death FROM '\d{4}') AS INT))
                 ELSE NULL END AS yr_diff
        FROM deaths d1
        JOIN deaths d2
            ON  d1.contributor  = :contrib
            AND d2.contributor != :contrib
            AND d1.surname % d2.surname
            AND d1.name    % d2.name
        WHERE (
            NOT (d1.date_of_death ~ '\d{4}' AND d2.date_of_death ~ '\d{4}')
            OR ABS(
                CAST(SUBSTRING(d1.date_of_death FROM '\d{4}') AS INT) -
                CAST(SUBSTRING(d2.date_of_death FROM '\d{4}') AS INT)
            ) <= :yr_tol
        )
    ),
    scored AS (
        SELECT a_id, b_id, b_contrib, s_sur, s_name, s_place, yr_diff,
            s_sur  * 0.35 +
            s_name * 0.30 +
            COALESCE(s_place, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
            AS conf
        FROM cands
    )
    SELECT :contrib, b_contrib, 'death', a_id, b_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL
                              THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored
    WHERE conf >= :conf_min
""")


def claim_next_job():
    """Atomically claim the next pending job. Returns contributor name or None."""
    with engine.begin() as conn:
        row = conn.execute(text("""
            UPDATE match_jobs SET status = 'running'
            WHERE contributor = (
                SELECT contributor FROM match_jobs
                WHERE status = 'pending'
                ORDER BY queued_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING contributor
        """)).fetchone()
        return row[0] if row else None


def _session_settings(conn):
    """Apply per-transaction performance settings."""
    conn.execute(text(f"SET LOCAL pg_trgm.similarity_threshold = {TRGM_THRESHOLD}"))
    conn.execute(text(f"SET LOCAL work_mem = '{WORK_MEM}'"))
    # Let PostgreSQL use multiple cores for the trgm self-join.
    conn.execute(text(f"SET LOCAL max_parallel_workers_per_gather = {PG_PARALLEL_WORKERS}"))
    # Lower the cost thresholds so parallel plans are chosen even for mid-sized chunks.
    conn.execute(text("SET LOCAL min_parallel_table_scan_size = 0"))
    conn.execute(text("SET LOCAL min_parallel_index_scan_size = 0"))
    conn.execute(text("SET LOCAL parallel_tuple_cost = 0.01"))
    conn.execute(text("SET LOCAL parallel_setup_cost = 100"))


def process_job(contributor):
    params = {
        "contrib":   contributor,
        "yr_tol":    YEAR_TOLERANCE,
        "conf_min":  CONFIDENCE_MIN,
    }

    # Clear stale matches (no trgm settings needed here)
    with engine.begin() as conn:
        deleted = conn.execute(
            text("DELETE FROM matches WHERE contributor_a = :contrib"), params
        ).rowcount
    if deleted:
        log.info(f"  [{contributor}] removed {deleted} stale matches")

    total = 0
    for sql, label in ((_BIRTH_INSERT, "birth"), (_FAMILY_INSERT, "family"), (_DEATH_INSERT, "death")):
        t0 = time.monotonic()
        with engine.begin() as conn:
            _session_settings(conn)
            n = conn.execute(sql, params).rowcount
        log.info(f"  [{contributor}] {label}: {n} matches in {time.monotonic()-t0:.1f}s")
        total += n

    with engine.begin() as conn:
        conn.execute(text("""
            UPDATE match_jobs SET status = 'done', completed_at = NOW()
            WHERE contributor = :contrib
        """), {"contrib": contributor})

    log.info(f"  [{contributor}] done — {total} total matches stored")


def worker(_):
    """Claim and process jobs until none remain."""
    while True:
        contributor = claim_next_job()
        if contributor is None:
            return
        t0 = time.monotonic()
        log.info(f"Computing matches for: {contributor}")
        try:
            process_job(contributor)
            log.info(f"Finished {contributor} in {time.monotonic()-t0:.0f}s")
        except Exception as exc:
            log.error(f"Error processing {contributor} after {time.monotonic()-t0:.0f}s: {exc}")
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text("UPDATE match_jobs SET status='error' WHERE contributor=:c"),
                        {"c": contributor},
                    )
            except Exception:
                pass


def main(workers=2):
    with engine.connect() as conn:
        pending_count = conn.execute(
            text("SELECT COUNT(*) FROM match_jobs WHERE status='pending'")
        ).scalar()

    if not pending_count:
        log.info("No pending match jobs.")
        return

    # Refresh planner statistics so the query planner has accurate row-count estimates.
    # Critical after a bulk import — without this the planner may choose seq scans
    # over index scans, or under-estimate parallelism benefit.
    log.info("Running ANALYZE for fresh planner statistics...")
    with engine.begin() as conn:
        conn.execute(text("ANALYZE births"))
        conn.execute(text("ANALYZE families"))
        conn.execute(text("ANALYZE deaths"))

    log.info(f"Processing {pending_count} pending job(s) with {workers} worker(s) "
             f"(PG_PARALLEL_WORKERS={PG_PARALLEL_WORKERS}, WORK_MEM={WORK_MEM})...")

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker, i) for i in range(workers)]
        for f in as_completed(futures):
            f.result()  # re-raises any worker exception

    log.info(f"Match computation complete in {time.monotonic()-t0:.0f}s.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute cross-contributor matches.")
    parser.add_argument(
        "--workers", type=int, default=2,
        help="Number of parallel workers (default: 2). "
             "Each claims jobs independently via SELECT FOR UPDATE SKIP LOCKED."
    )
    args = parser.parse_args()
    main(workers=args.workers)
