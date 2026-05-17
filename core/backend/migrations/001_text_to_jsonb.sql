-- Migration 001: convert the 7 JSON-bearing TEXT columns to JSONB.
--
-- Run this once during a planned maintenance window (the ALTER TABLE
-- statements hold AccessExclusiveLock on each table while the rewrite
-- runs). For ~4M rows expect 5-15 minutes total on commodity hardware.
--
-- The script is idempotent: re-running after success is a no-op because
-- every step checks current state before acting.
--
-- Usage:
--   docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB \
--       -f /docker-entrypoint-initdb.d/001_text_to_jsonb.sql
-- or just paste into psql.

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- 1. Drop the existing trgm index on children_list (it's bound to the TEXT
--    column type — Postgres won't let us flip the type while it exists).
DROP INDEX IF EXISTS idx_family_children_list_trgm;

-- 2. Convert each column. NULLIF turns the legacy empty-string sentinel
--    into NULL so '' doesn't fail the ::jsonb cast. The new GIN-friendly
--    binary format also normalises key order, which makes pg_trgm
--    similarity() comparisons more accurate downstream.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT t, col FROM (VALUES
      ('persons',  'parents_list'),
      ('persons',  'partners_list'),
      ('persons',  'links'),
      ('families', 'children_list'),
      ('families', 'husband_parents'),
      ('families', 'wife_parents'),
      ('families', 'links')
    ) AS x(t, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = c.t
        AND column_name = c.col
        AND data_type = 'text'
    ) THEN
      RAISE NOTICE 'Converting %.% TEXT -> JSONB ...', c.t, c.col;
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE jsonb USING NULLIF(%I, '''')::jsonb',
        c.t, c.col, c.col
      );
    ELSE
      RAISE NOTICE 'Skipping %.% (already %)',
        c.t, c.col,
        (SELECT data_type FROM information_schema.columns
          WHERE table_name = c.t AND column_name = c.col);
    END IF;
  END LOOP;
END $$;

-- 3. Rebuild the trgm index as an expression index over the JSONB column's
--    text serialization. The search code casts children_list::text, so
--    this expression matches and stays index-fast.
CREATE INDEX IF NOT EXISTS idx_family_children_list_trgm
  ON families USING gist ((children_list::text) gist_trgm_ops);

-- 4. Helper used by compute_matches: strips the per-file GEDCOM xref `id`
--    from each element of a JSONB array. Without this, parents_list /
--    partners_list / children_list comparisons across contributors would
--    never match (different source files use different xrefs).
CREATE OR REPLACE FUNCTION list_for_match(arr jsonb) RETURNS jsonb AS $$
  SELECT CASE
    WHEN arr IS NULL THEN NULL
    WHEN jsonb_typeof(arr) = 'array' THEN COALESCE(
      (SELECT jsonb_agg(
        CASE WHEN jsonb_typeof(elem) = 'object' THEN elem - 'id'
             ELSE elem END
        ORDER BY ord)
       FROM jsonb_array_elements(arr) WITH ORDINALITY AS t(elem, ord)),
      '[]'::jsonb
    )
    ELSE arr
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

COMMIT;

-- 4. Update planner statistics for the new column types so subsequent
--    queries get good plans immediately.
ANALYZE persons;
ANALYZE families;
