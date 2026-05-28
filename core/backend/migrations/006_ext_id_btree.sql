-- Migration 006: partial composite btree indexes on (contributor, ext_id).
--
-- Hot path: the ancestors/descendants endpoints and find_parent_record now
-- prefer ext_id as the primary identifier. Every tree-traversal hop runs
--   WHERE contributor = ? AND ext_id   IN (...)   -- persons
--   WHERE contributor = ? AND husband_ext_id = ?  -- families (or wife)
-- Before this migration the planner only had the single-column
-- (contributor) btree, so each probe seq-scanned every row for the
-- contributor (tens of thousands for the largest contributors) and
-- filtered ext_id in memory.
--
-- The indexes are PARTIAL because legacy / matricula rows have empty
-- ext_id and shouldn't bloat the index — the planner falls back to the
-- (contributor) btree + name/year fallback path for those rows.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block.
-- Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/006_ext_id_btree.sql

\set ON_ERROR_STOP on
\timing on

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_person_contrib_ext
    ON persons (contributor, ext_id)
    WHERE ext_id IS NOT NULL AND ext_id <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contrib_husband_ext
    ON families (contributor, husband_ext_id)
    WHERE husband_ext_id IS NOT NULL AND husband_ext_id <> '';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_contrib_wife_ext
    ON families (contributor, wife_ext_id)
    WHERE wife_ext_id IS NOT NULL AND wife_ext_id <> '';

ANALYZE persons;
ANALYZE families;
