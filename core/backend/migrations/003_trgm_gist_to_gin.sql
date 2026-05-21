-- Migration 003: replace trigram GIST indexes with GIN.
--
-- Background: surname/name search uses pg_trgm operators (`%>`, ILIKE
-- '%X%'). Production EXPLAIN ANALYZE showed the GIST trgm index scan
-- alone taking ~8 seconds on a 1.9M-row persons table — even when the
-- planner picked the index. GIN trgm is typically 5–20x faster for
-- search-heavy workloads. The tradeoff is slower writes; our
-- persons/families tables are only written during import, so it's
-- the right tradeoff.
--
-- Also drops the partial WHERE on the alt_surname indexes — the
-- `IS NOT NULL AND <> ''` predicate confused the planner so it
-- seq-scanned for ILIKE queries. GIN naturally skips NULL rows and
-- empty-string rows produce no trigrams, so a non-partial index stays
-- tiny on sparse columns without needing the WHERE clause.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block, so
-- this file has no BEGIN/COMMIT — psql wraps each statement in its own
-- implicit tx. Re-running is safe (IF NOT EXISTS / IF EXISTS).
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/003_trgm_gist_to_gin.sql

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Build new GIN indexes alongside the existing GIST ones. CONCURRENTLY
--    means no table lock; reads and writes continue against the GIST
--    indexes during the build.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_name_trgm_gin
    ON persons USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_surname_trgm_gin
    ON persons USING gin (surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_alt_surname_trgm_gin
    ON persons USING gin (alt_surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_h_surname_trgm_gin
    ON families USING gin (husband_surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_w_surname_trgm_gin
    ON families USING gin (wife_surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_h_alt_surname_trgm_gin
    ON families USING gin (husband_alt_surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_w_alt_surname_trgm_gin
    ON families USING gin (wife_alt_surname gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_children_list_trgm_gin
    ON families USING gin ((children_list::text) gin_trgm_ops);

-- 2. Drop the old GIST indexes. Done after the GIN builds so there's
--    never a window where searches have no trgm index.
DROP INDEX CONCURRENTLY IF EXISTS idx_person_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_person_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_person_alt_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_family_h_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_family_w_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_family_h_alt_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_family_w_alt_surname_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_family_children_list_trgm;

-- 3. Refresh planner stats so it picks the new indexes immediately.
ANALYZE persons;
ANALYZE families;
