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
import hashlib
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
IDENTITY_KEY_CONFIDENCE_FULL = 0.99  # higher floor when, in addition to the
# identity key, both sides record the *same full date* (day+month+year) for
# birth, death or (for families) marriage — much stronger evidence than a
# year-only coincidence, which only floors to IDENTITY_KEY_CONFIDENCE.
YEAR_EXTRA_APPROX = YEAR_TOLERANCE_APPROX - YEAR_TOLERANCE  # the extra slack a
# qualified date earns on the side(s) its qualifier permits: ABT/EST/CAL get
# it in both directions, BEF/AFT only in the direction the qualifier allows
# (see the signed year gate in `plausible`).
COARSE_YEAR_TOLERANCE = YEAR_TOLERANCE + 2 * YEAR_EXTRA_APPROX  # cheap
# pre-filter applied as a JOIN condition, before the expensive name/place
# similarity() calls. A strict superset of the real signed per-record gate in
# the `plausible` CTE (whose widest reach is yr_tol + extra on each side when
# both qualifiers cooperate), so it never excludes a pair that would
# otherwise pass — it just lets common-surname cross-products (e.g. hundreds
# x hundreds of "Novak"s) skip trigram similarity work for pairs whose years
# are wildly apart on both birth and death.
ALT_SURNAME_PENALTY = 0.85  # multiplier applied to s_sur when the surname match
# involves an alt_surname (a recorded married/maiden/alternate name) on either
# side rather than both sides' primary surname_fold — a surname-altsurname hit
# is weaker corroboration than a surname-surname one.
MAX_LIFESPAN = 110  # years. A pair implying one person lived longer than this
# (one record's birth year vs the other record's death year) is rejected.
# Catches same-name father/son and grandfather/grandson pairs where each
# record carries only one of the two years, so the plain year-diff gates
# never fire.
COMMON_SURNAME_SHARE = 0.001  # a folded surname carried by at least this share
# of all surname mentions (persons + families, own + alt) counts as "common".
# Agreement on a common surname (Novak, Horvat, ...) is weak identity
# evidence, so common-surname pairs must present two corroborating fields
# instead of one — see the minimum-evidence gate in the person query.
COMMON_SURNAME_MIN_COUNT = 200  # absolute floor for the "common" cutoff so
# small datasets don't classify every surname as common.
CONFIDENCE_MIN = 0.80  # records below this threshold are not stored
TRGM_THRESHOLD = 0.72  # pg_trgm.similarity_threshold for the % join operator
# kept below CONFIDENCE_MIN so pairs where one surname/name
# field is weaker but year+place compensate are not missed
MATCH_COLUMN_SCHEMA_VERSION = 1  # bump when the definition of any
# precomputed match column changes (name_canon_text(), list_match_text(),
# date_qualifier(), the *_full_date normalisation, ...) — it is hashed into
# the match_meta version stamp, so bumping forces a full recompute of the
# precomputed columns on the next run.
NAME_SYNONYM_SCORE = 0.95  # s_name when two given names are known
# cross-language forms of the same name (Johannes/Janez/Ivan) rather than the
# same spelling. Slightly below 1.0 so exact agreement still ranks higher and
# the identity-key floor (which demands s_name = 1.0) stays reserved for
# exact name matches.
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


# Cross-language given-name equivalence groups, in folded form (lowercase,
# accent-stripped). Parish registers switch language with the political wind:
# the same person is baptised "Joannes", marries as "Johann" and is buried as
# "Janez" — trigram similarity can't bridge those, so names are additionally
# compared after canonicalising each token through this table (see
# name_canon_text()). Key = canonical group name (Latin register form),
# values = Latin/German/Slovene/Croatian variants and established folk forms.
# Deliberately conservative: only well-documented register equivalences.
# Mathias (matija) and Matthaeus (matevz) stay separate on purpose — priests
# did conflate them, but merging them here would be a judgement call.
# Ambiguous diminutives (tine, tina, dora, alenka, ...) are left out because
# they map to several distinct names.
NAME_SYNONYM_GROUPS = {
    # male
    "johannes": ["joannes", "johann", "hans", "janez", "ivan", "jan", "anze", "janko"],
    "josephus": ["joseph", "josef", "jozef", "joze", "josip"],
    "georgius": ["georg", "jurij", "juraj", "jure", "juri"],
    "franciscus": ["franz", "franc", "francisek", "franjo", "frane", "fran"],
    "antonius": ["anton", "antun", "ante", "tone"],
    "michael": ["mihael", "miha", "mihovil", "miho"],
    "jacobus": ["jacob", "jakob", "jaka", "jakov"],
    "petrus": ["peter", "petar", "pero"],
    "paulus": ["paul", "pavel", "pavao", "pavle"],
    "andreas": ["andrej", "andrija", "andraz"],
    "stephanus": ["stephan", "stefan", "stjepan"],
    "laurentius": ["lorenz", "lovrenc", "lovro", "lovre"],
    "gregorius": ["gregor", "grega", "grgur"],
    "bartholomaeus": ["jernej", "bartol", "bartolomej"],
    "valentinus": ["valentin"],
    "vincentius": ["vincenc", "vinko", "cene"],
    "aloysius": ["alois", "alojz", "alojzij", "lojze", "vekoslav"],
    "ignatius": ["ignaz", "ignac", "ignacij", "nace"],
    "carolus": ["karl", "karel", "karol", "dragotin"],
    "casparus": ["caspar", "kaspar", "gaspar", "gasper"],
    "primus": ["primoz"],
    "urbanus": ["urban"],
    "blasius": ["blaz", "vlaho"],
    "nicolaus": ["nikolaj", "nikola", "miklavz", "niko"],
    "sebastianus": ["sebastian", "sebastjan", "bostjan"],
    "christophorus": ["kristof", "kristofor"],
    "thomas": ["tomaz", "tomo", "toma"],
    "martinus": ["martin"],
    "leopoldus": ["leopold", "lavoslav", "polde"],
    "theodorus": ["teodor", "todor", "bozidar"],
    "ludovicus": ["ludwig", "ludvik", "ludovik", "ljudevit"],
    "henricus": ["heinrich", "henrik", "hinko"],
    "matthaeus": ["matevz", "matej", "matthaus"],
    "mathias": ["matija", "matjaz"],
    "florianus": ["florian", "florijan", "cvetko"],
    "vitus": ["vid", "vito"],
    "augustus": ["august", "avgust"],
    "augustinus": ["augustin", "avgustin"],
    "simon": ["simun", "sime"],
    # female
    "maria": ["marija", "mica", "micka"],
    "anna": ["ana", "anica", "ancka"],
    "johanna": ["johana", "ivana", "ivanka"],
    "catharina": ["katharina", "katarina", "kata", "katra", "katica"],
    "elisabeth": ["elisabetha", "elizabeta", "spela", "jelisava"],
    "margaretha": ["margareta", "marjeta", "meta", "marjetica"],
    "agnes": ["agneza", "neza", "janja"],
    "gertrudis": ["gertruda", "jera", "jedert", "jedrt"],
    "helena": ["jelena", "jela"],
    "lucia": ["lucija", "lucka"],
    "apollonia": ["apolonija", "polona", "polonca"],
    "francisca": ["franciska", "francka", "fanika"],
    "josepha": ["jozefa", "josipa", "pepca"],
    "rosalia": ["rozalija", "roza", "zalka"],
    "aloisia": ["alojzija", "lojzka"],
    "antonia": ["antonija", "toncka", "tona"],
    "magdalena": ["madlena", "magda", "majda"],
    "sophia": ["sofia", "sofija", "zofija", "zofka"],
    "susanna": ["susana", "suzana", "zuzana"],
    "caecilia": ["cecilija", "cilka"],
    "theresia": ["terezija", "reza", "rezka"],
    "ursula": ["urska", "ursa"],
    "dorothea": ["doroteja"],
    "agatha": ["agata"],
    "christina": ["kristina"],
}

# Seeds/refreshes the synonym machinery: the name_synonyms lookup table, the
# *_name_canon columns, and name_canon_text() — which folds every token of a
# given name through the synonym table and sorts the tokens, so
# "Janez Krstnik"/"Krstnik Johannes" both canonicalise to
# "johannes krstnik". STABLE (reads name_synonyms), so the result is stored
# in real columns by main() rather than generated columns.
_NAME_CANON_SETUP_SQL = text(r"""
    CREATE TABLE IF NOT EXISTS name_synonyms (
        variant TEXT PRIMARY KEY,
        canon   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_meta (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    -- Precomputed match columns. The hot candidate join used to evaluate
    -- date_qualifier()/has_day_precision() (regexes) and list_match_text()
    -- (JSONB rebuild) once per CANDIDATE PAIR — a person joined against 500
    -- candidates re-ran all of them 500 times, in every pair job. They are
    -- pure functions of the row, so main() computes them once per row here:
    --   *_q               date_qualifier() code (0/1/2/3)
    --   *_full_date       lower(trim(date)) when day-precise, else NULL —
    --                     full_*_match becomes a plain equality
    --   *_match_text      list_match_text() of the JSONB list
    -- birth_q/marriage_q double as the "row is filled in" marker (they are
    -- never NULL after a fill), so the incremental backfill only touches
    -- freshly imported rows.
    ALTER TABLE persons
        ADD COLUMN IF NOT EXISTS name_canon TEXT,
        ADD COLUMN IF NOT EXISTS birth_q SMALLINT,
        ADD COLUMN IF NOT EXISTS death_q SMALLINT,
        ADD COLUMN IF NOT EXISTS birth_full_date TEXT,
        ADD COLUMN IF NOT EXISTS death_full_date TEXT,
        ADD COLUMN IF NOT EXISTS parents_match_text TEXT,
        ADD COLUMN IF NOT EXISTS partners_match_text TEXT;
    ALTER TABLE families
        ADD COLUMN IF NOT EXISTS husband_name_canon TEXT,
        ADD COLUMN IF NOT EXISTS wife_name_canon TEXT,
        ADD COLUMN IF NOT EXISTS marriage_q SMALLINT,
        ADD COLUMN IF NOT EXISTS marriage_full_date TEXT,
        ADD COLUMN IF NOT EXISTS husband_parents_match_text TEXT,
        ADD COLUMN IF NOT EXISTS wife_parents_match_text TEXT,
        ADD COLUMN IF NOT EXISTS children_match_text TEXT;

    CREATE OR REPLACE FUNCTION name_canon_text(t text) RETURNS text
        LANGUAGE sql STABLE PARALLEL SAFE AS
    $$
    SELECT COALESCE(
        string_agg(COALESCE(ns.canon, w.tok), ' ' ORDER BY COALESCE(ns.canon, w.tok)),
        '')
    FROM regexp_split_to_table(COALESCE(t, ''), '[^a-z]+') AS w(tok)
    LEFT JOIN name_synonyms ns ON ns.variant = w.tok
    WHERE w.tok <> ''
    $$;
""")

# Extracts a canonical plain-text form of a parents/partners/children JSONB
# list for cross-contributor comparison: just the folded person names, sorted
# and joined. Comparing this instead of the JSON serialization matters because
# every JSON element contributes identical key/punctuation trigrams
# ('{"name": ...'), so two completely unrelated parent pairs still looked
# ~0.5 similar and genuinely different relatives never dragged the score down.
# Parenthetical annotations ('Katarina (v."Razorčeva")') are stripped since
# they are contributor-specific. Sorting makes the equality fast-path
# order-insensitive. Elements with no name at all contribute nothing; a list
# with only such elements yields NULL, which downstream treats as "no data"
# (the old id-stripped comparison scored two id-only lists as a perfect 1.0).
_LIST_MATCH_TEXT_SQL = text(r"""
    -- Classifies a GEDCOM date string's qualifier: 0 = plain, 1 = symmetric
    -- approximation (ABT/EST/CAL/CIRCA/~), 2 = BEF (recorded year is an
    -- UPPER bound on the true year), 3 = AFT (a LOWER bound). Unlike the
    -- older is_approx_date(), this keeps BEF/AFT directional: "AFT 1850"
    -- widens the tolerance only towards later years — a person born 1836
    -- is not a candidate for an "AFT 1850" birth.
    CREATE OR REPLACE FUNCTION date_qualifier(d text) RETURNS int
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
    $$
    SELECT CASE
        WHEN COALESCE(d, '') ~* '\y(BEF|BEFORE)\y' THEN 2
        WHEN COALESCE(d, '') ~* '\y(AFT|AFTER)\y' THEN 3
        WHEN COALESCE(d, '') ~* '\y(ABT|ABOUT|EST|ESTIMATED|CAL|CALC|CALCULATED|CIRCA|CA)\y|~' THEN 1
        ELSE 0 END
    $$;

    CREATE OR REPLACE FUNCTION list_match_text(arr jsonb) RETURNS text
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
    $$
    SELECT CASE WHEN arr IS NULL OR jsonb_typeof(arr) <> 'array' THEN NULL
    ELSE NULLIF((
        SELECT string_agg(txt, '; ' ORDER BY txt)
        FROM (
            SELECT fold_text(CASE WHEN jsonb_typeof(elem) = 'object'
                THEN regexp_replace(
                    trim(concat_ws(' ', elem->>'name', elem->>'surname')),
                    '\s*\([^)]*\)', '', 'g')
                ELSE elem #>> '{}' END) AS txt
            FROM jsonb_array_elements(arr) AS elem
        ) t
        WHERE txt <> ''
    ), '') END
    $$;
""")

# Global similar-surname pairs over the distinct folded-surname vocabulary,
# maintained INCREMENTALLY: hundreds of contributors draw on essentially the
# same national surname pool, so the per-job trigram self-join used to redo
# the same similarity comparisons O(N^2) times across jobs. main() trigram-
# compares only surnames never seen before (not yet in surname_vocab) against
# the full vocabulary; per-job sur_matches then reduces to plain equijoins.
# Both orientations of every pair are stored so either side can drive the
# join. A threshold stamp in match_meta invalidates the table when
# TRGM_THRESHOLD changes.
_SURNAME_PAIRS_DDL = text("""
    CREATE TABLE IF NOT EXISTS surname_vocab (sur TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS surname_pairs (
        sur1  TEXT NOT NULL,
        sur2  TEXT NOT NULL,
        s_sur REAL NOT NULL,
        PRIMARY KEY (sur1, sur2)
    );
""")

_SURNAME_PAIRS_INCREMENT_SQL = text("""
    WITH p AS (
        -- % uses the session similarity_threshold (= TRGM_THRESHOLD) and the
        -- permanent GIN trigram index on contributor_surnames.sur.
        SELECT DISTINCT n.sur AS sur1, cs.sur AS sur2,
               CASE WHEN n.sur = cs.sur THEN 1.0
                    ELSE similarity(n.sur, cs.sur) END AS s_sur
        FROM new_surs n
        JOIN contributor_surnames cs ON n.sur % cs.sur
    )
    INSERT INTO surname_pairs (sur1, sur2, s_sur)
    SELECT sur1, sur2, s_sur FROM p
    UNION ALL
    -- Mirror orientation for old-vocabulary partners; new-new pairs already
    -- appear in both orientations in p itself.
    SELECT sur2, sur1, s_sur FROM p
    WHERE sur2 NOT IN (SELECT sur FROM new_surs)
    ON CONFLICT (sur1, sur2) DO NOTHING
""")

# Global folded-surname frequency, rebuilt once per compute run (cheap: one
# GROUP BY over persons + families). is_common marks surnames carried by at
# least COMMON_SURNAME_SHARE of all surname mentions (with an absolute floor
# of COMMON_SURNAME_MIN_COUNT); process_job folds the flag into sur_matches.
_SURNAME_FREQ_SQL = text("""
    DROP TABLE IF EXISTS surname_freq;
    CREATE UNLOGGED TABLE surname_freq AS
    WITH bearers AS (
        SELECT surname_fold AS sur FROM persons WHERE surname_fold <> ''
        UNION ALL SELECT alt_surname_fold FROM persons WHERE alt_surname_fold <> ''
        UNION ALL SELECT husband_surname_fold FROM families WHERE husband_surname_fold <> ''
        UNION ALL SELECT husband_alt_surname_fold FROM families WHERE husband_alt_surname_fold <> ''
        UNION ALL SELECT wife_surname_fold FROM families WHERE wife_surname_fold <> ''
        UNION ALL SELECT wife_alt_surname_fold FROM families WHERE wife_alt_surname_fold <> ''
    ),
    counts AS (SELECT sur, COUNT(*) AS cnt FROM bearers GROUP BY sur)
    SELECT sur, cnt,
           cnt >= GREATEST(CAST(:min_count AS bigint),
                           CAST(CAST(:share AS float8) * (SELECT SUM(cnt) FROM counts) AS bigint))
               AS is_common
    FROM counts;
    ALTER TABLE surname_freq ADD PRIMARY KEY (sur);
""")


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
         confidence, match_fields, surnames)
    WITH cands AS (
        SELECT
            p1.id AS a_id,
            p2.id AS b_id,
            sm.is_common AS common_sur,
            p1.birth_year AS a_birth_year, p1.death_year AS a_death_year,
            p2.birth_year AS b_birth_year, p2.death_year AS b_death_year,
            -- A surname-surname hit is stronger corroboration than one
            -- involving either side's alt_surname (married/maiden/alternate
            -- name), so the latter is scored down by ALT_SURNAME_PENALTY.
            CASE WHEN p1.surname_fold = sm.sur1 AND p2.surname_fold = sm.sur2
                 THEN sm.s_sur
                 ELSE sm.s_sur * :alt_surname_penalty
            END AS s_sur,
            -- name_fold (lower-cased, accent-stripped given name) makes
            -- e.g. "Žan"/"Zan" compare equal; <> '' avoids two blank given
            -- names scoring as a perfect match. name_canon additionally
            -- equates cross-language forms (Johannes/Janez/Ivan) via the
            -- name_synonyms table, at a slight discount to exact agreement.
            CASE WHEN p1.name_fold = p2.name_fold AND p1.name_fold <> '' THEN 1.0
                 WHEN p1.name_canon = p2.name_canon AND p1.name_canon <> '' THEN :name_syn_score
                 ELSE similarity(p1.name_fold, p2.name_fold) END AS s_name,
            CASE WHEN COALESCE(p1.place_of_birth,'') != ''
                      AND COALESCE(p2.place_of_birth,'') != ''
                 THEN CASE WHEN p1.place_of_birth = p2.place_of_birth THEN 1.0 ELSE similarity(p1.place_of_birth, p2.place_of_birth) END
                 ELSE NULL END AS s_bplace,
            CASE WHEN COALESCE(p1.place_of_death,'') != ''
                      AND COALESCE(p2.place_of_death,'') != ''
                 THEN CASE WHEN p1.place_of_death = p2.place_of_death THEN 1.0 ELSE similarity(p1.place_of_death, p2.place_of_death) END
                 ELSE NULL END AS s_dplace,
            -- *_match_text: list_match_text() of the JSONB list, precomputed
            -- per row by main(). Just the folded, sorted person names, so
            -- the trigram comparison isn't diluted by JSON key/punctuation
            -- boilerplate; NULL when the list has no named elements, so the
            -- field is treated as absent.
            CASE WHEN p1.parents_match_text IS NOT NULL AND p2.parents_match_text IS NOT NULL
                 THEN CASE WHEN p1.parents_match_text = p2.parents_match_text THEN 1.0
                           ELSE similarity(p1.parents_match_text, p2.parents_match_text) END
                 ELSE NULL END AS s_parents,
            CASE WHEN p1.partners_match_text IS NOT NULL AND p2.partners_match_text IS NOT NULL
                 THEN CASE WHEN p1.partners_match_text = p2.partners_match_text THEN 1.0
                           ELSE similarity(p1.partners_match_text, p2.partners_match_text) END
                 ELSE NULL END AS s_partners,
            CASE WHEN p1.birth_year IS NOT NULL AND p2.birth_year IS NOT NULL
                 THEN ABS(p1.birth_year - p2.birth_year)
                 ELSE NULL END AS b_yr_diff,
            CASE WHEN p1.death_year IS NOT NULL AND p2.death_year IS NOT NULL
                 THEN ABS(p1.death_year - p2.death_year)
                 ELSE NULL END AS d_yr_diff,
            -- Signed diffs (a-side minus b-side) for the directional BEF/AFT
            -- year gate in `plausible`; NULL when either side lacks the year.
            p1.birth_year - p2.birth_year AS b_yr_sdiff,
            p1.death_year - p2.death_year AS d_yr_sdiff,
            -- Full date (day+month+year) agreement: stronger corroboration
            -- than a year-only match (b_yr_diff/d_yr_diff = 0 alone doesn't
            -- distinguish "1892" from "20 NOV 1892"). *_full_date is the
            -- normalised date, precomputed per row, NULL unless day-precise.
            (p1.birth_full_date IS NOT NULL
             AND p1.birth_full_date = p2.birth_full_date) AS full_birth_match,
            (p1.death_full_date IS NOT NULL
             AND p1.death_full_date = p2.death_full_date) AS full_death_match,
            -- Date-qualifier codes (0 plain / 1 approx / 2 BEF / 3 AFT),
            -- precomputed per row, used by `tolerated`/`plausible` to widen
            -- year tolerances — in both directions for approximations (those
            -- years are often back-derived from a relative's birth/death and
            -- can be off by a decade or more), one direction only for
            -- BEF/AFT.
            p1.birth_q AS bq1,
            p2.birth_q AS bq2,
            p1.death_q AS dq1,
            p2.death_q AS dq2
        FROM sur_matches sm
        JOIN persons p1 ON p1.contributor = :contrib_a
                       AND (p1.surname_fold = sm.sur1
                            OR (p1.alt_surname_fold <> '' AND p1.alt_surname_fold = sm.sur1))
        JOIN persons p2 ON p2.contributor = :contrib_b
                       AND (p2.surname_fold = sm.sur2
                            OR (p2.alt_surname_fold <> '' AND p2.alt_surname_fold = sm.sur2))
                       -- Cheap integer pre-filter before the trigram similarity
                       -- below: skip pairs whose birth AND death years are both
                       -- wildly apart (or absent on one side). See
                       -- COARSE_YEAR_TOLERANCE.
                       AND (
                           p1.birth_year IS NULL OR p2.birth_year IS NULL
                           OR ABS(p1.birth_year - p2.birth_year) <= :coarse_yr_tol
                           OR (p1.death_year IS NOT NULL AND p2.death_year IS NOT NULL
                               AND ABS(p1.death_year - p2.death_year) <= :coarse_yr_tol)
                       )
        -- The leading <> '' prunes pairs where BOTH given names are blank:
        -- they'd pass the '' = '' equality, but with s_name stuck at 0 the
        -- highest attainable confidence (~79.3%) is below CONFIDENCE_MIN, so
        -- they can never be stored — computing their places/lists is waste.
        WHERE p1.name_fold <> ''
          AND (p1.name_fold = p2.name_fold
               OR (p1.name_canon <> '' AND p1.name_canon = p2.name_canon)
               OR similarity(p1.name_fold, p2.name_fold) >= :trgm_thresh)
    ),
    -- Per-side symmetric tolerances (any qualifier widens the score-decay
    -- window and the lifespan slack); separate CTE so `plausible` can
    -- reference them by name in its WHERE.
    tolerated AS (
        SELECT *,
               CASE WHEN bq1 <> 0 THEN :yr_tol_approx ELSE :yr_tol END AS bt1,
               CASE WHEN bq2 <> 0 THEN :yr_tol_approx ELSE :yr_tol END AS bt2,
               CASE WHEN dq1 <> 0 THEN :yr_tol_approx ELSE :yr_tol END AS dt1,
               CASE WHEN dq2 <> 0 THEN :yr_tol_approx ELSE :yr_tol END AS dt2
        FROM cands
    ),
    -- Year-tolerance and lifespan-plausibility gates. The year gate is
    -- SIGNED: each side earns :yr_extra of slack only in the direction its
    -- date qualifier permits. A record's year may understate the true year
    -- when qualified approx (1) or AFT (3), and overstate it when approx (1)
    -- or BEF (2) — so for sdiff = year_a - year_b the lower bound widens
    -- with a-understates/b-overstates and the upper bound with the mirror
    -- combination. Plain dates on both sides reduce to |sdiff| <= :yr_tol.
    plausible AS (
        SELECT *,
               GREATEST(bt1, bt2) AS b_tol,
               GREATEST(dt1, dt2) AS d_tol
        FROM tolerated
        WHERE (
                (b_yr_sdiff IS NULL
                 OR (b_yr_sdiff >= -(:yr_tol + CASE WHEN bq1 IN (1,3) THEN :yr_extra ELSE 0 END
                                             + CASE WHEN bq2 IN (1,2) THEN :yr_extra ELSE 0 END)
                     AND b_yr_sdiff <= :yr_tol + CASE WHEN bq1 IN (1,2) THEN :yr_extra ELSE 0 END
                                              + CASE WHEN bq2 IN (1,3) THEN :yr_extra ELSE 0 END))
                OR (d_yr_sdiff IS NOT NULL
                    AND d_yr_sdiff >= -(:yr_tol + CASE WHEN dq1 IN (1,3) THEN :yr_extra ELSE 0 END
                                                + CASE WHEN dq2 IN (1,2) THEN :yr_extra ELSE 0 END)
                    AND d_yr_sdiff <= :yr_tol + CASE WHEN dq1 IN (1,2) THEN :yr_extra ELSE 0 END
                                             + CASE WHEN dq2 IN (1,3) THEN :yr_extra ELSE 0 END)
              )
          -- Lifespan impossibility: the same person can't die before the
          -- other record's birth.
          AND NOT (a_death_year IS NOT NULL AND b_birth_year IS NOT NULL
                   AND a_death_year < b_birth_year - GREATEST(dt1, bt2))
          AND NOT (b_death_year IS NOT NULL AND a_birth_year IS NOT NULL
                   AND b_death_year < a_birth_year - GREATEST(dt2, bt1))
          -- ...nor live longer than MAX_LIFESPAN. This is the gate that fires
          -- when each record carries only ONE of the two years (p1 born 1800,
          -- p2 died 1940): b_yr_diff and d_yr_diff are both NULL then, so the
          -- year-diff gates above pass such pairs unchecked.
          AND NOT (b_death_year IS NOT NULL AND a_birth_year IS NOT NULL
                   AND b_death_year - a_birth_year > :max_lifespan + GREATEST(bt1, dt2))
          AND NOT (a_death_year IS NOT NULL AND b_birth_year IS NOT NULL
                   AND a_death_year - b_birth_year > :max_lifespan + GREATEST(bt2, dt1))
          -- Minimum-evidence gate: agreement on surname + given name alone
          -- (both scored with 0.5-neutral missing fields) reaches ~86%, above
          -- CONFIDENCE_MIN — so a pair must bring at least one corroborating
          -- field recorded on BOTH sides. For common surnames (see
          -- surname_freq) name agreement is even weaker evidence, so two
          -- corroborating fields are required — unless a full day+month+year
          -- date agrees, which is near-conclusive on its own.
          AND (
                full_birth_match OR full_death_match
                OR (b_yr_diff   IS NOT NULL)::int + (d_yr_diff  IS NOT NULL)::int
                 + (s_bplace    IS NOT NULL)::int + (s_dplace   IS NOT NULL)::int
                 + (s_parents   IS NOT NULL)::int + (s_partners IS NOT NULL)::int
                   >= CASE WHEN common_sur THEN 2 ELSE 1 END
              )
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
               full_birth_match, full_death_match,
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
            -- Identity-key bonus: exact surname + given name + a *full* (day+
            -- month+year) birth or death date match is near-conclusive, so
            -- the confidence is floored even if some other field is missing
            -- or differs. A shared birth *year* alone is not enough — two
            -- different people with a common name born the same year is
            -- unremarkable, so that case is left to base_conf instead of
            -- being floored. When both birth and death dates match fully,
            -- that's even stronger and gets a higher floor.
            CASE WHEN s_sur = 1.0 AND s_name = 1.0 AND (full_birth_match OR full_death_match)
                 THEN CASE WHEN full_birth_match AND full_death_match
                           THEN GREATEST(base_conf, :identity_conf_full)
                           ELSE GREATEST(base_conf, :identity_conf)
                      END
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
    ),
    -- Denormalize the pair's folded surnames onto the match row, so the
    -- "which genealogists match me on surname X" filter can be answered from
    -- `matches` alone (see crud.get_contributor_matches). Both sides are
    -- stored: trigram matching means the two records can legitimately spell
    -- the surname differently (Pezdirc/Pezdirec), and a search for either
    -- spelling should still find the pair. The join is over the
    -- already-thresholded `filtered` set — two PK lookups per surviving
    -- match, not per candidate.
    labeled AS (
        SELECT fl.*, ARRAY(
            SELECT DISTINCT s FROM unnest(ARRAY[
                p1.surname_fold, p1.alt_surname_fold,
                p2.surname_fold, p2.alt_surname_fold
            ]) AS s WHERE s IS NOT NULL AND s <> ''
        ) AS surs
        FROM filtered fl
        JOIN persons p1 ON p1.id = fl.a_id
        JOIN persons p2 ON p2.id = fl.b_id
    )
    SELECT :contrib_a, :contrib_b, 'person', a_id, b_id, conf, match_fields, surs FROM labeled
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'person', b_id, a_id, conf, match_fields, surs FROM labeled
""")

_FAMILY_INSERT = text(r"""
    INSERT INTO matches
        (contributor_a, contributor_b, record_type, record_a_id, record_b_id,
         confidence, match_fields, surnames)
    WITH cands AS (
        SELECT
            f1.id AS a_id,
            f2.id AS b_id,
            -- See persons cands above: penalize alt_surname-involved hits.
            CASE WHEN f1.husband_surname_fold = hm.sur1 AND f2.husband_surname_fold = hm.sur2
                 THEN hm.s_sur
                 ELSE hm.s_sur * :alt_surname_penalty
            END AS s_hsur,
            CASE WHEN f1.wife_surname_fold = wm.sur1 AND f2.wife_surname_fold = wm.sur2
                 THEN wm.s_sur
                 ELSE wm.s_sur * :alt_surname_penalty
            END AS s_wsur,
            -- Same name comparison as the persons query: exact fold match,
            -- then cross-language synonym match (name_canon), then trigram.
            CASE WHEN f1.husband_name_fold <> '' AND f2.husband_name_fold <> ''
                 THEN CASE WHEN f1.husband_name_fold = f2.husband_name_fold THEN 1.0
                           WHEN f1.husband_name_canon <> '' AND f1.husband_name_canon = f2.husband_name_canon THEN :name_syn_score
                           ELSE similarity(f1.husband_name_fold, f2.husband_name_fold) END
                 ELSE NULL END AS s_hname,
            CASE WHEN f1.wife_name_fold <> '' AND f2.wife_name_fold <> ''
                 THEN CASE WHEN f1.wife_name_fold = f2.wife_name_fold THEN 1.0
                           WHEN f1.wife_name_canon <> '' AND f1.wife_name_canon = f2.wife_name_canon THEN :name_syn_score
                           ELSE similarity(f1.wife_name_fold, f2.wife_name_fold) END
                 ELSE NULL END AS s_wname,
            CASE WHEN COALESCE(f1.place_of_marriage,'') != ''
                      AND COALESCE(f2.place_of_marriage,'') != ''
                 THEN CASE WHEN f1.place_of_marriage = f2.place_of_marriage THEN 1.0 ELSE similarity(f1.place_of_marriage, f2.place_of_marriage) END
                 ELSE NULL END AS s_place,
            -- Precomputed names-only list columns — see the persons query.
            CASE WHEN f1.husband_parents_match_text IS NOT NULL AND f2.husband_parents_match_text IS NOT NULL
                 THEN CASE WHEN f1.husband_parents_match_text = f2.husband_parents_match_text THEN 1.0
                           ELSE similarity(f1.husband_parents_match_text, f2.husband_parents_match_text) END
                 ELSE NULL END AS s_hp,
            CASE WHEN f1.wife_parents_match_text IS NOT NULL AND f2.wife_parents_match_text IS NOT NULL
                 THEN CASE WHEN f1.wife_parents_match_text = f2.wife_parents_match_text THEN 1.0
                           ELSE similarity(f1.wife_parents_match_text, f2.wife_parents_match_text) END
                 ELSE NULL END AS s_wp,
            CASE WHEN f1.children_match_text IS NOT NULL AND f2.children_match_text IS NOT NULL
                 THEN CASE WHEN f1.children_match_text = f2.children_match_text THEN 1.0
                           ELSE similarity(f1.children_match_text, f2.children_match_text) END
                 ELSE NULL END AS s_cl,
            CASE WHEN f1.marriage_year IS NOT NULL AND f2.marriage_year IS NOT NULL
                 THEN ABS(f1.marriage_year - f2.marriage_year)
                 ELSE NULL END AS yr_diff,
            f1.marriage_year - f2.marriage_year AS m_sdiff,
            -- Precomputed marriage-date qualifier codes; the signed year
            -- gate and the score-decay tolerance both derive from these
            -- (see the persons query above).
            f1.marriage_q AS mq1,
            f2.marriage_q AS mq2,
            -- Full marriage-date agreement (day+month+year), stronger than a
            -- year-only match — see persons gate above.
            (f1.marriage_full_date IS NOT NULL
             AND f1.marriage_full_date = f2.marriage_full_date) AS full_marriage_match
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
                        -- Cheap pre-filter before the name/place/list similarity()
                        -- calls below: skip pairs with wildly different marriage
                        -- years. See COARSE_YEAR_TOLERANCE.
                        AND (
                            f1.marriage_year IS NULL OR f2.marriage_year IS NULL
                            OR ABS(f1.marriage_year - f2.marriage_year) <= :coarse_yr_tol
                        )
        WHERE f1.contributor = :contrib_a
    ),
    plausible AS (
        SELECT *,
               GREATEST(CASE WHEN mq1 <> 0 THEN :yr_tol_approx ELSE :yr_tol END,
                        CASE WHEN mq2 <> 0 THEN :yr_tol_approx ELSE :yr_tol END) AS m_tol
        FROM cands
        -- Signed marriage-year gate — see the persons `plausible` CTE for
        -- the BEF/AFT directionality reasoning.
        WHERE (m_sdiff IS NULL
               OR (m_sdiff >= -(:yr_tol + CASE WHEN mq1 IN (1,3) THEN :yr_extra ELSE 0 END
                                        + CASE WHEN mq2 IN (1,2) THEN :yr_extra ELSE 0 END)
                   AND m_sdiff <= :yr_tol + CASE WHEN mq1 IN (1,2) THEN :yr_extra ELSE 0 END
                                          + CASE WHEN mq2 IN (1,3) THEN :yr_extra ELSE 0 END))
          -- At least one spouse's given name must be recorded on both sides:
          -- with both names missing (0.5-neutral each), two exact surnames
          -- plus the same marriage year alone score exactly 80% — two
          -- "Novak ⚭ Kranjc" couples married the same year are not the same
          -- family often enough to store as a match.
          AND (s_hname IS NOT NULL OR s_wname IS NOT NULL)
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
               full_marriage_match,
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
            -- matches plus a *full* (day+month+year) marriage-date match are
            -- near-conclusive. A shared marriage *year* alone is not enough —
            -- left to base_conf instead of being floored (see persons gate
            -- above for the same reasoning).
            CASE WHEN s_hsur = 1.0 AND s_wsur = 1.0
                  AND s_hname = 1.0 AND s_wname = 1.0 AND full_marriage_match
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
    ),
    -- Both spouses' surnames from both sides — see the persons insert above
    -- for why this is denormalized here rather than joined at query time.
    labeled AS (
        SELECT fl.*, ARRAY(
            SELECT DISTINCT s FROM unnest(ARRAY[
                f1.husband_surname_fold, f1.husband_alt_surname_fold,
                f1.wife_surname_fold,    f1.wife_alt_surname_fold,
                f2.husband_surname_fold, f2.husband_alt_surname_fold,
                f2.wife_surname_fold,    f2.wife_alt_surname_fold
            ]) AS s WHERE s IS NOT NULL AND s <> ''
        ) AS surs
        FROM filtered fl
        JOIN families f1 ON f1.id = fl.a_id
        JOIN families f2 ON f2.id = fl.b_id
    )
    SELECT :contrib_a, :contrib_b, 'family', a_id, b_id, conf, match_fields, surs FROM labeled
    UNION ALL
    SELECT :contrib_b, :contrib_a, 'family', b_id, a_id, conf, match_fields, surs FROM labeled
""")


def reclaim_orphaned_running(conn):
    """Reset orphaned 'running' jobs back to 'pending'.

    A crashed worker (OOM, container restart) leaves its claimed jobs stuck
    in 'running' forever — nothing ever picks them up again and matching for
    those pairs silently never completes. Resetting is only safe when no
    live compute backend exists, so this backs off if pg_stat_activity shows
    a session that is active (or holding a transaction) on the match tables.

    Also used by trigger_matches.py --resume. Returns (reclaimed, active):
    the number of jobs reset, and the number of live compute backends that
    prevented a reset (0 when none).
    """
    active = conn.execute(text("""
        SELECT COUNT(*) FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')
          AND (query LIKE '%INSERT INTO matches%'
               OR query LIKE '%sur_matches%'
               OR query LIKE '%DELETE FROM matches%')
    """)).scalar()
    if active:
        return 0, active
    n = conn.execute(
        text("UPDATE match_jobs SET status = 'pending' WHERE status = 'running'")
    ).rowcount
    return n, 0


def claim_jobs(batch_size=1):
    """Atomically claim pending pair jobs, biggest first.

    batch_size defaults to 1: pair jobs are long (seconds to minutes) next to
    the claim overhead, and larger batches starve workers in the common
    "one genealogist re-imported" case — 19 pending jobs with a batch of 10
    used to leave half the workers idle. One-at-a-time claiming also shrinks
    the crash-orphan window to a single job.

    Ordering is largest expected cost first (product of the two contributors'
    record counts — classic longest-processing-time scheduling): the long-pole
    pair starts immediately instead of landing on a lone worker at the end.
    """
    with engine.begin() as conn:
        rows = conn.execute(
            text("""
            UPDATE match_jobs SET status = 'running'
            WHERE (contributor_a, contributor_b) IN (
                SELECT j.contributor_a, j.contributor_b
                FROM match_jobs j
                LEFT JOIN contributors ca ON ca.name = j.contributor_a
                LEFT JOIN contributors cb ON cb.name = j.contributor_b
                WHERE j.status = 'pending'
                ORDER BY (COALESCE(ca.persons_count, 0) + COALESCE(ca.families_count, 0))::bigint
                       * (COALESCE(cb.persons_count, 0) + COALESCE(cb.families_count, 0))::bigint DESC,
                         j.queued_at, j.contributor_a, j.contributor_b
                FOR UPDATE OF j SKIP LOCKED
                LIMIT :batch_size
            )
            RETURNING contributor_a, contributor_b
        """),
            {"batch_size": batch_size},
        ).fetchall()
        return [(r[0], r[1]) for r in rows]


def process_job(contrib_a, contrib_b, pg_parallel=PG_PARALLEL_WORKERS):
    params = {
        "contrib_a": contrib_a,
        "contrib_b": contrib_b,
        "yr_tol": YEAR_TOLERANCE,
        "yr_tol_approx": YEAR_TOLERANCE_APPROX,
        "yr_extra": YEAR_EXTRA_APPROX,
        "coarse_yr_tol": COARSE_YEAR_TOLERANCE,
        "identity_conf": IDENTITY_KEY_CONFIDENCE,
        "identity_conf_full": IDENTITY_KEY_CONFIDENCE_FULL,
        "conf_min": CONFIDENCE_MIN,
        "trgm_thresh": TRGM_THRESHOLD,
        "alt_surname_penalty": ALT_SURNAME_PENALTY,
        "max_lifespan": MAX_LIFESPAN,
        "name_syn_score": NAME_SYNONYM_SCORE,
    }
    pair_label = f"{contrib_a}↔{contrib_b}"

    total = 0
    with engine.begin() as conn:
        # LOCAL: scoped to this job's transaction, so the pooled connection
        # doesn't carry a stale value into whatever borrows it next.
        conn.execute(text(f"SET LOCAL max_parallel_workers_per_gather = {pg_parallel}"))
        t_step = time.monotonic()
        deleted = conn.execute(
            text("""
            DELETE FROM matches
            WHERE (contributor_a = :contrib_a AND contributor_b = :contrib_b)
               OR (contributor_a = :contrib_b AND contributor_b = :contrib_a)
        """),
            params,
        ).rowcount
        if deleted:
            log.info(f"  [{pair_label}] removed {deleted} stale matches in {time.monotonic()-t_step:.1f}s")

        t_step = time.monotonic()
        conn.execute(
            text("""
            -- contributor_surnames holds each contributor's distinct folded
            -- surnames (own + alt, from persons and families), refreshed at
            -- import time and backed by a permanent GIN trigram index. Reusing
            -- it here avoids rebuilding that set + index from scratch for both
            -- sides on every pair job.
            -- Pure equijoins: the trigram similarity work already happened
            -- incrementally into surname_pairs (see main()), so a pair job
            -- does no similarity() calls for surname blocking at all.
            -- is_common comes from surname_freq (rebuilt by main() each run):
            -- OR because a rare trigram-variant of a common surname is almost
            -- always that common surname misspelled, so the pair should still
            -- face the stricter common-surname evidence bar.
            CREATE TEMP TABLE sur_matches ON COMMIT DROP AS
            SELECT a.sur AS sur1, b.sur AS sur2, sp.s_sur,
                   (COALESCE(fa.is_common, false) OR COALESCE(fb.is_common, false)) AS is_common
            FROM contributor_surnames a
            JOIN surname_pairs sp ON sp.sur1 = a.sur
            JOIN contributor_surnames b ON b.contributor = :contrib_b AND b.sur = sp.sur2
            LEFT JOIN surname_freq fa ON fa.sur = a.sur
            LEFT JOIN surname_freq fb ON fb.sur = b.sur
            WHERE a.contributor = :contrib_a;

            CREATE INDEX sur_matches_1 ON sur_matches(sur1);
            CREATE INDEX sur_matches_2 ON sur_matches(sur2);
            ANALYZE sur_matches;
        """),
            params,
        )
        log.info(f"  [{pair_label}] sur_matches ready in {time.monotonic()-t_step:.1f}s")

        for sql, label in (
            (_PERSON_INSERT, "person"),
            (_FAMILY_INSERT, "family"),
        ):
            t_step = time.monotonic()
            n = conn.execute(sql, params).rowcount
            log.info(
                f"  [{pair_label}] {label}: {n} matches in {time.monotonic()-t_step:.1f}s"
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


def worker(pg_parallel):
    """Claim and process pair jobs until none remain."""
    while True:
        jobs = claim_jobs()
        if not jobs:
            return
        for contrib_a, contrib_b in jobs:
            t0 = time.monotonic()
            log.info(f"Computing matches for: {contrib_a} ↔ {contrib_b}")
            try:
                process_job(contrib_a, contrib_b, pg_parallel=pg_parallel)
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
    # Recover jobs a crashed run left in 'running' before counting pending —
    # otherwise those pairs would be skipped forever.
    with engine.begin() as conn:
        reclaimed, _active = reclaim_orphaned_running(conn)
    if reclaimed:
        log.info(f"Reclaimed {reclaimed} orphaned 'running' job(s) from a previous run.")

    with engine.connect() as conn:
        pending_count = conn.execute(
            text("SELECT COUNT(*) FROM match_jobs WHERE status='pending'")
        ).scalar()

    if not pending_count:
        log.info("No pending match jobs.")
        return

    # Scale down per-query PG parallelism so total PG processes stay bounded.
    # With N Python workers each spawning K PG workers: N*(K+1) processes compete
    # for CPU and WAL bandwidth. Cap total at ~2× Python workers.
    pg_parallel = max(1, 8 // workers)
    if pg_parallel != PG_PARALLEL_WORKERS:
        log.info(f"Scaling PG parallel workers to {pg_parallel} (Python workers={workers})")

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

    # Precomputed match columns: seed name_synonyms and fill name_canon, the
    # date-qualifier codes, normalised full dates and list match-texts — once
    # per ROW here instead of once per candidate PAIR in the hot join. A
    # version stamp (synonym list + column schema version, kept in match_meta)
    # limits the full recompute to runs where either actually changed;
    # otherwise only rows from fresh imports are filled in (birth_q /
    # marriage_q double as the fill markers — never NULL once set).
    syn_rows = [
        {"variant": v, "canon": canon}
        for canon, variants in NAME_SYNONYM_GROUPS.items()
        for v in sorted(set(variants) | {canon})
    ]
    match_version = hashlib.sha1(
        repr((MATCH_COLUMN_SCHEMA_VERSION,
              sorted((r["variant"], r["canon"]) for r in syn_rows))).encode()
    ).hexdigest()[:12]
    persons_fill = (
        "UPDATE persons SET "
        "name_canon = name_canon_text(name_fold), "
        "birth_q = date_qualifier(date_of_birth), "
        "death_q = date_qualifier(date_of_death), "
        "birth_full_date = CASE WHEN has_day_precision(date_of_birth) THEN lower(trim(date_of_birth)) END, "
        "death_full_date = CASE WHEN has_day_precision(date_of_death) THEN lower(trim(date_of_death)) END, "
        "parents_match_text = list_match_text(parents_list), "
        "partners_match_text = list_match_text(partners_list)"
    )
    families_fill = (
        "UPDATE families SET "
        "husband_name_canon = name_canon_text(husband_name_fold), "
        "wife_name_canon = name_canon_text(wife_name_fold), "
        "marriage_q = date_qualifier(date_of_marriage), "
        "marriage_full_date = CASE WHEN has_day_precision(date_of_marriage) THEN lower(trim(date_of_marriage)) END, "
        "husband_parents_match_text = list_match_text(husband_parents), "
        "wife_parents_match_text = list_match_text(wife_parents), "
        "children_match_text = list_match_text(children_list)"
    )
    t_syn = time.monotonic()
    with engine.begin() as conn:
        conn.execute(_LIST_MATCH_TEXT_SQL)  # date_qualifier() + list_match_text()
        conn.execute(_NAME_CANON_SETUP_SQL)
        stored = conn.execute(
            text("SELECT value FROM match_meta WHERE key = 'name_synonyms_version'")
        ).scalar()
        if stored != match_version:
            log.info("Synonym list or column schema changed — recomputing all match columns...")
            conn.execute(text("DELETE FROM name_synonyms"))
            conn.execute(
                text("INSERT INTO name_synonyms (variant, canon) VALUES (:variant, :canon)"),
                syn_rows,
            )
            conn.execute(text(persons_fill))
            conn.execute(text(families_fill))
            conn.execute(
                text(
                    "INSERT INTO match_meta (key, value) VALUES ('name_synonyms_version', :v) "
                    "ON CONFLICT (key) DO UPDATE SET value = :v"
                ),
                {"v": match_version},
            )
        else:
            conn.execute(text(persons_fill + " WHERE name_canon IS NULL OR birth_q IS NULL"))
            conn.execute(text(
                families_fill + " WHERE husband_name_canon IS NULL OR marriage_q IS NULL"
            ))
    log.info(f"Precomputed match columns ready in {time.monotonic()-t_syn:.1f}s")

    log.info("Running ANALYZE for fresh planner statistics...")
    with engine.begin() as conn:
        conn.execute(text("ANALYZE persons"))
        conn.execute(text("ANALYZE families"))

    log.info("Refreshing surname frequency table...")
    t_freq = time.monotonic()
    with engine.begin() as conn:
        conn.execute(
            _SURNAME_FREQ_SQL,
            {"min_count": COMMON_SURNAME_MIN_COUNT, "share": COMMON_SURNAME_SHARE},
        )
        n_common = conn.execute(
            text("SELECT COUNT(*) FILTER (WHERE is_common), COUNT(*) FROM surname_freq")
        ).fetchone()
    log.info(
        f"  surname_freq ready in {time.monotonic()-t_freq:.1f}s "
        f"({n_common[0]} of {n_common[1]} surnames classified as common)"
    )

    # Incremental surname-pair maintenance: trigram-compare only surnames the
    # vocabulary has never seen (first run: all of them) against the full
    # vocabulary; per-job sur_matches then needs no similarity() at all.
    t_pairs = time.monotonic()
    with engine.begin() as conn:
        conn.execute(_SURNAME_PAIRS_DDL)
        stored_thresh = conn.execute(
            text("SELECT value FROM match_meta WHERE key = 'surname_pairs_threshold'")
        ).scalar()
        if stored_thresh != str(TRGM_THRESHOLD):
            if stored_thresh is not None:
                log.info("TRGM_THRESHOLD changed — rebuilding surname_pairs from scratch...")
            conn.execute(text("TRUNCATE surname_pairs, surname_vocab"))
            conn.execute(
                text(
                    "INSERT INTO match_meta (key, value) VALUES ('surname_pairs_threshold', :v) "
                    "ON CONFLICT (key) DO UPDATE SET value = :v"
                ),
                {"v": str(TRGM_THRESHOLD)},
            )
        conn.execute(text("""
            CREATE TEMP TABLE new_surs ON COMMIT DROP AS
            SELECT DISTINCT sur FROM contributor_surnames
            EXCEPT SELECT sur FROM surname_vocab
        """))
        n_new = conn.execute(text("SELECT COUNT(*) FROM new_surs")).scalar()
        if n_new:
            conn.execute(_SURNAME_PAIRS_INCREMENT_SQL)
            conn.execute(text("INSERT INTO surname_vocab SELECT sur FROM new_surs"))
            conn.execute(text("ANALYZE surname_pairs"))
        n_pairs = conn.execute(text("SELECT COUNT(*) FROM surname_pairs")).scalar()
    log.info(
        f"  surname_pairs ready in {time.monotonic()-t_pairs:.1f}s "
        f"({n_new} new surname(s), {n_pairs} pairs total)"
    )

    log.info(
        f"Processing {pending_count} pending pair(s) with {workers} worker(s) "
        f"(PG_PARALLEL_WORKERS={PG_PARALLEL_WORKERS}, WORK_MEM={WORK_MEM})..."
    )

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(worker, pg_parallel) for _ in range(workers)]
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
