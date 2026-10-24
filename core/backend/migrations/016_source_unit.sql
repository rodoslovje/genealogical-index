-- 016_source_unit.sql
--
-- Adds `source_unit` to persons and families: the parish a Matricula record
-- was transcribed from, or the place of the cemetery a Geneanet record was indexed in.
-- Lets matches against those sources be grouped per parish / place rather
-- than per transcriber, which is how a genealogist reviews them — a family's
-- baptisms, marriages and deaths sit in one parish, its graves in one
-- place.
--
-- Only the column: the values come with the data. ged-tools' converters write
-- `source_unit` into the Matricula / Geneanet record JSON and import_to_db.py
-- copies it, so existing rows are filled when their contributor is next
-- re-imported.
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
