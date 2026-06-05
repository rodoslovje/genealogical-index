-- Migration 008: composite btree index for tree-comparison match lookups.
--
-- The tree-comparison endpoint (/api/compare/ancestors) loads the precomputed
-- person matches between two genealogists to annotate aligned ancestor pairs
-- with their confidence:
--   SELECT record_a_id, record_b_id, confidence FROM matches
--   WHERE record_type='person'
--     AND contributor_a = ANY(...) AND contributor_b = ANY(...)
--
-- The existing single-column (contributor_a) / (contributor_b) btrees already
-- serve this, but a composite (contributor_a, contributor_b, record_type,
-- record_a_id) index lets the planner satisfy the whole predicate from the
-- index and return record_a_id pre-sorted, which keeps the lookup cheap as the
-- matches table grows.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block.
-- Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/008_matches_pair_lookup.sql

\set ON_ERROR_STOP on
\timing on

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_pair_lookup
    ON matches (contributor_a, contributor_b, record_type, record_a_id);

ANALYZE matches;
