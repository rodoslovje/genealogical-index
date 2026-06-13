-- 011_name_fold_and_match_helpers.sql
--
-- Adds diacritic-/case-folded generated columns for name & surname fields,
-- plus two SQL helper functions used by compute_matches.py:
--
--  - fold_text(text): lower-cased, accent-stripped form used for trigram
--    blocking and similarity, so e.g. "Žagar" / "Zagar" / "ZAGAR" are
--    treated as the same surname across contributors.
--  - is_approx_date(text): true when a GEDCOM date string carries an
--    approximation qualifier (ABT/EST/CAL/BEF/AFT/CIRCA/~). compute_matches
--    widens its year-tolerance for such dates, since they're often
--    back-derived from a relative's birth/death and can be off by a decade
--    or more.
--
-- ADD COLUMN ... GENERATED ALWAYS AS (...) STORED rewrites the whole table
-- (AccessExclusiveLock), same cost profile as migration 001. For ~4M rows,
-- budget 5-15 min per table. Run during a maintenance window with the API
-- stopped (so it can't see a half-migrated state).
--
-- Both import_to_db.py paths (setup_full / setup_update) already create
-- these for fresh DBs — this file is only for upgrading an existing
-- production DB in place.
--
--   docker compose stop api
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--       < core/backend/migrations/011_name_fold_and_match_helpers.sql
--   docker compose up -d api
--
-- Re-running is a no-op (IF NOT EXISTS everywhere). CREATE INDEX
-- CONCURRENTLY steps run online and must not be wrapped in BEGIN/COMMIT —
-- piping this file through psql stdin (as above) keeps each statement in
-- its own implicit transaction.

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION fold_text(t text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT lower(unaccent('unaccent', COALESCE(t, ''))) $$;

CREATE OR REPLACE FUNCTION is_approx_date(d text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT COALESCE(d, '') ~* '\y(ABT|ABOUT|EST|ESTIMATED|CAL|CALC|CALCULATED|BEF|BEFORE|AFT|AFTER|CIRCA|CA)\y|~' $$;

-- Folded surname/given-name columns for persons.
-- All three are added in a single ALTER TABLE so the (unavoidable) table
-- rewrite happens once, not once per column.
ALTER TABLE persons
    ADD COLUMN IF NOT EXISTS surname_fold     TEXT GENERATED ALWAYS AS (fold_text(surname))     STORED,
    ADD COLUMN IF NOT EXISTS alt_surname_fold TEXT GENERATED ALWAYS AS (fold_text(alt_surname)) STORED,
    ADD COLUMN IF NOT EXISTS name_fold        TEXT GENERATED ALWAYS AS (fold_text(name))        STORED;

-- Folded surname/given-name columns for families (husband & wife sides),
-- likewise combined into a single ALTER TABLE / rewrite.
ALTER TABLE families
    ADD COLUMN IF NOT EXISTS husband_surname_fold     TEXT GENERATED ALWAYS AS (fold_text(husband_surname))     STORED,
    ADD COLUMN IF NOT EXISTS husband_alt_surname_fold TEXT GENERATED ALWAYS AS (fold_text(husband_alt_surname)) STORED,
    ADD COLUMN IF NOT EXISTS husband_name_fold        TEXT GENERATED ALWAYS AS (fold_text(husband_name))        STORED,
    ADD COLUMN IF NOT EXISTS wife_surname_fold        TEXT GENERATED ALWAYS AS (fold_text(wife_surname))        STORED,
    ADD COLUMN IF NOT EXISTS wife_alt_surname_fold    TEXT GENERATED ALWAYS AS (fold_text(wife_alt_surname))    STORED,
    ADD COLUMN IF NOT EXISTS wife_name_fold           TEXT GENERATED ALWAYS AS (fold_text(wife_name))           STORED;

-- Folded-surname equivalents of idx_*_contrib_*_sur, used by compute_matches
-- to build its a_sur/b_sur candidate-surname pools diacritic-insensitively.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_contrib_sur_fold
    ON persons(contributor, surname_fold);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_contrib_alt_sur_fold
    ON persons(contributor, alt_surname_fold) WHERE alt_surname_fold <> '';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contrib_surs_fold
    ON families(contributor, husband_surname_fold, wife_surname_fold);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contrib_h_alt_sur_fold
    ON families(contributor, husband_alt_surname_fold) WHERE husband_alt_surname_fold <> '';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contrib_w_alt_sur_fold
    ON families(contributor, wife_alt_surname_fold) WHERE wife_alt_surname_fold <> '';

ANALYZE persons;
ANALYZE families;
