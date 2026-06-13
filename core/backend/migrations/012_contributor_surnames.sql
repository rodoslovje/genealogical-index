-- 012_contributor_surnames.sql
--
-- Adds a per-contributor table of distinct folded surnames (own + alt, from
-- both persons and families), used by compute_matches.py to find candidate
-- surname pairs between two contributors.
--
-- Previously, every match job rebuilt this set from scratch for both sides
-- (a UNION/DISTINCT scan over persons+families plus a fresh GIST trigram
-- index), even though a contributor's surname set is identical across all
-- N-1 pairs it appears in. This table is computed once per contributor (at
-- import time going forward) and reused by every pair job via its
-- persistent GIN trigram index.
--
-- This migration only creates a new table + index and backfills it from
-- existing data — no locks on persons/families, safe to run online with the
-- API up.

BEGIN;

CREATE TABLE IF NOT EXISTS contributor_surnames (
    contributor TEXT NOT NULL,
    sur TEXT NOT NULL,
    PRIMARY KEY (contributor, sur)
);

CREATE INDEX IF NOT EXISTS idx_contributor_surnames_trgm
    ON contributor_surnames USING gin (sur gin_trgm_ops);

-- Backfill from current persons/families data.
INSERT INTO contributor_surnames (contributor, sur)
SELECT contributor, sur FROM (
    SELECT contributor, surname_fold AS sur FROM persons WHERE surname_fold <> ''
    UNION SELECT contributor, alt_surname_fold FROM persons WHERE alt_surname_fold <> ''
    UNION SELECT contributor, husband_surname_fold FROM families WHERE husband_surname_fold <> ''
    UNION SELECT contributor, husband_alt_surname_fold FROM families WHERE husband_alt_surname_fold <> ''
    UNION SELECT contributor, wife_surname_fold FROM families WHERE wife_surname_fold <> ''
    UNION SELECT contributor, wife_alt_surname_fold FROM families WHERE wife_alt_surname_fold <> ''
) s
ON CONFLICT DO NOTHING;

ANALYZE contributor_surnames;

COMMIT;
