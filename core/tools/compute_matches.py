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
YEAR_TOLERANCE = 5  # max year difference still considered a match for exact dates
YEAR_TOLERANCE_APPROX = 15  # widened tolerance when either side's date carries an
# ABT/EST/CAL/BEF/AFT/~ qualifier — those years are often back-derived from a
# child's or parent's birth/death and can be off by a decade or more.
IDENTITY_KEY_CONFIDENCE = 0.97  # confidence floor when surname + given name +
# birth year all match exactly — a near-conclusive identity key, applied even
# if a corroborating field (e.g. death info) is missing or differs slightly.
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
    import urllib.parse

    _db_host = os.getenv(
        "POSTGRES_HOST", "db" if os.path.exists("/.dockerenv") else "localhost"
    )
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{urllib.parse.quote(os.getenv('POSTGRES_PASSWORD', ''))}@{_db_host}:5432/{os.getenv('POSTGRES_DB')}"

os.environ["DATABASE_URL"] = DATABASE_URL

# pool_size matches typical --workers usage; overflow handles bursts
engine = create_engine(DATABASE_URL, pool_size=8, max_overflow=4)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@event.listens_for(engine, "connect")
def _apply_session_params(dbapi_conn, _record):
    """Apply session-wide tuning once when a pool connection is opened."""
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
# A "person" row carries both birth and death info, so a single match insert
# combines those signals.  Family matching stays separate.
# Both A→B and B→A matches are stored in a single INSERT (UNION ALL) so the
# API can query from either contributor's perspective.
# ---------------------------------------------------------------------------

_PERSON_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH cands AS (
        SELECT
            p1.id AS a_id,
            p2.id AS b_id,
            p1.birth_year AS a_birth_year, p1.death_year AS a_death_year,
            p2.birth_year AS b_birth_year, p2.death_year AS b_death_year,
            sm.s_sur,
            -- name_fold (lower-cased, accent-stripped given name) makes
            -- e.g. "Žan"/"Zan" compare equal; <> '' avoids two blank given
            -- names scoring as a perfect match.
            CASE WHEN p1.name_fold = p2.name_fold AND p1.name_fold <> '' THEN 1.0
                 ELSE similarity(p1.name_fold, p2.name_fold) END AS s_name,
            CASE WHEN COALESCE(p1.place_of_birth,'') != ''
                      AND COALESCE(p2.place_of_birth,'') != ''
                 THEN CASE WHEN p1.place_of_birth = p2.place_of_birth THEN 1.0 ELSE similarity(p1.place_of_birth, p2.place_of_birth) END
                 ELSE NULL END AS s_bplace,
            CASE WHEN COALESCE(p1.place_of_death,'') != ''
                      AND COALESCE(p2.place_of_death,'') != ''
                 THEN CASE WHEN p1.place_of_death = p2.place_of_death THEN 1.0 ELSE similarity(p1.place_of_death, p2.place_of_death) END
                 ELSE NULL END AS s_dplace,
            -- JSONB columns: NULL or '[]'::jsonb means "no data"; cast to
            -- text for similarity() since pg_trgm operates on TEXT. list_for_match()
            -- strips the per-file GEDCOM `id` from each element so different
            -- contributors' lists can match (their ids are guaranteed unique).
            CASE WHEN p1.parents_list IS NOT NULL AND p1.parents_list <> '[]'::jsonb
                  AND p2.parents_list IS NOT NULL AND p2.parents_list <> '[]'::jsonb
                 THEN CASE WHEN list_for_match(p1.parents_list) = list_for_match(p2.parents_list) THEN 1.0
                           ELSE similarity(list_for_match(p1.parents_list)::text,
                                           list_for_match(p2.parents_list)::text) END
                 ELSE NULL END AS s_parents,
            CASE WHEN p1.partners_list IS NOT NULL AND p1.partners_list <> '[]'::jsonb
                  AND p2.partners_list IS NOT NULL AND p2.partners_list <> '[]'::jsonb
                 THEN CASE WHEN list_for_match(p1.partners_list) = list_for_match(p2.partners_list) THEN 1.0
                           ELSE similarity(list_for_match(p1.partners_list)::text,
                                           list_for_match(p2.partners_list)::text) END
                 ELSE NULL END AS s_partners,
            CASE WHEN p1.birth_year IS NOT NULL AND p2.birth_year IS NOT NULL
                 THEN ABS(p1.birth_year - p2.birth_year)
                 ELSE NULL END AS b_yr_diff,
            CASE WHEN p1.death_year IS NOT NULL AND p2.death_year IS NOT NULL
                 THEN ABS(p1.death_year - p2.death_year)
                 ELSE NULL END AS d_yr_diff,
            -- Per-record year tolerance: widened to :yr_tol_approx when the
            -- GEDCOM date carries an approximation qualifier (ABT/EST/CAL/...),
            -- since those years are often back-derived from a relative's
            -- birth/death and can be off by a decade or more.
            CASE WHEN is_approx_date(p1.date_of_birth) THEN :yr_tol_approx ELSE :yr_tol END AS bt1,
            CASE WHEN is_approx_date(p2.date_of_birth) THEN :yr_tol_approx ELSE :yr_tol END AS bt2,
            CASE WHEN is_approx_date(p1.date_of_death) THEN :yr_tol_approx ELSE :yr_tol END AS dt1,
            CASE WHEN is_approx_date(p2.date_of_death) THEN :yr_tol_approx ELSE :yr_tol END AS dt2
        FROM sur_matches sm
        JOIN persons p1 ON p1.contributor = :contrib_a
                       AND (p1.surname_fold = sm.sur1
                            OR (p1.alt_surname_fold <> '' AND p1.alt_surname_fold = sm.sur1))
        JOIN persons p2 ON p2.contributor = :contrib_b
                       AND (p2.surname_fold = sm.sur2
                            OR (p2.alt_surname_fold <> '' AND p2.alt_surname_fold = sm.sur2))
        WHERE (p1.name_fold = p2.name_fold OR similarity(p1.name_fold, p2.name_fold) >= :trgm_thresh)
    ),
    -- Year-tolerance and lifespan-plausibility gates. Tolerances are the wider
    -- of the two records' (possibly approximate) dates for that comparison.
    plausible AS (
        SELECT *,
               GREATEST(bt1, bt2) AS b_tol,
               GREATEST(dt1, dt2) AS d_tol
        FROM cands
        WHERE (
                (b_yr_diff IS NULL OR b_yr_diff <= GREATEST(bt1, bt2))
                OR (d_yr_diff IS NOT NULL AND d_yr_diff <= GREATEST(dt1, dt2))
              )
          -- Lifespan impossibility: the same person can't die before the
          -- other record's birth.
          AND NOT (a_death_year IS NOT NULL AND b_birth_year IS NOT NULL
                   AND a_death_year < b_birth_year - GREATEST(dt1, bt2))
          AND NOT (b_death_year IS NOT NULL AND a_birth_year IS NOT NULL
                   AND b_death_year < a_birth_year - GREATEST(dt2, bt1))
    ),
    -- A person may match the same partner via several surname/alt_surname
    -- combinations; keep only the strongest (highest s_sur) per pair so the
    -- downstream scoring sees a single canonical candidate.
    cands_dedup AS (
        SELECT DISTINCT ON (a_id, b_id) *
        FROM plausible
        ORDER BY a_id, b_id, s_sur DESC
    ),
    scored AS (
        SELECT a_id, b_id, s_sur, s_name, s_bplace, s_dplace,
               b_yr_diff, d_yr_diff, s_parents, s_partners,
            -- Always-counted (sum = 90): surname 35 + name 30 + birth_place 10 + birth_year 15.
            -- Birth fields are essential identity signals, so missing values get the
            -- COALESCE(0.5) "neutral" treatment rather than being skipped — a record
            -- with no birth info cannot reach 100%.
            -- Conditional (only count if present on both sides): death_place 10,
            -- death_year 10, parents 20, partners 15.  Their absence neither helps
            -- nor hurts; their presence with a perfect match keeps the score at 100%.
            (
                s_sur  * 35.0 +
                s_name * 30.0 +
                COALESCE(s_bplace, 0.5) * 10.0 +
                COALESCE(GREATEST(0.0, 1.0 - b_yr_diff::float / b_tol), 0.5) * 15.0 +
                COALESCE(s_dplace, 0.0) * 10.0 +
                COALESCE(GREATEST(0.0, 1.0 - d_yr_diff::float / d_tol), 0.0) * 10.0 +
                COALESCE(s_parents,  0.0) * 20.0 +
                COALESCE(s_partners, 0.0) * 15.0
            ) / (
                90.0 +
                CASE WHEN s_dplace    IS NOT NULL THEN 10.0 ELSE 0.0 END +
                CASE WHEN d_yr_diff   IS NOT NULL THEN 10.0 ELSE 0.0 END +
                CASE WHEN s_parents   IS NOT NULL THEN 20.0 ELSE 0.0 END +
                CASE WHEN s_partners  IS NOT NULL THEN 15.0 ELSE 0.0 END
            ) AS base_conf
        FROM cands_dedup
    ),
    bonused AS (
        SELECT a_id, b_id, s_sur, s_name, s_bplace, s_dplace, b_yr_diff, d_yr_diff, s_parents, s_partners,
            -- Identity-key bonus: an exact surname + given-name + birth-year
            -- match is near-conclusive, so the confidence is floored even if
            -- a corroborating field (e.g. death info) is missing or differs.
            CASE WHEN s_sur = 1.0 AND s_name = 1.0 AND b_yr_diff = 0
                 THEN GREATEST(base_conf, :identity_conf)
                 ELSE base_conf
            END AS conf
        FROM scored
    ),
    filtered AS (
        SELECT a_id, b_id, conf, jsonb_build_object(
            'surname',     round(s_sur::numeric, 3),
            'name',        round(s_name::numeric, 3),
            'birth_place', CASE WHEN s_bplace  IS NOT NULL THEN round(s_bplace::numeric, 3) END,
            'death_place', CASE WHEN s_dplace  IS NOT NULL THEN round(s_dplace::numeric, 3) END,
            'birth_year_diff', b_yr_diff,
            'death_year_diff', d_yr_diff,
            'parents',     CASE WHEN s_parents  IS NOT NULL THEN round(s_parents::numeric, 3) END,
            'partners',    CASE WHEN s_partners IS NOT NULL THEN round(s_partners::numeric, 3) END
        )::text AS match_fields
        FROM bonused WHERE conf >= :conf_min
    )
    SELECT :contrib_a, :contrib_b, 'person', a_id, b_id, conf, match_fields FROM filtered
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'person', b_id, a_id, conf, match_fields FROM filtered
""")

_FAMILY_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields)
    WITH cands AS (
        SELECT
            f1.id AS a_id,
            f2.id AS b_id,
            hm.s_sur AS s_hsur,
            wm.s_sur AS s_wsur,
            CASE WHEN f1.husband_name_fold <> '' AND f2.husband_name_fold <> ''
                 THEN CASE WHEN f1.husband_name_fold = f2.husband_name_fold THEN 1.0 ELSE similarity(f1.husband_name_fold, f2.husband_name_fold) END
                 ELSE NULL END AS s_hname,
            CASE WHEN f1.wife_name_fold <> '' AND f2.wife_name_fold <> ''
                 THEN CASE WHEN f1.wife_name_fold = f2.wife_name_fold THEN 1.0 ELSE similarity(f1.wife_name_fold, f2.wife_name_fold) END
                 ELSE NULL END AS s_wname,
            CASE WHEN COALESCE(f1.place_of_marriage,'') != ''
                      AND COALESCE(f2.place_of_marriage,'') != ''
                 THEN CASE WHEN f1.place_of_marriage = f2.place_of_marriage THEN 1.0 ELSE similarity(f1.place_of_marriage, f2.place_of_marriage) END
                 ELSE NULL END AS s_place,
            CASE WHEN f1.husband_parents IS NOT NULL AND f1.husband_parents <> '[]'::jsonb
                  AND f2.husband_parents IS NOT NULL AND f2.husband_parents <> '[]'::jsonb
                 THEN CASE WHEN list_for_match(f1.husband_parents) = list_for_match(f2.husband_parents) THEN 1.0
                           ELSE similarity(list_for_match(f1.husband_parents)::text,
                                           list_for_match(f2.husband_parents)::text) END
                 ELSE NULL END AS s_hp,
            CASE WHEN f1.wife_parents IS NOT NULL AND f1.wife_parents <> '[]'::jsonb
                  AND f2.wife_parents IS NOT NULL AND f2.wife_parents <> '[]'::jsonb
                 THEN CASE WHEN list_for_match(f1.wife_parents) = list_for_match(f2.wife_parents) THEN 1.0
                           ELSE similarity(list_for_match(f1.wife_parents)::text,
                                           list_for_match(f2.wife_parents)::text) END
                 ELSE NULL END AS s_wp,
            CASE WHEN f1.children_list IS NOT NULL AND f1.children_list <> '[]'::jsonb
                  AND f2.children_list IS NOT NULL AND f2.children_list <> '[]'::jsonb
                 THEN CASE WHEN list_for_match(f1.children_list) = list_for_match(f2.children_list) THEN 1.0
                           ELSE similarity(list_for_match(f1.children_list)::text,
                                           list_for_match(f2.children_list)::text) END
                 ELSE NULL END AS s_cl,
            CASE WHEN f1.marriage_year IS NOT NULL AND f2.marriage_year IS NOT NULL
                 THEN ABS(f1.marriage_year - f2.marriage_year)
                 ELSE NULL END AS yr_diff,
            -- Widen marriage-year tolerance when either side's marriage date
            -- carries an approximation qualifier (see persons gate above).
            GREATEST(
                CASE WHEN is_approx_date(f1.date_of_marriage) THEN :yr_tol_approx ELSE :yr_tol END,
                CASE WHEN is_approx_date(f2.date_of_marriage) THEN :yr_tol_approx ELSE :yr_tol END
            ) AS m_tol
        FROM families f1
        JOIN sur_matches hm ON f1.husband_surname_fold = hm.sur1
                             OR (f1.husband_alt_surname_fold <> '' AND f1.husband_alt_surname_fold = hm.sur1)
        JOIN sur_matches wm ON f1.wife_surname_fold = wm.sur1
                             OR (f1.wife_alt_surname_fold <> '' AND f1.wife_alt_surname_fold = wm.sur1)
        JOIN families f2 ON f2.contributor = :contrib_b
                        AND (f2.husband_surname_fold = hm.sur2
                             OR (f2.husband_alt_surname_fold <> '' AND f2.husband_alt_surname_fold = hm.sur2))
                        AND (f2.wife_surname_fold = wm.sur2
                             OR (f2.wife_alt_surname_fold <> '' AND f2.wife_alt_surname_fold = wm.sur2))
        WHERE f1.contributor = :contrib_a
    ),
    plausible AS (
        SELECT * FROM cands
        WHERE yr_diff IS NULL OR yr_diff <= m_tol
    ),
    -- Up to four surname/alt_surname combinations can hit the same (a_id, b_id);
    -- keep the combo with the strongest combined surname signal.
    cands_dedup AS (
        SELECT DISTINCT ON (a_id, b_id) *
        FROM plausible
        ORDER BY a_id, b_id, (s_hsur + s_wsur) DESC
    ),
    scored AS (
        SELECT a_id, b_id, s_hsur, s_wsur, s_hname, s_wname, s_place, yr_diff, s_hp, s_wp, s_cl,
            (
                s_hsur * 25.0 +
                s_wsur * 25.0 +
                COALESCE(s_hname, 0.5) * 15.0 +
                COALESCE(s_wname, 0.5) * 15.0 +
                COALESCE(s_place, 0.5) * 10.0 +
                COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / m_tol), 0.5) * 10.0 +
                COALESCE(s_hp, 0.0) * 15.0 +
                COALESCE(s_wp, 0.0) * 15.0 +
                COALESCE(s_cl, 0.0) * 15.0
            ) / (
                100.0 +
                CASE WHEN s_hp IS NOT NULL THEN 15.0 ELSE 0.0 END +
                CASE WHEN s_wp IS NOT NULL THEN 15.0 ELSE 0.0 END +
                CASE WHEN s_cl IS NOT NULL THEN 15.0 ELSE 0.0 END
            ) AS base_conf
        FROM cands_dedup
    ),
    bonused AS (
        SELECT a_id, b_id, s_hsur, s_wsur, s_hname, s_wname, s_place, yr_diff, s_hp, s_wp, s_cl,
            -- Identity-key bonus: exact husband + wife surname and given-name
            -- matches plus an exact marriage-year match are near-conclusive.
            CASE WHEN s_hsur = 1.0 AND s_wsur = 1.0
                  AND s_hname = 1.0 AND s_wname = 1.0 AND yr_diff = 0
                 THEN GREATEST(base_conf, :identity_conf)
                 ELSE base_conf
            END AS conf
        FROM scored
    ),
    filtered AS (
        SELECT a_id, b_id, conf, jsonb_build_object(
            'husband_surname', round(s_hsur::numeric, 3),
            'wife_surname',    round(s_wsur::numeric, 3),
            'husband_name',    CASE WHEN s_hname IS NOT NULL THEN round(s_hname::numeric, 3) END,
            'wife_name',       CASE WHEN s_wname IS NOT NULL THEN round(s_wname::numeric, 3) END,
            'place',           CASE WHEN s_place IS NOT NULL THEN round(s_place::numeric, 3) END,
            'year_diff',       yr_diff,
            'husband_parents', CASE WHEN s_hp IS NOT NULL THEN round(s_hp::numeric, 3) END,
            'wife_parents',    CASE WHEN s_wp IS NOT NULL THEN round(s_wp::numeric, 3) END,
            'children',        CASE WHEN s_cl IS NOT NULL THEN round(s_cl::numeric, 3) END
        )::text AS match_fields
        FROM bonused WHERE conf >= :conf_min
    )
    SELECT :contrib_a, :contrib_b, 'family', a_id, b_id, conf, match_fields FROM filtered
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'family', b_id, a_id, conf, match_fields FROM filtered
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
        "yr_tol_approx": YEAR_TOLERANCE_APPROX,
        "identity_conf": IDENTITY_KEY_CONFIDENCE,
        "conf_min": CONFIDENCE_MIN,
        "trgm_thresh": TRGM_THRESHOLD,
    }
    pair_label = f"{contrib_a}↔{contrib_b}"

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

        conn.execute(
            text("""
            -- alt_surname rows feed the candidate-surname pool too, so a
            -- person whose canonical surname differs from the partner's
            -- canonical surname can still match via either alt. *_fold
            -- columns are lower-cased/accent-stripped, so diacritic variants
            -- (e.g. "Žagar" vs "Zagar") land in the same surname bucket.
            CREATE TEMP TABLE a_sur ON COMMIT DROP AS
            SELECT surname_fold AS sur FROM persons WHERE contributor = :contrib_a AND surname_fold <> ''
            UNION SELECT alt_surname_fold FROM persons WHERE contributor = :contrib_a AND alt_surname_fold <> ''
            UNION SELECT husband_surname_fold FROM families WHERE contributor = :contrib_a AND husband_surname_fold <> ''
            UNION SELECT husband_alt_surname_fold FROM families WHERE contributor = :contrib_a AND husband_alt_surname_fold <> ''
            UNION SELECT wife_surname_fold FROM families WHERE contributor = :contrib_a AND wife_surname_fold <> ''
            UNION SELECT wife_alt_surname_fold FROM families WHERE contributor = :contrib_a AND wife_alt_surname_fold <> '';

            ALTER TABLE a_sur ADD PRIMARY KEY (sur);

            CREATE TEMP TABLE b_sur ON COMMIT DROP AS
            SELECT surname_fold AS sur FROM persons WHERE contributor = :contrib_b AND surname_fold <> ''
            UNION SELECT alt_surname_fold FROM persons WHERE contributor = :contrib_b AND alt_surname_fold <> ''
            UNION SELECT husband_surname_fold FROM families WHERE contributor = :contrib_b AND husband_surname_fold <> ''
            UNION SELECT husband_alt_surname_fold FROM families WHERE contributor = :contrib_b AND husband_alt_surname_fold <> ''
            UNION SELECT wife_surname_fold FROM families WHERE contributor = :contrib_b AND wife_surname_fold <> ''
            UNION SELECT wife_alt_surname_fold FROM families WHERE contributor = :contrib_b AND wife_alt_surname_fold <> '';

            ALTER TABLE b_sur ADD PRIMARY KEY (sur);

            CREATE INDEX b_sur_trgm ON b_sur USING gist(sur gist_trgm_ops);
            ANALYZE a_sur;
            ANALYZE b_sur;

            CREATE TEMP TABLE sur_matches ON COMMIT DROP AS
            SELECT a.sur AS sur1, b.sur AS sur2,
                   CASE WHEN a.sur = b.sur THEN 1.0 ELSE similarity(a.sur, b.sur) END AS s_sur
            FROM a_sur a
            JOIN b_sur b ON a.sur % b.sur;

            CREATE INDEX sur_matches_1 ON sur_matches(sur1);
            CREATE INDEX sur_matches_2 ON sur_matches(sur2);
            ANALYZE sur_matches;
        """),
            params,
        )

        for sql, label in (
            (_PERSON_INSERT, "person"),
            (_FAMILY_INSERT, "family"),
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
    for table, year_col, date_col in (
        ("persons", "birth_year", "date_of_birth"),
        ("persons", "death_year", "date_of_death"),
        ("families", "marriage_year", "date_of_marriage"),
    ):
        with engine.connect() as conn:
            null_rows = conn.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE {year_col} IS NULL AND {date_col} ~ '\\d{{4}}'")
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
            log.info(f"  {table}.{year_col} back-fill done in {time.monotonic()-t_bf:.0f}s")

    log.info("Running ANALYZE for fresh planner statistics...")
    with engine.begin() as conn:
        conn.execute(text("ANALYZE persons"))
        conn.execute(text("ANALYZE families"))

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
