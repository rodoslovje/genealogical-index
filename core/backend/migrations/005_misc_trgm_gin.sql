-- Migration 005: GIN trigram indexes for the remaining columns that
-- search_all / search_advanced_* filter via ILIKE / `%>` but had only
-- btree indexes (or none) before.
--
-- Audited from crud.py — these are the columns where the search code
-- calls _text_filter() with no matching trgm index:
--   persons.contributor
--   families.contributor
--   families.husband_name
--   families.wife_name
--
-- Without these, fuzzy/substring searches on those fields seq-scan
-- the table. Same pattern as migrations 003 and 004.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block.
-- Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/005_misc_trgm_gin.sql

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_contributor_trgm_gin
    ON persons USING gin (contributor gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contributor_trgm_gin
    ON families USING gin (contributor gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_h_name_trgm_gin
    ON families USING gin (husband_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_w_name_trgm_gin
    ON families USING gin (wife_name gin_trgm_ops);

ANALYZE persons;
ANALYZE families;
