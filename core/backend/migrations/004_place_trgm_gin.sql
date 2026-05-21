-- Migration 004: GIN trigram indexes for the place columns used in search.
--
-- search_all / search_advanced_* filter places via ILIKE '%X%' and `%>`,
-- but the underlying columns had no trigram index, so every place search
-- seq-scanned the 1.9M-row persons table (and the families table for
-- marriage place). This adds GIN trgm indexes — same approach as
-- migration 003 for surname/name.
--
-- Only the columns that are actually searched are indexed
-- (place_of_baptism exists on persons but no endpoint filters on it).
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block, so
-- this file has no BEGIN/COMMIT. Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/004_place_trgm_gin.sql

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_place_of_birth_trgm_gin
    ON persons USING gin (place_of_birth gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_place_of_death_trgm_gin
    ON persons USING gin (place_of_death gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_place_of_marriage_trgm_gin
    ON families USING gin (place_of_marriage gin_trgm_ops);

ANALYZE persons;
ANALYZE families;
