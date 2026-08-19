-- 015_match_surnames.sql
--
-- Adds `matches.surnames` — the folded surnames a match pair carries, from
-- both sides — plus its GIN index, and backfills it from persons/families.
--
-- Powers the "surname in matches" filter on a genealogist's page: with 100+
-- matched genealogists, the question "who matches me on Pezdirc?" previously
-- had no answer short of opening every pair. Answering it by joining
-- `matches` back to persons/families per request means a join over the whole
-- match set on every query; a denormalized array + GIN index turns it into a
-- plain indexed scan, and compute_matches.py fills the column going forward.
--
-- Both sides' surnames are stored because trigram matching pairs records that
-- spell the surname differently (Pezdirc/Pezdirec) — searching either
-- spelling should find the pair.
--
-- CREATE INDEX CONCURRENTLY can't run inside a transaction block, so the
-- ALTER and backfill are separate statements rather than one BEGIN/COMMIT.
-- Re-runnable via IF NOT EXISTS + the `surnames IS NULL` backfill predicate.
--
-- The backfill rewrites every match row: on a large matches table expect it
-- to take a while and to roughly double the table's disk footprint until the
-- next VACUUM. It's an UPDATE, so readers are never blocked — the API can
-- stay up, it just sees NULL (= "no surname recorded", excluded from a
-- surname-filtered result) for rows not yet reached.
--
-- Usage:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < core/backend/migrations/015_match_surnames.sql

\set ON_ERROR_STOP on
\timing on

ALTER TABLE matches ADD COLUMN IF NOT EXISTS surnames TEXT[];

-- Backfill person matches from both sides' folded surname + alt_surname.
UPDATE matches m
SET surnames = ARRAY(
        SELECT DISTINCT s FROM unnest(ARRAY[
            p1.surname_fold, p1.alt_surname_fold,
            p2.surname_fold, p2.alt_surname_fold
        ]) AS s WHERE s IS NOT NULL AND s <> ''
    )
FROM persons p1, persons p2
WHERE m.record_type = 'person'
  AND m.surnames IS NULL
  AND p1.id = m.record_a_id
  AND p2.id = m.record_b_id;

-- Backfill family matches from both spouses on both sides.
UPDATE matches m
SET surnames = ARRAY(
        SELECT DISTINCT s FROM unnest(ARRAY[
            f1.husband_surname_fold, f1.husband_alt_surname_fold,
            f1.wife_surname_fold,    f1.wife_alt_surname_fold,
            f2.husband_surname_fold, f2.husband_alt_surname_fold,
            f2.wife_surname_fold,    f2.wife_alt_surname_fold
        ]) AS s WHERE s IS NOT NULL AND s <> ''
    )
FROM families f1, families f2
WHERE m.record_type = 'family'
  AND m.surnames IS NULL
  AND f1.id = m.record_a_id
  AND f2.id = m.record_b_id;

-- Array containment (`surnames && ARRAY[...]`) — the operator the
-- surname-filtered matches query uses.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_matches_surnames
    ON matches USING gin (surnames);

ANALYZE matches;
