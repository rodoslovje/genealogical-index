-- Migration 002: add GIST trigram indexes for the alt_surname columns.
--
-- Background: surname search uses `surname ILIKE / %> X` OR'd with the same
-- predicate on alt_surname. The surname side has a gist_trgm_ops index; the
-- alt_surname side did not, so the planner had to seq-scan the whole table
-- on every surname search. With these three partial indexes the OR becomes
-- a BitmapOr of two index scans.
--
-- Indexes are partial (alt_surname column is sparsely populated) so total
-- size stays small.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block, so this
-- file does NOT use BEGIN/COMMIT — psql runs each statement in its own
-- implicit transaction. Re-running is safe (IF NOT EXISTS).
--
-- Usage:
--   docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB \
--     < core/backend/migrations/002_alt_surname_trgm.sql

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_alt_surname_trgm
    ON persons USING gist (alt_surname gist_trgm_ops)
    WHERE alt_surname IS NOT NULL AND alt_surname <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_h_alt_surname_trgm
    ON families USING gist (husband_alt_surname gist_trgm_ops)
    WHERE husband_alt_surname IS NOT NULL AND husband_alt_surname <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_w_alt_surname_trgm
    ON families USING gist (wife_alt_surname gist_trgm_ops)
    WHERE wife_alt_surname IS NOT NULL AND wife_alt_surname <> '';

ANALYZE persons;
ANALYZE families;
