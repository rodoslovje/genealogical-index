-- Normalize all TEXT and JSONB columns to NFC Unicode normalization form.
-- This prevents mismatches from clients/files using different forms (e.g. NFD).
--
-- IMPORTANT:
-- - This can take a long time on large databases. Run during a maintenance window.
-- - Back up your database before running.
-- - Must be run outside a transaction block.

\set ON_ERROR_STOP on

-- Function to recursively normalize string values within a JSONB object/array.
CREATE OR REPLACE FUNCTION jsonb_normalize_strings(p_jsonb jsonb)
RETURNS jsonb AS
$$
DECLARE
    v_type text := jsonb_typeof(p_jsonb);
    v_rec record;
    v_ret jsonb;
BEGIN
    IF v_type = 'object' THEN
        v_ret := '{}'::jsonb;
        FOR v_rec IN SELECT "key", "value" FROM jsonb_each(p_jsonb) LOOP
            v_ret := v_ret || jsonb_build_object(v_rec.key, jsonb_normalize_strings(v_rec.value));
        END LOOP;
        RETURN v_ret;
    ELSIF v_type = 'array' THEN
        RETURN (SELECT COALESCE(jsonb_agg(jsonb_normalize_strings(value)), '[]'::jsonb) FROM jsonb_array_elements(p_jsonb));
    ELSIF v_type = 'string' THEN
        RETURN to_jsonb(normalize(p_jsonb->>0, 'NFC'));
    ELSE
        RETURN p_jsonb;
    END IF;
END;
$$
LANGUAGE 'plpgsql' IMMUTABLE;

-- Normalize TEXT columns
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE 'Normalizing TEXT columns...';
    FOR r IN (SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'text') LOOP
        EXECUTE format('UPDATE %I SET %I = normalize(%I, ''NFC'') WHERE %I IS NOT NULL AND %I != normalize(%I, ''NFC'')',
                       r.table_name, r.column_name, r.column_name, r.column_name, r.column_name, r.column_name);
    END LOOP;
END $$;

-- Normalize JSONB columns
DO $$
DECLARE
    r RECORD;
BEGIN
    RAISE NOTICE 'Normalizing JSONB columns...';
    FOR r IN (SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'jsonb') LOOP
        EXECUTE format('UPDATE %I SET %I = jsonb_normalize_strings(%I) WHERE %I IS NOT NULL',
                       r.table_name, r.column_name, r.column_name, r.column_name);
    END LOOP;
END $$;

DROP FUNCTION jsonb_normalize_strings(jsonb);

RAISE NOTICE 'Unicode normalization complete.';