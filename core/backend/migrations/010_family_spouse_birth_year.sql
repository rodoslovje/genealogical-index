-- Migration 010: spouse birth-year columns on families for date search.
--
-- General search (`search_all`) lets a date-range query match a family on the
-- marriage date. This extends it to the husband's and wife's birth dates too
-- (parity with the persons branch, which matches birth/death/burial). The
-- families table already stores husband_birth / wife_birth as TEXT; this adds
-- the indexed SMALLINT year siblings (husband_birth_year / wife_birth_year)
-- that _date_filter uses to keep the range scan index-backed — without them the
-- OR'd birth conditions would seq-scan the table.
--
-- The year columns are populated by the same `\d{4}` regex import_to_db.py uses
-- at import time, so this back-fills existing rows once, in place.
--
-- ALTER TABLE ADD COLUMN (nullable) is a fast metadata-only change. CREATE INDEX
-- CONCURRENTLY can't run inside a transaction block, so this file has no
-- BEGIN/COMMIT. Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/010_family_spouse_birth_year.sql

\set ON_ERROR_STOP on
\timing on

ALTER TABLE families ADD COLUMN IF NOT EXISTS husband_birth_year SMALLINT;
ALTER TABLE families ADD COLUMN IF NOT EXISTS wife_birth_year     SMALLINT;

-- Back-fill from the existing TEXT date columns (only rows with a parseable
-- 4-digit year; everything else stays NULL and falls through to the
-- decade/century approximation branches in _date_filter).
UPDATE families
   SET husband_birth_year = CAST(SUBSTRING(husband_birth FROM '\d{4}') AS SMALLINT)
 WHERE husband_birth_year IS NULL AND husband_birth ~ '\d{4}';

UPDATE families
   SET wife_birth_year = CAST(SUBSTRING(wife_birth FROM '\d{4}') AS SMALLINT)
 WHERE wife_birth_year IS NULL AND wife_birth ~ '\d{4}';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_h_birth_year
    ON families (husband_birth_year);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_w_birth_year
    ON families (wife_birth_year);

ANALYZE families;
