-- 016_source_unit.sql
--
-- Adds `source_unit` to persons and families: the parish a Matricula record
-- was transcribed from, or the place of the cemetery a Geneanet record was indexed in.
-- Lets matches against those sources be grouped per parish / place rather
-- than per transcriber, which is how a genealogist reviews them — a family's
-- baptisms, marriages and deaths sit in one parish, its graves in one
-- place.
--
-- Also adds matricula_book_key(url), which reduces a Matricula page link and
-- a book's own URL to the same country/diocese/parish/book key.
--
-- Only the column and the function: the values are filled by
-- import_to_db.py's assign_source_units(), which runs on every import;
-- `import_to_db.py --source-units-only` straight after this backfills them
-- from the data already in the DB, without re-importing anything.
-- Run this before deploying the API code, whose ORM models expect the column.
--
-- ADD COLUMN (nullable, no default) is metadata-only — no table rewrite, safe
-- online. Re-runnable.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/016_source_unit.sql

\set ON_ERROR_STOP on

ALTER TABLE persons  ADD COLUMN IF NOT EXISTS source_unit TEXT;
ALTER TABLE families ADD COLUMN IF NOT EXISTS source_unit TEXT;

CREATE OR REPLACE FUNCTION matricula_book_key(url text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT rtrim(substring(url FROM 'matricula-online\.eu/[^/]+/([^?#]+)'), '/') $$;
