#!/usr/bin/env python3
"""Audit the stored cross-contributor matches without recomputing them.

Phase 0 of the matching-precision work: every stored match carries its score
components in `match_fields`, so candidate precision rules can be evaluated
against the live `matches` table in one read-only pass — minutes, versus the
hours a full recompute takes. Nothing is modified; the script only creates
session-local TEMP tables.

It reports, per rule, how many match pairs the rule would remove, the
combined effect, the confidence distribution before and after, how much
*agreeing* evidence the surviving matches carry, and how many partners a
single record tends to have inside one other tree (fan-out). It also writes
a stratified random sample to CSV for hand labelling, so the precision of
the kept and of the dropped side can both be measured before any rule goes
live.

Rules evaluated (see the plan in the matching review; grouping in
PERSON_RULES / FAMILY_RULES):
  Phase 1 — hard gates
    sex        both sexes recorded and different
    parents    both parents lists named, similarity < CONTRADICT
    one2one    the pair is neither side's best (within ONE2ONE_SLACK) inside
               the other tree, and confidence < ONE2ONE_SAFE
    death      both death years known and further apart than the tolerance
               (the compute gate only needs birth OR death to fit), unless a
               full birth/death date agrees
    fulldate   day-precise birth or death dates on both sides that differ
               (a day+month-equal one-year slip does not count), with no
               full date agreeing, no agreeing spouse, and agreeing parents
               only excusing a same-year difference
    regmarried a GEDCOM person matched a register (baptism) entry only
               through her alternate surname
    regparents parents similarity below REG_PARENTS_CONTRADICT against a
               register entry, which always names both parents
    generation one record's parent is the other's spouse (father/son with
               the same name)
    nn         a placeholder given name (NN) scored as an exact name match
    childdeath one side died aged 12 or less, the other has a spouse
    cemcem     two cemetery indexes that do not agree exactly on birth year
               and (if present) death year
    cemdeath   a cemetery side whose plain death year is 2+ off the other's
    cemreg     cemetery vs register index without an agreeing full birth date
  Phase 2 — evidence must *agree*, not merely be present
    agree      no corroborating field agrees (AGREE / YEAR_AGREE); parents or
               partners agreement or a full date always satisfies it, a
               single place/year agreement needs a second one for common
               surnames
    plain2     two unqualified birth years two or more apart
    plain1     unqualified birth AND death years that both differ
  Info only — counted, but not part of the combined verdict
    bplace     birth places contradict (too many false hits until places
               are normalised)
    neutral    confidence rescored with missing always-counted fields at
               NEUTRAL_NEW instead of 0.5 falls below CONFIDENCE_MIN (cost
               true spouse-only matches in the second sample)
    family names/one2one/parents/children/place/agree/neutral — the
               labelled samples showed they remove true matches

Usage (inside the api container, from /app):
    python tools/audit_matches.py                       # report + 200-row sample
    python tools/audit_matches.py --sample 400 --band 0.80 0.90
    python tools/audit_matches.py --no-sample
    python tools/audit_matches.py --score data/output/match_audit_sample.csv
"""

import argparse
import csv
import os
import sys
import time

from sqlalchemy import create_engine, text

try:
    from dotenv import load_dotenv
except ImportError:
    pass

try:
    load_dotenv("../.env")
except Exception:
    pass

if os.getenv("POSTGRES_USER") and os.getenv("POSTGRES_DB"):
    import urllib.parse

    _db_host = os.getenv(
        "POSTGRES_HOST", "db" if os.path.exists("/.dockerenv") else "localhost"
    )
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{urllib.parse.quote(os.getenv('POSTGRES_PASSWORD', ''))}@{_db_host}:5432/{os.getenv('POSTGRES_DB')}"
else:
    DATABASE_URL = os.getenv("DATABASE_URL")


# --- rule thresholds (candidates; tune after labelling the sample) ---
CONFIDENCE_MIN = 0.80  # must equal compute_matches.CONFIDENCE_MIN
CONTRADICT = 0.30  # a recorded-on-both-sides field below this contradicts
AGREE = 0.70  # ...and at or above this corroborates
PARTNER_AGREE = 0.60  # spouse names are short and typo-prone ('jurij'/'jirij'
# kozjek scored 0.625 for the same man), so partners corroborate a little lower
YEAR_AGREE = 2  # max year difference that still counts as agreeing
ONE2ONE_SLACK = 0.02  # a match this close to a record's best partner is kept
ONE2ONE_SAFE = 0.95  # ...and so is any match at or above this confidence
NEUTRAL_NEW = 0.25  # candidate replacement for the 0.5 missing-field credit
REG_PARENTS_CONTRADICT = 0.50  # a register index always names both parents,
# so a weaker parents similarity than this against one is a real disagreement
# (the general CONTRADICT is lower because GEDCOM parent lists can be partial)
IDENTITY_KEY_CONFIDENCE = 0.97  # floors — must mirror compute_matches
IDENTITY_KEY_CONFIDENCE_FULL = 0.99
YEAR_TOLERANCE = 5
YEAR_TOLERANCE_APPROX = 15
WORK_MEM = "512MB"

BANDS = [(0.80, 0.85), (0.85, 0.90), (0.90, 0.95), (0.95, 1.01)]

def log(msg):
    print(msg, flush=True)


def _tol(q1, q2):
    """SQL for the score-decay tolerance of a year field, from the two sides'
    precomputed date-qualifier codes (NULL when never filled → plain)."""
    return (
        f"GREATEST(CASE WHEN COALESCE({q1},0) <> 0 THEN {YEAR_TOLERANCE_APPROX} ELSE {YEAR_TOLERANCE} END,"
        f"         CASE WHEN COALESCE({q2},0) <> 0 THEN {YEAR_TOLERANCE_APPROX} ELSE {YEAR_TOLERANCE} END)"
    )


# Source type from the contributor-name suffix (see crud.SPECIAL_SUFFIXES):
#   ged  a GEDCOM family tree — full relationship model, places, dates
#   cem  -geneanet: a cemetery index — exact birth/death years (sometimes
#        full dates), a woman's birth OR married surname with no way to
#        tell which, no places, parents or marriages
#   reg  -matricula: an index of whole parish birth and marriage books —
#        full birth date, place, parents; no death, no spouse on persons;
#        siblings with a reused name are separate records
#   mil  -military: personnel rolls — name-centred, birth data thin
def _SRC_TYPE(col):
    return (f"CASE WHEN {col} LIKE '%-geneanet' THEN 'cem' "
            f"WHEN {col} LIKE '%-matricula' THEN 'reg' "
            f"WHEN {col} LIKE '%-military' THEN 'mil' ELSE 'ged' END")


# One row per (contributor_a, contributor_b, record_type, record_a_id): the
# record's best confidence inside that partner tree, and how many partners it
# has there. Both match directions are stored, so a single window pass gives
# "best for A inside B" and "best for B inside A" alike.
_BEST_SQL = text("""
    CREATE TEMP TABLE best AS
    SELECT contributor_a, contributor_b, record_type, record_a_id,
           MAX(confidence) AS best_conf, COUNT(*) AS n
    FROM matches
    GROUP BY 1, 2, 3, 4;
    CREATE INDEX best_idx ON best (record_type, contributor_a, contributor_b, record_a_id);
    ANALYZE best;
""")

_PERSON_SQL = text(f"""
    CREATE TEMP TABLE ap AS
    WITH m AS (
        SELECT id, contributor_a, contributor_b, record_a_id, record_b_id, confidence,
               match_fields::jsonb AS f
        FROM matches
        WHERE record_type = 'person' AND record_a_id < record_b_id
    ),
    x AS (
        SELECT m.id, m.contributor_a, m.contributor_b, m.record_a_id, m.record_b_id,
               m.confidence AS conf,
               (f->>'surname')::float AS s_sur,
               (f->>'name')::float AS s_name,
               (f->>'birth_place')::float AS s_bplace,
               (f->>'death_place')::float AS s_dplace,
               (f->>'birth_year_diff')::int AS byd,
               (f->>'death_year_diff')::int AS dyd,
               (f->>'parents')::float AS s_par,
               (f->>'partners')::float AS s_part,
               lower(left(p1.sex, 1)) AS sex_a, lower(left(p2.sex, 1)) AS sex_b,
               {_SRC_TYPE('m.contributor_a')} AS type_a,
               {_SRC_TYPE('m.contributor_b')} AS type_b,
               COALESCE(p1.birth_full_date = p2.birth_full_date, false) AS full_birth,
               COALESCE(p1.death_full_date = p2.death_full_date, false) AS full_death,
               -- Both sides day-precise but NOT the same date: a stronger
               -- contradiction than a year difference.
               COALESCE(p1.birth_full_date <> p2.birth_full_date, false) AS full_birth_differs,
               COALESCE(p1.death_full_date <> p2.death_full_date, false) AS full_death_differs,
               -- Same day and month, year off by one: a copying slip, not a
               -- contradiction (normalised dates look like '8 sep 1877').
               COALESCE(p1.birth_full_date <> p2.birth_full_date
                        AND split_part(p1.birth_full_date, ' ', 1) = split_part(p2.birth_full_date, ' ', 1)
                        AND split_part(p1.birth_full_date, ' ', 2) = split_part(p2.birth_full_date, ' ', 2)
                        AND ABS(p1.birth_year - p2.birth_year) = 1, false) AS birth_slip,
               COALESCE(p1.death_full_date <> p2.death_full_date
                        AND split_part(p1.death_full_date, ' ', 1) = split_part(p2.death_full_date, ' ', 1)
                        AND split_part(p1.death_full_date, ' ', 2) = split_part(p2.death_full_date, ' ', 2)
                        AND ABS(p1.death_year - p2.death_year) = 1, false) AS death_slip,
               -- A register (baptism) entry always carries the BIRTH surname,
               -- so a GEDCOM person who matched it only through her
               -- alternate surname was born under a different name.
               (({_SRC_TYPE('m.contributor_a')} = 'reg' AND p2.surname_fold <> p1.surname_fold
                 AND p2.alt_surname_fold <> '' AND p2.alt_surname_fold = p1.surname_fold)
                OR ({_SRC_TYPE('m.contributor_b')} = 'reg' AND p1.surname_fold <> p2.surname_fold
                 AND p1.alt_surname_fold <> '' AND p1.alt_surname_fold = p2.surname_fold)) AS reg_married,
               (COALESCE(p1.birth_q, 0) = 0 AND COALESCE(p2.birth_q, 0) = 0) AS plain_birth,
               (COALESCE(p1.death_q, 0) = 0 AND COALESCE(p2.death_q, 0) = 0) AS plain_death,
               -- One side died as a child (both years on that side) while the
               -- other side has a recorded spouse: a name reused for a later
               -- sibling, or an unrelated adult.
               ((p1.death_year - p1.birth_year BETWEEN 0 AND 12 AND p2.partners_match_text IS NOT NULL)
                OR (p2.death_year - p2.birth_year BETWEEN 0 AND 12 AND p1.partners_match_text IS NOT NULL)) AS child_vs_married,
               -- Placeholder given names ("NN") currently score as an exact
               -- name match.
               (p1.name_fold ~ '^(nn|n\\.\\s?n\\.|n n|unknown|neznan[oai]?|\\?)$'
                OR p2.name_fold ~ '^(nn|n\\.\\s?n\\.|n n|unknown|neznan[oai]?|\\?)$'
                -- A placeholder surname only counts when there is no
                -- alternate surname that could have carried the match.
                OR (p1.surname_fold ~ '^(nn|n\\.\\s?n\\.|n n|unknown|neznan[oai]?|\\?)$' AND p1.alt_surname_fold = '')
                OR (p2.surname_fold ~ '^(nn|n\\.\\s?n\\.|n n|unknown|neznan[oai]?|\\?)$' AND p2.alt_surname_fold = '')) AS nn_name,
               -- Generation slip: one record's parent is the other record's
               -- spouse (same-name father/son, mother/daughter). Only full
               -- "given surname" entries count; a lone token is too vague.
               (EXISTS (SELECT 1 FROM unnest(string_to_array(p1.parents_match_text, '; ')) x
                        WHERE x LIKE '% %' AND x NOT LIKE 'nn %'
                          AND x = ANY(string_to_array(p2.partners_match_text, '; ')))
                OR EXISTS (SELECT 1 FROM unnest(string_to_array(p2.parents_match_text, '; ')) x
                        WHERE x LIKE '% %' AND x NOT LIKE 'nn %'
                          AND x = ANY(string_to_array(p1.partners_match_text, '; ')))) AS generation_slip,
               {_tol('p1.birth_q', 'p2.birth_q')} AS b_tol,
               {_tol('p1.death_q', 'p2.death_q')} AS d_tol,
               COALESCE(fa.is_common, false) OR COALESCE(fb.is_common, false) AS common_sur,
               ba.best_conf AS best_a, ba.n AS n_a,
               bb.best_conf AS best_b, bb.n AS n_b
        FROM m
        JOIN persons p1 ON p1.id = m.record_a_id
        JOIN persons p2 ON p2.id = m.record_b_id
        JOIN best ba ON ba.record_type = 'person' AND ba.contributor_a = m.contributor_a
                     AND ba.contributor_b = m.contributor_b AND ba.record_a_id = m.record_a_id
        JOIN best bb ON bb.record_type = 'person' AND bb.contributor_a = m.contributor_b
                     AND bb.contributor_b = m.contributor_a AND bb.record_a_id = m.record_b_id
        LEFT JOIN surname_freq fa ON fa.sur = p1.surname_fold
        LEFT JOIN surname_freq fb ON fb.sur = p2.surname_fold
    ),
    y AS (
        SELECT *,
               LEAST(type_a, type_b) || '-' || GREATEST(type_a, type_b) AS pair_class,
               (type_a = 'cem' OR type_b = 'cem') AS has_cem,
               (type_a = 'mil' OR type_b = 'mil') AS has_mil,
               (type_a = 'reg' OR type_b = 'reg') AS has_reg,
               COALESCE((s_bplace >= {AGREE})::int, 0) + COALESCE((s_dplace >= {AGREE})::int, 0)
             + COALESCE((byd <= {YEAR_AGREE})::int, 0) + COALESCE((dyd <= {YEAR_AGREE})::int, 0)
             + COALESCE((s_par >= {AGREE})::int, 0) + COALESCE((s_part >= {PARTNER_AGREE})::int, 0) AS evidence,
               (
                   s_sur * 35.0 + s_name * 30.0
                 + COALESCE(s_bplace, {NEUTRAL_NEW}) * 10.0
                 + COALESCE(GREATEST(0.0, 1.0 - byd::float / b_tol), {NEUTRAL_NEW}) * 15.0
                 + COALESCE(s_dplace, 0.0) * 10.0
                 + COALESCE(GREATEST(0.0, 1.0 - dyd::float / d_tol), 0.0) * 10.0
                 + COALESCE(s_par, 0.0) * 20.0
                 + COALESCE(s_part, 0.0) * 15.0
               ) / (
                   90.0 + CASE WHEN s_dplace IS NOT NULL THEN 10.0 ELSE 0.0 END
                        + CASE WHEN dyd      IS NOT NULL THEN 10.0 ELSE 0.0 END
                        + CASE WHEN s_par    IS NOT NULL THEN 20.0 ELSE 0.0 END
                        + CASE WHEN s_part   IS NOT NULL THEN 15.0 ELSE 0.0 END
               ) AS base2
        FROM x
    ),
    z AS (
        SELECT *,
           -- Phase 1 gates
           COALESCE(sex_a IN ('m','f') AND sex_b IN ('m','f') AND sex_a <> sex_b, false) AS r_sex,
           COALESCE(s_par < {CONTRADICT}, false) AS r_parents,
           COALESCE(s_bplace < {CONTRADICT} AND NOT full_birth AND NOT full_death, false) AS r_bplace,
           (conf < {ONE2ONE_SAFE}
            AND conf < best_a - {ONE2ONE_SLACK}
            AND conf < best_b - {ONE2ONE_SLACK}) AS r_one2one,
           -- Rules suggested by the first labelled sample (2026-09-14):
           -- the compute gate accepts a pair when birth OR death years are
           -- within tolerance, so a contradicting death year never rejects.
           -- A full date agreeing on the other event overrides both date
           -- contradictions (second sample: same man, death day identical,
           -- death year mistyped 1872/1879).
           COALESCE(dyd > d_tol, false) AND NOT (full_birth OR full_death) AS r_death,
           -- Day-precise dates that differ. An agreeing spouse always excuses
           -- it (siblings do not share a spouse). Agreeing parents only
           -- excuse a same-year slip: parents agreeing across different
           -- birth YEARS are siblings, typically a name reused after a child
           -- died. A day+month-equal, one-year-off date is a copying slip.
           (((full_birth_differs AND NOT birth_slip) OR (full_death_differs AND NOT death_slip))
            AND NOT (full_birth OR full_death)
            AND NOT COALESCE(s_part >= {PARTNER_AGREE}, false)
            AND (COALESCE(byd, 0) >= 1 OR NOT COALESCE(s_par >= {AGREE}, false))) AS r_fulldate,
           -- Register-index rules (baptism entries: birth surname, both
           -- parents always named).
           reg_married AS r_regmarried,
           (has_reg AND COALESCE(s_par < {REG_PARENTS_CONTRADICT}, false)) AS r_regparents,
           generation_slip AS r_generation,
           nn_name AS r_nn,
           COALESCE(child_vs_married, false) AS r_childdeath,
           -- Two plain (unqualified) birth years two or more apart. Military
           -- rolls derive birth years from ages, so they are exempt; so is a
           -- pair whose other full date agrees (a mistyped birth year next to
           -- an identical death date and spouse is one person).
           COALESCE(byd >= 2 AND plain_birth, false) AND NOT has_mil
               AND NOT (full_birth OR full_death) AS r_plain2,
           -- Plain years on both events that BOTH disagree, even by one:
           -- cemetery indexes carry exact years, so two one-year slips are
           -- two different people.
           COALESCE(byd >= 1 AND dyd >= 1 AND plain_birth AND plain_death, false)
               AND NOT has_mil AND NOT (full_birth OR full_death) AS r_plain1,
           -- Source-aware rules. Cemetery indexes: exact years, either a
           -- woman's birth or her married surname (not knowable which), no
           -- places, parents or marriages. Register indexes:
           -- full birth date + parents, no death or spouse.
           --   cemcem  two cemetery indexes: a person is buried once, so the
           --           pair must agree on birth year and (if present) death
           --           year exactly, else it is two graves of namesakes.
           --   cemdeath a cemetery side with a plain death year two or more
           --           off the other side's plain death year.
           --   cemreg  cemetery vs register: the only shared field is the
           --           birth date, so a full date must agree.
           (type_a = 'cem' AND type_b = 'cem'
            AND NOT COALESCE(byd = 0 AND COALESCE(dyd, 0) = 0, false)) AS r_cemcem,
           (has_cem AND plain_death AND COALESCE(dyd >= 2, false)
            AND NOT (full_birth OR full_death)) AS r_cemdeath,
           (pair_class = 'cem-reg' AND NOT full_birth) AS r_cemreg,
           -- Phase 2 gates. A parents or partners agreement is a multi-token
           -- identity in itself, so it satisfies the gate even for a common
           -- surname; only place/year agreement needs a second field there.
           NOT (full_birth OR full_death
                OR COALESCE(s_par >= {AGREE}, false) OR COALESCE(s_part >= {PARTNER_AGREE}, false)
                OR evidence >= CASE WHEN common_sur THEN 2 ELSE 1 END) AS r_agree,
           (CASE WHEN s_sur = 1.0 AND s_name = 1.0 AND (full_birth OR full_death)
                 THEN GREATEST(base2, CASE WHEN full_birth AND full_death
                                           THEN {IDENTITY_KEY_CONFIDENCE_FULL}
                                           ELSE {IDENTITY_KEY_CONFIDENCE} END)
                 ELSE base2 END) AS conf2
        FROM y
    )
    SELECT *, (conf2 < {CONFIDENCE_MIN}) AS r_neutral FROM z;
    ANALYZE ap;
""")

_FAMILY_SQL = text(f"""
    CREATE TEMP TABLE af AS
    WITH m AS (
        SELECT id, contributor_a, contributor_b, record_a_id, record_b_id, confidence,
               match_fields::jsonb AS f
        FROM matches
        WHERE record_type = 'family' AND record_a_id < record_b_id
    ),
    x AS (
        SELECT m.id, m.contributor_a, m.contributor_b, m.record_a_id, m.record_b_id,
               m.confidence AS conf,
               (f->>'husband_surname')::float AS s_hsur,
               (f->>'wife_surname')::float AS s_wsur,
               (f->>'husband_name')::float AS s_hname,
               (f->>'wife_name')::float AS s_wname,
               (f->>'place')::float AS s_place,
               (f->>'year_diff')::int AS yd,
               (f->>'husband_parents')::float AS s_hp,
               (f->>'wife_parents')::float AS s_wp,
               (f->>'children')::float AS s_cl,
               COALESCE(f1.marriage_full_date = f2.marriage_full_date, false) AS full_marriage,
               {_tol('f1.marriage_q', 'f2.marriage_q')} AS m_tol,
               LEAST({_SRC_TYPE('m.contributor_a')}, {_SRC_TYPE('m.contributor_b')}) || '-'
                 || GREATEST({_SRC_TYPE('m.contributor_a')}, {_SRC_TYPE('m.contributor_b')}) AS pair_class,
               ba.best_conf AS best_a, ba.n AS n_a,
               bb.best_conf AS best_b, bb.n AS n_b
        FROM m
        JOIN families f1 ON f1.id = m.record_a_id
        JOIN families f2 ON f2.id = m.record_b_id
        JOIN best ba ON ba.record_type = 'family' AND ba.contributor_a = m.contributor_a
                     AND ba.contributor_b = m.contributor_b AND ba.record_a_id = m.record_a_id
        JOIN best bb ON bb.record_type = 'family' AND bb.contributor_a = m.contributor_b
                     AND bb.contributor_b = m.contributor_a AND bb.record_a_id = m.record_b_id
    ),
    y AS (
        SELECT *,
               COALESCE((s_place >= {AGREE})::int, 0) + COALESCE((yd <= {YEAR_AGREE})::int, 0)
             + COALESCE((s_hp >= {AGREE})::int, 0) + COALESCE((s_wp >= {AGREE})::int, 0)
             + COALESCE((s_cl >= {AGREE})::int, 0) AS evidence,
               (
                   s_hsur * 25.0 + s_wsur * 25.0
                 + COALESCE(s_hname, {NEUTRAL_NEW}) * 15.0
                 + COALESCE(s_wname, {NEUTRAL_NEW}) * 15.0
                 + COALESCE(s_place, {NEUTRAL_NEW}) * 10.0
                 + COALESCE(GREATEST(0.0, 1.0 - yd::float / m_tol), {NEUTRAL_NEW}) * 10.0
                 + COALESCE(s_hp, 0.0) * 15.0 + COALESCE(s_wp, 0.0) * 15.0 + COALESCE(s_cl, 0.0) * 15.0
               ) / (
                   100.0 + CASE WHEN s_hp IS NOT NULL THEN 15.0 ELSE 0.0 END
                         + CASE WHEN s_wp IS NOT NULL THEN 15.0 ELSE 0.0 END
                         + CASE WHEN s_cl IS NOT NULL THEN 15.0 ELSE 0.0 END
               ) AS base2
        FROM x
    ),
    z AS (
        SELECT *,
           (COALESCE(s_hp < {CONTRADICT}, false) OR COALESCE(s_wp < {CONTRADICT}, false)) AS r_parents,
           COALESCE(s_cl < {CONTRADICT}, false) AS r_children,
           COALESCE(s_place < {CONTRADICT} AND NOT full_marriage, false) AS r_place,
           (conf < {ONE2ONE_SAFE}
            AND conf < best_a - {ONE2ONE_SLACK}
            AND conf < best_b - {ONE2ONE_SLACK}) AS r_one2one,
           NOT (full_marriage OR evidence >= 1) AS r_agree,
           -- A missing spouse name ("NN Vidmar ⚭ Frančiška Suhadolc") only
           -- hurts when nothing else corroborates: with the marriage year or
           -- the other spouse's parents agreeing, such pairs were all true.
           ((s_hname IS NULL OR s_wname IS NULL) AND evidence = 0) AS r_names,
           (CASE WHEN s_hsur = 1.0 AND s_wsur = 1.0 AND s_hname = 1.0 AND s_wname = 1.0
                      AND full_marriage
                 THEN GREATEST(base2, {IDENTITY_KEY_CONFIDENCE}) ELSE base2 END) AS conf2
        FROM y
    )
    SELECT *, (conf2 < {CONFIDENCE_MIN}) AS r_neutral FROM z;
    ANALYZE af;
""")

# Rule groups. "phase1"/"phase2" feed the combined counts and the sample's
# keep/drop split; "info" rules are only counted individually. The grouping
# reflects the first labelled sample (80–88 % band, 2026-09-14):
#   * r_bplace removed 5 true matches out of 14 — place strings vary too much
#     ("Trnje, 6257, Slovenija" vs "Trnje") until places are normalised.
#   * every family pair the rules dropped was a true match: two matching
#     surnames plus two matching given names is already strong evidence, and
#     children lists / marriage places are too incomplete to contradict.
#   * second sample (2026-09-15): the revised person set reached 73 %
#     precision in the band; guarding the date rules with an agreeing full
#     date, waiving the common-surname second field when parents/partners
#     agree, and adding r_plain1 / r_childdeath took it to 86 % with no true
#     match lost. r_neutral cost two true spouse-only matches for no gain, so
#     it is measured only. Family one2one fired on true matches only.
#   * source pairing matters (both samples, 80–88 % band): cemetery↔cemetery
#     0 true of 38, cemetery↔register 0 of 8, cemetery↔GEDCOM 8 of 54,
#     GEDCOM↔GEDCOM 80 of 142 — hence r_cemcem / r_cemreg / r_cemdeath.
PERSON_RULES = {
    "phase1": ["r_sex", "r_parents", "r_one2one", "r_death", "r_fulldate",
               "r_generation", "r_nn", "r_childdeath",
               "r_cemcem", "r_cemdeath", "r_cemreg", "r_regmarried", "r_regparents"],
    "phase2": ["r_agree", "r_plain2", "r_plain1"],
    "info": ["r_bplace", "r_neutral"],
}
#   * fourth sample (2026-09-15): r_names fired on 7 family pairs, 6 true and
#     1 unsure — a wife's full name plus a marriage year within tolerance is
#     enough even with the husband's given name missing. No family rule is
#     left in the combined verdict; all are measured only.
FAMILY_RULES = {
    "phase1": [],
    "phase2": [],
    "info": ["r_names", "r_one2one", "r_parents", "r_children", "r_place", "r_agree", "r_neutral"],
}


def _pct(n, total):
    return f"{n:>10,}  ({100.0 * n / total:5.1f}%)" if total else f"{n:>10,}"


def _any(rules):
    return " OR ".join(rules)


def report(conn, tbl, rules, label):
    total = conn.execute(text(f"SELECT COUNT(*) FROM {tbl}")).scalar()
    log(f"\n=== {label}: {total:,} match pairs (each stored twice in `matches`) ===")
    if not total:
        return

    log("\nConfidence bands (current scoring):")
    for lo, hi in BANDS:
        n = conn.execute(
            text(f"SELECT COUNT(*) FROM {tbl} WHERE conf >= :lo AND conf < :hi"),
            {"lo": lo, "hi": hi},
        ).scalar()
        log(f"  {lo:.2f}–{min(hi, 1.0):.2f}  {_pct(n, total)}")

    p12_all = _any(rules["phase1"] + rules["phase2"])
    log("\nBy source pairing (ged = GEDCOM tree, cem = cemetery index, "
        "reg = parish-register index, mil = military roll):")
    log(f"  {'pair':10}{'pairs':>12}{'share':>8}{'in 0.80–0.90':>14}{'rules remove':>14}")
    for row in conn.execute(text(f"""
        SELECT pair_class, COUNT(*) AS n,
               COUNT(*) FILTER (WHERE conf < 0.90) AS low,
               COUNT(*) FILTER (WHERE {p12_all}) AS removed
        FROM {tbl} GROUP BY pair_class ORDER BY n DESC
    """)):
        log(f"  {row.pair_class:10}{row.n:>12,}{100.0 * row.n / total:>7.1f}%"
            f"{100.0 * row.low / row.n:>13.1f}%{100.0 * row.removed / row.n:>13.1f}%")

    log("\nWould be removed by each rule alone:")
    for phase, names in rules.items():
        for r in names:
            n = conn.execute(text(f"SELECT COUNT(*) FROM {tbl} WHERE {r}")).scalar()
            log(f"  [{phase}] {r:<13} {_pct(n, total)}")
    p1 = _any(rules["phase1"])
    p12 = _any(rules["phase1"] + rules["phase2"])
    if not rules["phase2"]:
        log("  (no phase-2 rules in the combined verdict for this record type)")
    n1 = conn.execute(text(f"SELECT COUNT(*) FROM {tbl} WHERE {p1}")).scalar()
    n12 = conn.execute(text(f"SELECT COUNT(*) FROM {tbl} WHERE {p12}")).scalar()
    log("\nCombined:")
    log(f"  phase 1 gates            remove {_pct(n1, total)}   keep {total - n1:,}")
    log(f"  phase 1 + phase 2        remove {_pct(n12, total)}   keep {total - n12:,}")

    log("\nConfidence bands after phase 1 + 2 (current confidence of survivors):")
    for lo, hi in BANDS:
        n = conn.execute(
            text(f"SELECT COUNT(*) FROM {tbl} WHERE NOT ({p12}) AND conf >= :lo AND conf < :hi"),
            {"lo": lo, "hi": hi},
        ).scalar()
        log(f"  {lo:.2f}–{min(hi, 1.0):.2f}  {_pct(n, total)}")

    log("\nAgreeing corroborating fields per match (current table), by band:")
    log("  band        0 fields   1 field   2 fields  3+ fields")
    for lo, hi in BANDS:
        row = conn.execute(
            text(f"""
            SELECT COUNT(*) FILTER (WHERE evidence = 0),
                   COUNT(*) FILTER (WHERE evidence = 1),
                   COUNT(*) FILTER (WHERE evidence = 2),
                   COUNT(*) FILTER (WHERE evidence >= 3)
            FROM {tbl} WHERE conf >= :lo AND conf < :hi
        """),
            {"lo": lo, "hi": hi},
        ).fetchone()
        log(f"  {lo:.2f}–{min(hi, 1.0):.2f}  " + "  ".join(f"{v:>9,}" for v in row))

    log("\nFan-out: partners one record has inside a single other tree (max of both sides):")
    for lbl, cond in (
        ("1", "= 1"), ("2", "= 2"), ("3–5", "BETWEEN 3 AND 5"),
        ("6–10", "BETWEEN 6 AND 10"), ("11+", "> 10"),
    ):
        n = conn.execute(
            text(f"SELECT COUNT(*) FROM {tbl} WHERE GREATEST(n_a, n_b) {cond}")
        ).scalar()
        log(f"  {lbl:<5} {_pct(n, total)}")


_PERSON_SAMPLE_COLS = """
    ap.id AS match_id, ap.pair_class, ap.conf, ap.conf2, ap.evidence, ap.n_a, ap.n_b,
    ap.r_sex, ap.r_parents, ap.r_bplace, ap.r_one2one, ap.r_death, ap.r_fulldate,
    ap.r_generation, ap.r_nn, ap.r_childdeath, ap.r_cemcem, ap.r_cemdeath, ap.r_cemreg,
    ap.r_regmarried, ap.r_regparents, ap.r_agree, ap.r_plain2, ap.r_plain1, ap.r_neutral,
    ap.s_sur, ap.s_name, ap.s_bplace, ap.s_dplace, ap.byd, ap.dyd, ap.s_par, ap.s_part,
    ap.contributor_a, p1.id AS a_id, p1.name AS a_name, p1.surname AS a_surname,
    p1.alt_surname AS a_alt_surname, p1.sex AS a_sex,
    p1.date_of_birth AS a_birth, p1.place_of_birth AS a_birth_place,
    p1.date_of_death AS a_death, p1.place_of_death AS a_death_place,
    p1.parents_match_text AS a_parents, p1.partners_match_text AS a_partners,
    ap.contributor_b, p2.id AS b_id, p2.name AS b_name, p2.surname AS b_surname,
    p2.alt_surname AS b_alt_surname, p2.sex AS b_sex,
    p2.date_of_birth AS b_birth, p2.place_of_birth AS b_birth_place,
    p2.date_of_death AS b_death, p2.place_of_death AS b_death_place,
    p2.parents_match_text AS b_parents, p2.partners_match_text AS b_partners
"""

_FAMILY_SAMPLE_COLS = """
    af.id AS match_id, af.pair_class, af.conf, af.conf2, af.evidence, af.n_a, af.n_b,
    af.r_parents, af.r_children, af.r_place, af.r_one2one, af.r_agree, af.r_neutral, af.r_names,
    af.s_hsur, af.s_wsur, af.s_hname, af.s_wname, af.s_place, af.yd, af.s_hp, af.s_wp, af.s_cl,
    af.contributor_a, f1.id AS a_id,
    f1.husband_name AS a_husband, f1.husband_surname AS a_husband_surname,
    f1.wife_name AS a_wife, f1.wife_surname AS a_wife_surname,
    f1.date_of_marriage AS a_marriage, f1.place_of_marriage AS a_place,
    f1.children_match_text AS a_children,
    af.contributor_b, f2.id AS b_id,
    f2.husband_name AS b_husband, f2.husband_surname AS b_husband_surname,
    f2.wife_name AS b_wife, f2.wife_surname AS b_wife_surname,
    f2.date_of_marriage AS b_marriage, f2.place_of_marriage AS b_place,
    f2.children_match_text AS b_children
"""


def write_sample(conn, path, n, band):
    """Stratified random sample for hand labelling: half of the rows are
    matches every candidate rule keeps, half are ones at least one rule would
    drop — so both the precision of what survives and the recall lost by the
    rules can be estimated from the same sheet. Persons get 4/5 of the rows,
    families 1/5. A `label` column is left empty for the reviewer
    (suggested values: same / different / unsure)."""
    lo, hi = band
    n_person = n * 4 // 5
    n_family = n - n_person
    specs = (
        ("person", "ap",
         "persons p1 ON p1.id = ap.record_a_id JOIN persons p2 ON p2.id = ap.record_b_id",
         _PERSON_SAMPLE_COLS, _any(PERSON_RULES["phase1"] + PERSON_RULES["phase2"]), n_person),
        ("family", "af",
         "families f1 ON f1.id = af.record_a_id JOIN families f2 ON f2.id = af.record_b_id",
         _FAMILY_SAMPLE_COLS, _any(FAMILY_RULES["phase1"] + FAMILY_RULES["phase2"]), n_family),
    )
    rows = []
    for rtype, tbl, join, cols, dropped, want in specs:
        for verdict, cond in (("keep", f"NOT ({dropped})"), ("drop", dropped)):
            res = conn.execute(
                text(f"""
                SELECT {cols}
                FROM {tbl} JOIN {join}
                WHERE {tbl}.conf >= :lo AND {tbl}.conf < :hi AND {cond}
                ORDER BY random() LIMIT :lim
            """),
                {"lo": lo, "hi": hi, "lim": max(1, want // 2)},
            )
            for r in res:
                rows.append({"record_type": rtype, "rules_verdict": verdict, "label": "",
                             **r._mapping})
    # Persons and families carry different columns; one sheet keeps the
    # union so reviewers can filter by record_type.
    fields = ["record_type", "rules_verdict", "label"]
    for r in rows:
        fields.extend(k for k in r if k not in fields)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k, "") for k in fields})
    return len(rows)


def score_sample(path):
    """Summarise a labelled sample: precision of what the rules keep vs. what
    they drop, per record type. Rows with an empty label are skipped."""
    from collections import Counter

    counts = Counter()
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            lab = (r.get("label") or "").strip().lower()
            if not lab:
                continue
            counts[(r["record_type"], r["rules_verdict"], lab)] += 1
    if not counts:
        log("No labelled rows found (fill the `label` column with same / different / unsure).")
        return
    log(f"{'type':<8}{'verdict':<8}{'same':>6}{'diff':>6}{'unsure':>8}{'precision':>11}")
    for rtype in ("person", "family"):
        for verdict in ("keep", "drop"):
            same = counts[(rtype, verdict, "same")]
            diff = counts[(rtype, verdict, "different")]
            uns = counts[(rtype, verdict, "unsure")]
            tot = same + diff
            prec = f"{100.0 * same / tot:5.1f}%" if tot else "    –"
            log(f"{rtype:<8}{verdict:<8}{same:>6}{diff:>6}{uns:>8}{prec:>11}")
    log("\n`keep` precision = how clean the table would be after the rules; "
        "`drop` precision = the share of true matches the rules would sacrifice.")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--sample", type=int, default=200, help="rows in the labelling sample (0 = none)")
    ap.add_argument("--no-sample", action="store_true")
    ap.add_argument("--band", type=float, nargs=2, default=(0.80, 0.88), metavar=("LO", "HI"),
                    help="confidence band the sample is drawn from")
    ap.add_argument("--out", default="data/output/match_audit_sample.csv")
    ap.add_argument("--score", metavar="CSV", help="summarise a hand-labelled sample and exit")
    ap.add_argument("--explain", action="store_true",
                    help="print the query plans of the two rescoring queries and exit "
                         "(builds the best-partner table first, ~1 min)")
    args = ap.parse_args()

    if args.score:
        score_sample(args.score)
        return

    if not DATABASE_URL:
        sys.exit("No database configured (set DATABASE_URL or POSTGRES_* env vars).")
    engine = create_engine(DATABASE_URL)
    t0 = time.monotonic()
    with engine.connect() as conn:
        conn.execute(text(f"SET work_mem = '{WORK_MEM}'"))
        conn.execute(text("SET max_parallel_workers_per_gather = 4"))
        has_freq = conn.execute(text("SELECT to_regclass('surname_freq') IS NOT NULL")).scalar()
        if not has_freq:
            log("surname_freq table not found (no compute run yet?) — the common-surname "
                "part of the `agree` rule is disabled; creating an empty stand-in.")
            conn.execute(text("CREATE TEMP TABLE surname_freq (sur text PRIMARY KEY, cnt bigint, is_common boolean)"))

        log("Building per-record best-partner table ...")
        conn.execute(_BEST_SQL)
        log(f"  done in {time.monotonic() - t0:.0f}s")

        if args.explain:
            # Plan only (no ANALYZE), so this returns in seconds. The
            # rescoring statements end with an ANALYZE of the temp table,
            # which EXPLAIN cannot take — strip it.
            for name, sql in (("person", _PERSON_SQL), ("family", _FAMILY_SQL)):
                stmt = str(sql).split("ANALYZE")[0].strip().rstrip(";")
                log(f"\n=== EXPLAIN {name} rescoring ===")
                for row in conn.execute(text("EXPLAIN " + stmt)):
                    log(row[0])
            conn.rollback()
            return

        t = time.monotonic()
        log("Rescoring person matches ...")
        conn.execute(_PERSON_SQL)
        log(f"  done in {time.monotonic() - t:.0f}s")

        t = time.monotonic()
        log("Rescoring family matches ...")
        conn.execute(_FAMILY_SQL)
        log(f"  done in {time.monotonic() - t:.0f}s")

        report(conn, "ap", PERSON_RULES, "PERSON matches")
        report(conn, "af", FAMILY_RULES, "FAMILY matches")

        if args.sample and not args.no_sample:
            os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
            n = write_sample(conn, args.out, args.sample, args.band)
            log(f"\nWrote {n} sample rows ({args.band[0]:.2f} ≤ conf < {args.band[1]:.2f}, "
                f"half kept / half dropped by the rules) to {args.out}")
            log("Fill the `label` column (same / different / unsure), then run "
                f"`python tools/audit_matches.py --score {args.out}`.")
        conn.rollback()  # temp tables only; nothing to keep
    log(f"\nTotal {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
