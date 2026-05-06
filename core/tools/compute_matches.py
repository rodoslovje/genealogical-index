#!/usr/bin/env python3
"""Background script: compute cross-contributor record matches after data import.

Reads pending jobs from match_jobs, runs pg_trgm similarity queries for births,
families and deaths, and stores results in the matches table.

Triggered automatically by import_to_db.py; can also be run manually:
    docker compose exec api python tools/compute_matches.py
"""

import json
import logging
import os
import sys

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
YEAR_TOLERANCE = 5    # max year difference still considered a match
CONFIDENCE_MIN = 0.72 # records below this threshold are not stored

# --- DB setup (mirrors import_to_db.py) ---
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

# ---------------------------------------------------------------------------
# Matching SQL — one CTE per record type; uses GiST trgm indexes via %
# ---------------------------------------------------------------------------

_BIRTH_SQL = text(r"""
    WITH cands AS (
        SELECT
            b1.id  AS a_id,
            b2.id  AS b_id,
            b2.contributor AS b_contrib,
            similarity(b1.surname, b2.surname) AS s_sur,
            similarity(b1.name,    b2.name)    AS s_name,
            CASE WHEN COALESCE(b1.place_of_birth, '') != ''
                      AND COALESCE(b2.place_of_birth, '') != ''
                 THEN similarity(b1.place_of_birth, b2.place_of_birth)
                 ELSE NULL END AS s_place,
            CASE WHEN b1.date_of_birth ~ '\d{4}' AND b2.date_of_birth ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(b1.date_of_birth FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(b2.date_of_birth FROM '\d{4}') AS INT)
                 )
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
    )
    SELECT a_id, b_id, b_contrib, s_sur, s_name, s_place, yr_diff,
        (s_sur  * 0.35 +
         s_name * 0.30 +
         COALESCE(s_place, 0.5) * 0.15 +
         COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
        ) AS conf
    FROM cands
""")

_FAMILY_SQL = text(r"""
    WITH cands AS (
        SELECT
            f1.id AS a_id,
            f2.id AS b_id,
            f2.contributor AS b_contrib,
            similarity(f1.husband_surname, f2.husband_surname) AS s_hsur,
            similarity(f1.wife_surname,    f2.wife_surname)    AS s_wsur,
            CASE WHEN COALESCE(f1.husband_name, '') != ''
                      AND COALESCE(f2.husband_name, '') != ''
                 THEN similarity(f1.husband_name, f2.husband_name) ELSE NULL END AS s_hname,
            CASE WHEN COALESCE(f1.wife_name, '') != ''
                      AND COALESCE(f2.wife_name, '') != ''
                 THEN similarity(f1.wife_name, f2.wife_name) ELSE NULL END AS s_wname,
            CASE WHEN COALESCE(f1.place_of_marriage, '') != ''
                      AND COALESCE(f2.place_of_marriage, '') != ''
                 THEN similarity(f1.place_of_marriage, f2.place_of_marriage)
                 ELSE NULL END AS s_place,
            CASE WHEN f1.date_of_marriage ~ '\d{4}' AND f2.date_of_marriage ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(f1.date_of_marriage FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(f2.date_of_marriage FROM '\d{4}') AS INT)
                 )
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
    )
    SELECT a_id, b_id, b_contrib, s_hsur, s_wsur, s_hname, s_wname, s_place, yr_diff,
        (s_hsur * 0.25 +
         s_wsur * 0.25 +
         COALESCE(s_hname, 0.5) * 0.15 +
         COALESCE(s_wname, 0.5) * 0.15 +
         COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.10 +
         COALESCE(s_place, 0.5) * 0.10
        ) AS conf
    FROM cands
""")

_DEATH_SQL = text(r"""
    WITH cands AS (
        SELECT
            d1.id AS a_id,
            d2.id AS b_id,
            d2.contributor AS b_contrib,
            similarity(d1.surname, d2.surname) AS s_sur,
            similarity(d1.name,    d2.name)    AS s_name,
            CASE WHEN COALESCE(d1.place_of_death, '') != ''
                      AND COALESCE(d2.place_of_death, '') != ''
                 THEN similarity(d1.place_of_death, d2.place_of_death)
                 ELSE NULL END AS s_place,
            CASE WHEN d1.date_of_death ~ '\d{4}' AND d2.date_of_death ~ '\d{4}'
                 THEN ABS(
                     CAST(SUBSTRING(d1.date_of_death FROM '\d{4}') AS INT) -
                     CAST(SUBSTRING(d2.date_of_death FROM '\d{4}') AS INT)
                 )
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
    )
    SELECT a_id, b_id, b_contrib, s_sur, s_name, s_place, yr_diff,
        (s_sur  * 0.35 +
         s_name * 0.30 +
         COALESCE(s_place, 0.5) * 0.15 +
         COALESCE(GREATEST(0.0, 1.0 - yr_diff::float / :yr_tol), 0.5) * 0.20
        ) AS conf
    FROM cands
""")

_INSERT_SQL = text("""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id, confidence, match_fields)
    VALUES
        (:contributor_a, :contributor_b, :record_type, :record_a_id, :record_b_id, :confidence, :match_fields)
""")


def _rows_to_matches(rows, contributor_a, record_type):
    results = []
    for r in rows:
        if r.conf < CONFIDENCE_MIN:
            continue
        if record_type in ("birth", "death"):
            fields = {"surname": round(float(r.s_sur), 3), "name": round(float(r.s_name), 3)}
            if r.s_place is not None:
                fields["place"] = round(float(r.s_place), 3)
            if r.yr_diff is not None:
                fields["year_diff"] = int(r.yr_diff)
        else:
            fields = {
                "husband_surname": round(float(r.s_hsur), 3),
                "wife_surname": round(float(r.s_wsur), 3),
            }
            if r.s_hname is not None:
                fields["husband_name"] = round(float(r.s_hname), 3)
            if r.s_wname is not None:
                fields["wife_name"] = round(float(r.s_wname), 3)
            if r.s_place is not None:
                fields["place"] = round(float(r.s_place), 3)
            if r.yr_diff is not None:
                fields["year_diff"] = int(r.yr_diff)
        results.append({
            "contributor_a": contributor_a,
            "contributor_b": r.b_contrib,
            "record_type": record_type,
            "record_a_id": r.a_id,
            "record_b_id": r.b_id,
            "confidence": round(float(r.conf), 4),
            "match_fields": json.dumps(fields),
        })
    return results


def process_job(db, contributor):
    log.info(f"Computing matches for: {contributor}")
    db.execute(text("UPDATE match_jobs SET status='running' WHERE contributor=:c"), {"c": contributor})
    db.commit()

    deleted = db.execute(
        text("DELETE FROM matches WHERE contributor_a = :c"), {"c": contributor}
    ).rowcount
    db.commit()
    if deleted:
        log.info(f"  Removed {deleted} stale matches")

    params = {"contrib": contributor, "yr_tol": YEAR_TOLERANCE}
    db.execute(text("SET pg_trgm.similarity_threshold = 0.65;"))

    all_matches = []
    for sql, record_type in ((_BIRTH_SQL, "birth"), (_FAMILY_SQL, "family"), (_DEATH_SQL, "death")):
        rows = db.execute(sql, params).fetchall()
        matches = _rows_to_matches(rows, contributor, record_type)
        all_matches.extend(matches)
        log.info(f"  {record_type}: {len(matches)} matches")

    if all_matches:
        db.execute(_INSERT_SQL, all_matches)
        db.commit()

    db.execute(
        text("UPDATE match_jobs SET status='done', completed_at=NOW() WHERE contributor=:c"),
        {"c": contributor},
    )
    db.commit()
    log.info(f"  Done: {len(all_matches)} total matches stored")


def main():
    db = SessionLocal()
    try:
        pending = db.execute(
            text("SELECT contributor FROM match_jobs WHERE status='pending' ORDER BY queued_at")
        ).fetchall()

        if not pending:
            log.info("No pending match jobs.")
            return

        log.info(f"Processing {len(pending)} pending job(s)...")
        for (contributor,) in pending:
            try:
                process_job(db, contributor)
            except Exception as exc:
                log.error(f"Error processing {contributor}: {exc}")
                try:
                    db.rollback()
                    db.execute(
                        text("UPDATE match_jobs SET status='error' WHERE contributor=:c"),
                        {"c": contributor},
                    )
                    db.commit()
                except Exception:
                    pass

        log.info("Match computation complete.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
