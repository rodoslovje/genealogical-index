-- 017_matches_by_person.sql
--
-- Partial btree on matches(record_a_id) for person matches. Person search
-- with `same_as=true` looks up, for the ids on one result page, the records
-- in other contributors' data matched to each hit:
--   SELECT ... FROM matches WHERE record_type = 'person' AND record_a_id = ANY(...)
-- Every pair is stored in both directions, so record_a_id alone covers it.
-- The existing indexes all lead with contributor_a / contributor_b and can't
-- serve a lookup by record id without scanning a contributor's whole range.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block.
-- Re-runnable via IF NOT EXISTS.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/017_matches_by_person.sql

\set ON_ERROR_STOP on
\timing on

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_person_a
    ON matches (record_a_id) WHERE record_type = 'person';

ANALYZE matches;
