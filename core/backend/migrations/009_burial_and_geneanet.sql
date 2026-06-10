-- Migration 009: burial fields on persons + geneanet_cemeteries index table.
--
-- New data source (Geneanet cemeteries) adds a burial { date, place } block to
-- person records, so persons gains date_of_burial / burial_year / place_of_burial
-- (parity with birth/death) plus a GIN trgm index so place-of-burial search is
-- index-fast. It also introduces a standalone cemeteries index (flat list with
-- geo coordinates) powering the `?t=geneanet` page — stored in geneanet_cemeteries.
--
-- ALTER TABLE ADD COLUMN (nullable) is a fast metadata-only change. CREATE INDEX
-- CONCURRENTLY can't run inside a transaction block, so this file has no
-- BEGIN/COMMIT. Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/009_burial_and_geneanet.sql

\set ON_ERROR_STOP on
\timing on

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE persons ADD COLUMN IF NOT EXISTS date_of_burial  TEXT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS burial_year     SMALLINT;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS place_of_burial TEXT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_place_of_burial_trgm
    ON persons USING gin (place_of_burial gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_burial_year
    ON persons (burial_year);

CREATE TABLE IF NOT EXISTS geneanet_cemeteries (
    id SERIAL PRIMARY KEY,
    name TEXT,
    place TEXT,
    type TEXT,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    persons_count INTEGER DEFAULT 0,
    families_count INTEGER DEFAULT 0,
    graves_count INTEGER DEFAULT 0,
    url TEXT
);

ANALYZE persons;
