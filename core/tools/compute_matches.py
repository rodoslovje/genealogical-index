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

from sqlalchemy import create_engine, event, text
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
YEAR_TOLERANCE = 5  # max year difference still considered a match
CONFIDENCE_MIN = 0.80  # records below this threshold are not stored
TRGM_THRESHOLD = 0.72  # pg_trgm.similarity_threshold for the % join operator
# kept below CONFIDENCE_MIN so pairs where one surname/name
# field is weaker but year+place compensate are not missed
WORK_MEM = "256MB"  # per-session work_mem; raise if you have spare RAM
PG_PARALLEL_WORKERS = 4  # PostgreSQL-internal parallel workers per query
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


@event.listens_for(engine, "connect")
def _apply_session_params(dbapi_conn, _record):
    """Apply session-wide tuning once when a pool connection is opened.

    Previously these were SET LOCAL'd at the start of every match INSERT, which
    added ~7 round-trips per pair on top of the 3 inserts.  Setting them at
    connect time means each pooled connection carries the right values for its
    entire lifetime, so the hot path is just the INSERT itself.
    """
    cur = dbapi_conn.cursor()
    cur.execute(f"SET pg_trgm.similarity_threshold = {TRGM_THRESHOLD}")
    cur.execute(f"SET work_mem = '{WORK_MEM}'")
    cur.execute(f"SET max_parallel_workers_per_gather = {PG_PARALLEL_WORKERS}")
    cur.execute("SET min_parallel_table_scan_size = 0")
    cur.execute("SET min_parallel_index_scan_size = 0")
    cur.execute("SET parallel_tuple_cost = 0.01")
    cur.execute("SET parallel_setup_cost = 100")
    cur.close()


# ---------------------------------------------------------------------------
# Each job compares exactly two contributors against each other.
# Both A→B and B→A matches are stored in a single INSERT (UNION ALL) so the
# API can query from either contributor's perspective.  The JOIN is bounded to
# two small contributor-filtered datasets instead of one contributor vs millions
# of rows, allowing PostgreSQL to choose much more efficient query plans.
# ---------------------------------------------------------------------------

_BIRTH_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH b1_sur AS MATERIALIZED (
        SELECT DISTINCT surname FROM births WHERE contributor = :contrib_a AND surname IS NOT NULL
    ),
    b2_sur AS MATERIALIZED (
        SELECT DISTINCT surname FROM births WHERE contributor = :contrib_b AND surname IS NOT NULL
    ),
    sur_matches AS MATERIALIZED (
        SELECT b1s.surname AS sur1, b2s.surname AS sur2,
               CASE WHEN b1s.surname = b2s.surname THEN 1.0 ELSE similarity(b1s.surname, b2s.surname) END AS s_sur
        FROM b1_sur b1s
        JOIN b2_sur b2s ON b1s.surname = b2s.surname OR b1s.surname % b2s.surname
    ),
    cands AS (
        SELECT
            b1.id AS a_id,
            b2.id AS b_id,
            sm.s_sur,
            CASE WHEN b1.name = b2.name THEN 1.0 ELSE similarity(b1.name, b2.name) END AS s_name,
            CASE WHEN COALESCE(b1.place_of_birth,'') != ''
                      AND COALESCE(b2.place_of_birth,'') != ''
                 THEN CASE WHEN b1.place_of_birth = b2.place_of_birth THEN 1.0 ELSE similarity(b1.place_of_birth, b2.place_of_birth) END
                 ELSE NULL END AS s_place,
            CASE WHEN b1.birth_year IS NOT NULL AND b2.birth_year IS NOT NULL
                 THEN ABS(b1.birth_year - b2.birth_year)
                 ELSE NULL END AS yr_diff
        FROM sur_matches sm
        JOIN births b1 ON b1.contributor = :contrib_a AND b1.surname = sm.sur1
        JOIN births b2 ON b2.contributor = :contrib_b AND b2.surname = sm.sur2
        WHERE (b1.birth_year IS NULL OR b2.birth_year IS NULL
                 OR ABS(b1.birth_year - b2.birth_year) <= :yr_tol)
          AND (b1.name = b2.name OR b1.name % b2.name)
    ),
    scored AS (
        SELECT a_id, b_id, s_sur, s_name, s_place, yr_diff,
            s_sur  * 0.35 +
            s_name * 0.30 +
            COALESCE(s_place, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
            AS conf
        FROM cands
    )
    SELECT :contrib_a, :contrib_b, 'birth', a_id, b_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'birth', b_id, a_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
""")

_FAMILY_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH f1_hsur AS MATERIALIZED (
        SELECT DISTINCT husband_surname FROM families WHERE contributor = :contrib_a AND husband_surname IS NOT NULL
    ),
    f2_hsur AS MATERIALIZED (
        SELECT DISTINCT husband_surname FROM families WHERE contributor = :contrib_b AND husband_surname IS NOT NULL
    ),
    hsur_matches AS MATERIALIZED (
        SELECT s1.husband_surname AS sur1, s2.husband_surname AS sur2,
               CASE WHEN s1.husband_surname = s2.husband_surname THEN 1.0 ELSE similarity(s1.husband_surname, s2.husband_surname) END AS s_hsur
        FROM f1_hsur s1
        JOIN f2_hsur s2 ON s1.husband_surname = s2.husband_surname OR s1.husband_surname % s2.husband_surname
    ),
    f1_wsur AS MATERIALIZED (
        SELECT DISTINCT wife_surname FROM families WHERE contributor = :contrib_a AND wife_surname IS NOT NULL
    ),
    f2_wsur AS MATERIALIZED (
        SELECT DISTINCT wife_surname FROM families WHERE contributor = :contrib_b AND wife_surname IS NOT NULL
    ),
    wsur_matches AS MATERIALIZED (
        SELECT s1.wife_surname AS sur1, s2.wife_surname AS sur2,
               CASE WHEN s1.wife_surname = s2.wife_surname THEN 1.0 ELSE similarity(s1.wife_surname, s2.wife_surname) END AS s_wsur
        FROM f1_wsur s1
        JOIN f2_wsur s2 ON s1.wife_surname = s2.wife_surname OR s1.wife_surname % s2.wife_surname
    ),
    cands AS (
        SELECT
            f1.id AS a_id,
            f2.id AS b_id,
            hm.s_hsur,
            wm.s_wsur,
            CASE WHEN COALESCE(f1.husband_name,'') != ''
                      AND COALESCE(f2.husband_name,'') != ''
                 THEN CASE WHEN f1.husband_name = f2.husband_name THEN 1.0 ELSE similarity(f1.husband_name, f2.husband_name) END
                 ELSE NULL END AS s_hname,
            CASE WHEN COALESCE(f1.wife_name,'') != ''
                      AND COALESCE(f2.wife_name,'') != ''
                 THEN CASE WHEN f1.wife_name = f2.wife_name THEN 1.0 ELSE similarity(f1.wife_name, f2.wife_name) END
                 ELSE NULL END AS s_wname,
            CASE WHEN COALESCE(f1.place_of_marriage,'') != ''
                      AND COALESCE(f2.place_of_marriage,'') != ''
                 THEN CASE WHEN f1.place_of_marriage = f2.place_of_marriage THEN 1.0 ELSE similarity(f1.place_of_marriage, f2.place_of_marriage) END
                 ELSE NULL END AS s_place,
            CASE WHEN f1.marriage_year IS NOT NULL AND f2.marriage_year IS NOT NULL
                 THEN ABS(f1.marriage_year - f2.marriage_year)
                 ELSE NULL END AS yr_diff
        FROM families f1
        JOIN hsur_matches hm ON f1.husband_surname = hm.sur1
        JOIN wsur_matches wm ON f1.wife_surname = wm.sur1
        JOIN families f2 ON f2.contributor = :contrib_b
                        AND f2.husband_surname = hm.sur2
                        AND f2.wife_surname = wm.sur2
        WHERE f1.contributor = :contrib_a
          AND (f1.marriage_year IS NULL OR f2.marriage_year IS NULL
                 OR ABS(f1.marriage_year - f2.marriage_year) <= :yr_tol)
    ),
    scored AS (
        SELECT a_id, b_id, s_hsur, s_wsur, s_hname, s_wname, s_place, yr_diff,
            s_hsur * 0.25 +
            s_wsur * 0.25 +
            COALESCE(s_hname, 0.5) * 0.15 +
            COALESCE(s_wname, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.10 +
            COALESCE(s_place, 0.5) * 0.10
            AS conf
        FROM cands
    )
    SELECT :contrib_a, :contrib_b, 'family', a_id, b_id, conf,
        jsonb_build_object(
            'husband_surname', round(s_hsur::numeric, 3),
            'wife_surname',    round(s_wsur::numeric, 3),
            'husband_name',    CASE WHEN s_hname IS NOT NULL THEN round(s_hname::numeric, 3) END,
            'wife_name',       CASE WHEN s_wname IS NOT NULL THEN round(s_wname::numeric, 3) END,
            'place',           CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff',       yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'family', b_id, a_id, conf,
        jsonb_build_object(
            'husband_surname', round(s_hsur::numeric, 3),
            'wife_surname',    round(s_wsur::numeric, 3),
            'husband_name',    CASE WHEN s_hname IS NOT NULL THEN round(s_hname::numeric, 3) END,
            'wife_name',       CASE WHEN s_wname IS NOT NULL THEN round(s_wname::numeric, 3) END,
            'place',           CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff',       yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
""")

_DEATH_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH d1_sur AS MATERIALIZED (
        SELECT DISTINCT surname FROM deaths WHERE contributor = :contrib_a AND surname IS NOT NULL
    ),
    d2_sur AS MATERIALIZED (
        SELECT DISTINCT surname FROM deaths WHERE contributor = :contrib_b AND surname IS NOT NULL
    ),
    sur_matches AS MATERIALIZED (
        SELECT d1s.surname AS sur1, d2s.surname AS sur2,
               CASE WHEN d1s.surname = d2s.surname THEN 1.0 ELSE similarity(d1s.surname, d2s.surname) END AS s_sur
        FROM d1_sur d1s
        JOIN d2_sur d2s ON d1s.surname = d2s.surname OR d1s.surname % d2s.surname
    ),
    cands AS (
        SELECT
            d1.id AS a_id,
            d2.id AS b_id,
            sm.s_sur,
            CASE WHEN d1.name = d2.name THEN 1.0 ELSE similarity(d1.name, d2.name) END AS s_name,
            CASE WHEN COALESCE(d1.place_of_death,'') != ''
                      AND COALESCE(d2.place_of_death,'') != ''
                 THEN CASE WHEN d1.place_of_death = d2.place_of_death THEN 1.0 ELSE similarity(d1.place_of_death, d2.place_of_death) END
                 ELSE NULL END AS s_place,
            CASE WHEN d1.death_year IS NOT NULL AND d2.death_year IS NOT NULL
                 THEN ABS(d1.death_year - d2.death_year)
                 ELSE NULL END AS yr_diff
        FROM sur_matches sm
        JOIN deaths d1 ON d1.contributor = :contrib_a AND d1.surname = sm.sur1
        JOIN deaths d2 ON d2.contributor = :contrib_b AND d2.surname = sm.sur2
        WHERE (d1.death_year IS NULL OR d2.death_year IS NULL
                 OR ABS(d1.death_year - d2.death_year) <= :yr_tol)
          AND (d1.name = d2.name OR d1.name % d2.name)
    ),
    scored AS (
        SELECT a_id, b_id, s_sur, s_name, s_place, yr_diff,
            s_sur  * 0.35 +
            s_name * 0.30 +
            COALESCE(s_place, 0.5) * 0.15 +
            COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
            AS conf
        FROM cands
    )
    SELECT :contrib_a, :contrib_b, 'death', a_id, b_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'death', b_id, a_id, conf,
        jsonb_build_object(
            'surname',   round(s_sur::numeric, 3),
            'name',      round(s_name::numeric, 3),
            'place',     CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff', yr_diff
        )::text
    FROM scored WHERE conf >= :conf_min
""")


def claim_jobs(batch_size=10):
    """Atomically claim a batch of pending pair jobs. Returns a list of (contrib_a, contrib_b)."""
    with engine.begin() as conn:
        rows = conn.execute(
            text("""
            UPDATE match_jobs SET status = 'running'
            WHERE (contributor_a, contributor_b) IN (
                SELECT contributor_a, contributor_b FROM match_jobs
                WHERE status = 'pending'
                ORDER BY queued_at, contributor_a, contributor_b
                FOR UPDATE SKIP LOCKED
                LIMIT :batch_size
            )
            RETURNING contributor_a, contributor_b
        """),
            {"batch_size": batch_size},
        ).fetchall()
        return [(r[0], r[1]) for r in rows]


def process_job(contrib_a, contrib_b):
    params = {
        "contrib_a": contrib_a,
        "contrib_b": contrib_b,
        "yr_tol": YEAR_TOLERANCE,
        "conf_min": CONFIDENCE_MIN,
    }
    pair_label = f"{contrib_a}↔{contrib_b}"

    # Whole job runs in one transaction on one pooled connection: stale-match
    # cleanup, the three record-type inserts, and the job-status update share
    # transaction setup and the connection-level tuning settings.  Sequential
    # within the txn, but the outer worker pool keeps multiple pairs running
    # concurrently across separate connections.
    total = 0
    with engine.begin() as conn:
        deleted = conn.execute(
            text("""
            DELETE FROM matches
            WHERE (contributor_a = :contrib_a AND contributor_b = :contrib_b)
               OR (contributor_a = :contrib_b AND contributor_b = :contrib_a)
        """),
            params,
        ).rowcount
        if deleted:
            log.info(f"  [{pair_label}] removed {deleted} stale matches")

        for sql, label in (
            (_BIRTH_INSERT, "birth"),
            (_FAMILY_INSERT, "family"),
            (_DEATH_INSERT, "death"),
        ):
            t0 = time.monotonic()
            n = conn.execute(sql, params).rowcount
            log.info(
                f"  [{pair_label}] {label}: {n} matches in {time.monotonic()-t0:.1f}s"
            )
            total += n

        conn.execute(
            text("""
            UPDATE match_jobs SET status = 'done', completed_at = NOW()
            WHERE contributor_a = :contrib_a AND contributor_b = :contrib_b
        """),
            params,
        )

    log.info(f"  [{pair_label}] done — {total} total matches stored")


def worker(_):
    """Claim and process pair jobs until none remain."""
    while True:
        jobs = claim_jobs(batch_size=10)
        if not jobs:
            return
        for contrib_a, contrib_b in jobs:
            t0 = time.monotonic()
            log.info(f"Computing matches for: {contrib_a} ↔ {contrib_b}")
            try:
                process_job(contrib_a, contrib_b)
                log.info(
                    f"Finished {contrib_a}↔{contrib_b} in {time.monotonic()-t0:.0f}s"
                )
            except Exception as exc:
                log.error(f"Error on {contrib_a}↔{contrib_b}: {exc}")
                try:
                    with engine.begin() as conn:
                        conn.execute(
                            text(
                                "UPDATE match_jobs SET status='error' "
                                "WHERE contributor_a=:a AND contributor_b=:b"
                            ),
                            {"a": contrib_a, "b": contrib_b},
                        )
                except Exception:
                    pass


def main(workers=4):
    with engine.connect() as conn:
        pending_count = conn.execute(
            text("SELECT COUNT(*) FROM match_jobs WHERE status='pending'")
        ).scalar()

    if not pending_count:
        log.info("No pending match jobs.")
        return

    # Back-fill year columns for any rows that pre-date the schema migration.
    # Runs once per table when NULL rows exist; skipped on subsequent calls.
    # Done BEFORE ANALYZE so the planner sees the populated histogram.
    for table, year_col, date_col in (
        ("births", "birth_year", "date_of_birth"),
        ("families", "marriage_year", "date_of_marriage"),
        ("deaths", "death_year", "date_of_death"),
    ):
        with engine.connect() as conn:
            null_rows = conn.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {year_col} IS NULL")
            ).scalar()
        if null_rows:
            log.info(f"Back-filling {year_col} for {null_rows:,} rows in {table}...")
            t_bf = time.monotonic()
            with engine.begin() as conn:
                conn.execute(
                    text(
                        f"UPDATE {table} SET {year_col} = "
                        f"CAST(SUBSTRING({date_col} FROM '\\d{{4}}') AS SMALLINT) "
                        f"WHERE {year_col} IS NULL AND {date_col} ~ '\\d{{4}}'"
                    )
                )
            log.info(f"  {table} back-fill done in {time.monotonic()-t_bf:.0f}s")

    # Refresh planner statistics so the query planner has accurate row-count estimates.
    # Critical after a bulk import — without this the planner may choose seq scans
    # over index scans, or under-estimate parallelism benefit.
    # Analyzing the year columns is especially important: the planner needs their
    # histogram to decide whether a year-range B-tree scan beats the trigram GiST scan.
    log.info("Running ANALYZE for fresh planner statistics...")
    with engine.begin() as conn:
        conn.execute(text("ANALYZE births"))
        conn.execute(text("ANALYZE families"))
        conn.execute(text("ANALYZE deaths"))

    log.info(
        f"Processing {pending_count} pending pair(s) with {workers} worker(s) "
        f"(PG_PARALLEL_WORKERS={PG_PARALLEL_WORKERS}, WORK_MEM={WORK_MEM})..."
    )

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker, i) for i in range(workers)]
        for f in as_completed(futures):
            f.result()  # re-raises any worker exception

    log.info(f"Match computation complete in {time.monotonic()-t0:.0f}s.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compute cross-contributor matches.")
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel workers (default: 4). "
        "Each claims jobs independently via SELECT FOR UPDATE SKIP LOCKED.",
    )
    args = parser.parse_args()
    main(workers=args.workers)
