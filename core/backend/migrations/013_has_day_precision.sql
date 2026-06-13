-- 013_has_day_precision.sql
--
-- Adds has_day_precision(text), a SQL helper used by compute_matches.py to
-- detect a full "DD MON YYYY"-style date (as opposed to a bare year or
-- month+year). Used to give an exact full-date match (e.g. both sides record
-- "20 NOV 1892") a stronger confidence bonus than a year-only coincidence
-- (both sides only know "1892").
--
-- Plain CREATE OR REPLACE FUNCTION — no locks, instant, safe to run online
-- with the API up. Re-runnable.

CREATE OR REPLACE FUNCTION has_day_precision(d text) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT COALESCE(d, '') ~* '\d{1,2}\s+[a-z]{3,9}\s+\d{4}' $$;
