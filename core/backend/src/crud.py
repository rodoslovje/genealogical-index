import difflib
import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text, cast, Text, Integer
from sqlalchemy.dialects.postgresql import JSONB
from . import models
from .database import SessionLocal


def _as_list(v):
    """JSONB columns auto-decode to Python lists; legacy TEXT might still be
    strings during a transition. Coerce either to a list, empty on failure."""
    if v is None:
        return []
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v) or []
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _has_links_clause(column):
    """Returns a SQLAlchemy clause asserting that a JSONB list column is
    populated (non-NULL and not an empty array)."""
    return and_(column.isnot(None), column != cast("[]", JSONB))


METADATA_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "output", "metadata.json"
)


def _load_contributor_links():
    """Returns a dict of contributor name -> public URL extracted from metadata.json."""
    try:
        with open(METADATA_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return {
            entry["contributor"]: entry["url"] for entry in data if entry.get("url")
        }
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


CACHE_TTL = 3600  # Cache duration in seconds (1 hour)
MATCH_COUNTS_TTL = 60  # shorter TTL — counts change during match computation
MATRICULA_SUFFIX = "-matricula"
_timeline_cache = {"data": None, "time": 0}
_surnames_cache = {}  # keyed by contributor name (or "" for all)
_match_counts_cache = {"data": None, "time": 0}


def clear_all_caches():
    """Clear all in-memory caches."""
    global _timeline_cache, _surnames_cache, _match_counts_cache
    _timeline_cache = {"data": None, "time": 0}
    _surnames_cache.clear()
    _match_counts_cache = {"data": None, "time": 0}
    return {"status": "ok", "message": "All caches cleared."}


def get_match_counts(db: Session):
    now = time.time()
    if (
        _match_counts_cache["data"] is not None
        and now - _match_counts_cache["time"] < MATCH_COUNTS_TTL
    ):
        return _match_counts_cache["data"]
    rows = db.execute(text("""
        SELECT REPLACE(contributor_a, '-matricula', '') AS contributor,
               REPLACE(contributor_b, '-matricula', '') AS partner
        FROM matches
        GROUP BY REPLACE(contributor_a, '-matricula', ''), REPLACE(contributor_b, '-matricula', '')
    """)).fetchall()

    counts = {}
    for r in rows:
        c_base = r.contributor or ""
        p_base = r.partner or ""
        if c_base not in counts:
            counts[c_base] = set()
        counts[c_base].add(p_base)

    result = [{"contributor": k, "partners_count": len(v)} for k, v in counts.items()]
    _match_counts_cache["data"] = result
    _match_counts_cache["time"] = now
    return result


def get_contributor_match_detail(db: Session, contributor_a: str, contributor_b: str):
    results = []

    a_norm = unicodedata.normalize("NFC", contributor_a)
    a_forms = [a_norm, a_norm + MATRICULA_SUFFIX]

    b_forms = [unicodedata.normalize("NFC", contributor_b)]

    person_rows = db.execute(
        text("""
        SELECT m.confidence, m.match_fields,
               p1.id AS a_id, p1.ext_id AS a_ext_id, p1.name AS a_name,
               p1.surname AS a_surname, p1.alt_surname AS a_alt_surname, p1.sex AS a_sex,
               p1.date_of_birth AS a_dob, p1.place_of_birth AS a_pob,
               p1.date_of_baptism AS a_dobap, p1.place_of_baptism AS a_pobap,
               p1.date_of_death AS a_dod, p1.place_of_death AS a_pod,
               p1.parents_list AS a_parents, p1.partners_list AS a_partners,
               p1.notes AS a_notes, p1.links AS a_links, p1.contributor AS a_contributor,
               p2.id AS b_id, p2.ext_id AS b_ext_id, p2.name AS b_name,
               p2.surname AS b_surname, p2.alt_surname AS b_alt_surname, p2.sex AS b_sex,
               p2.date_of_birth AS b_dob, p2.place_of_birth AS b_pob,
               p2.date_of_baptism AS b_dobap, p2.place_of_baptism AS b_pobap,
               p2.date_of_death AS b_dod, p2.place_of_death AS b_pod,
               p2.parents_list AS b_parents, p2.partners_list AS b_partners,
               p2.notes AS b_notes, p2.links AS b_links, p2.contributor AS b_contributor
        FROM matches m
        JOIN persons p1 ON m.record_a_id = p1.id
        JOIN persons p2 ON m.record_b_id = p2.id
        WHERE m.contributor_a = ANY(:a_forms) AND m.contributor_b = ANY(:b_forms) AND m.record_type = 'person'
        ORDER BY m.confidence DESC
    """),
        {"a_forms": a_forms, "b_forms": b_forms},
    ).fetchall()
    for r in person_rows:
        results.append(
            {
                "record_type": "person",
                "confidence": r.confidence,
                "match_fields": r.match_fields,
                "record_a": {
                    "id": r.a_id,
                    "ext_id": r.a_ext_id,
                    "name": r.a_name,
                    "surname": r.a_surname,
                    "alt_surname": r.a_alt_surname,
                    "sex": r.a_sex,
                    "date_of_birth": r.a_dob,
                    "place_of_birth": r.a_pob,
                    "date_of_baptism": r.a_dobap,
                    "place_of_baptism": r.a_pobap,
                    "date_of_death": r.a_dod,
                    "place_of_death": r.a_pod,
                    "parents_list": r.a_parents,
                    "partners_list": r.a_partners,
                    "notes": r.a_notes,
                    "links": r.a_links,
                    "contributor": r.a_contributor,
                },
                "record_b": {
                    "id": r.b_id,
                    "ext_id": r.b_ext_id,
                    "name": r.b_name,
                    "surname": r.b_surname,
                    "alt_surname": r.b_alt_surname,
                    "sex": r.b_sex,
                    "date_of_birth": r.b_dob,
                    "place_of_birth": r.b_pob,
                    "date_of_baptism": r.b_dobap,
                    "place_of_baptism": r.b_pobap,
                    "date_of_death": r.b_dod,
                    "place_of_death": r.b_pod,
                    "parents_list": r.b_parents,
                    "partners_list": r.b_partners,
                    "notes": r.b_notes,
                    "links": r.b_links,
                    "contributor": r.b_contributor,
                },
            }
        )

    family_rows = db.execute(
        text("""
        SELECT m.confidence, m.match_fields,
               f1.id AS a_id,
               f1.husband_ext_id AS a_hext, f1.husband_name AS a_hname,
               f1.husband_surname AS a_hsur, f1.husband_alt_surname AS a_halt,
               f1.husband_birth AS a_hbirth,
               f1.wife_ext_id AS a_wext, f1.wife_name AS a_wname,
               f1.wife_surname AS a_wsur, f1.wife_alt_surname AS a_walt,
               f1.wife_birth AS a_wbirth,
               f1.date_of_marriage AS a_date, f1.place_of_marriage AS a_place,
               f1.notes AS a_notes, f1.links AS a_links, f1.contributor AS a_contributor,
               f1.husband_parents AS a_hp, f1.wife_parents AS a_wp, f1.children_list AS a_cl,
               f2.id AS b_id,
               f2.husband_ext_id AS b_hext, f2.husband_name AS b_hname,
               f2.husband_surname AS b_hsur, f2.husband_alt_surname AS b_halt,
               f2.husband_birth AS b_hbirth,
               f2.wife_ext_id AS b_wext, f2.wife_name AS b_wname,
               f2.wife_surname AS b_wsur, f2.wife_alt_surname AS b_walt,
               f2.wife_birth AS b_wbirth,
               f2.date_of_marriage AS b_date, f2.place_of_marriage AS b_place,
               f2.notes AS b_notes, f2.links AS b_links, f2.contributor AS b_contributor,
               f2.husband_parents AS b_hp, f2.wife_parents AS b_wp, f2.children_list AS b_cl
        FROM matches m
        JOIN families f1 ON m.record_a_id = f1.id
        JOIN families f2 ON m.record_b_id = f2.id
        WHERE m.contributor_a = ANY(:a_forms) AND m.contributor_b = ANY(:b_forms) AND m.record_type = 'family'
        ORDER BY m.confidence DESC
    """),
        {"a_forms": a_forms, "b_forms": b_forms},
    ).fetchall()
    for r in family_rows:
        results.append(
            {
                "record_type": "family",
                "confidence": r.confidence,
                "match_fields": r.match_fields,
                "record_a": {
                    "id": r.a_id,
                    "husband_ext_id": r.a_hext,
                    "husband_name": r.a_hname,
                    "husband_surname": r.a_hsur,
                    "husband_alt_surname": r.a_halt,
                    "husband_birth": r.a_hbirth,
                    "wife_ext_id": r.a_wext,
                    "wife_name": r.a_wname,
                    "wife_surname": r.a_wsur,
                    "wife_alt_surname": r.a_walt,
                    "wife_birth": r.a_wbirth,
                    "date_of_marriage": r.a_date,
                    "place_of_marriage": r.a_place,
                    "husband_parents": r.a_hp,
                    "wife_parents": r.a_wp,
                    "children_list": r.a_cl,
                    "notes": r.a_notes,
                    "links": r.a_links,
                    "contributor": r.a_contributor,
                },
                "record_b": {
                    "id": r.b_id,
                    "husband_ext_id": r.b_hext,
                    "husband_name": r.b_hname,
                    "husband_surname": r.b_hsur,
                    "husband_alt_surname": r.b_halt,
                    "husband_birth": r.b_hbirth,
                    "wife_ext_id": r.b_wext,
                    "wife_name": r.b_wname,
                    "wife_surname": r.b_wsur,
                    "wife_alt_surname": r.b_walt,
                    "wife_birth": r.b_wbirth,
                    "date_of_marriage": r.b_date,
                    "place_of_marriage": r.b_place,
                    "husband_parents": r.b_hp,
                    "wife_parents": r.b_wp,
                    "children_list": r.b_cl,
                    "notes": r.b_notes,
                    "links": r.b_links,
                    "contributor": r.b_contributor,
                },
            }
        )

    return results


def get_matricula_stats(db: Session):
    """Return aggregate stats over the matricula_books table for the global
    Matricula index page (`?p=matricula`):
      - `books`: full table — one row per book.
      - `top_contributors`: per-contributor counts (books, records).
      - `top_parishes`: per-parish counts (books, records, contributors).
    Returned as a dict so a single endpoint covers all three sections.
    """
    book_rows = (
        db.query(models.MatriculaBook)
        .order_by(
            models.MatriculaBook.parish,
            models.MatriculaBook.contributor,
            models.MatriculaBook.name,
        )
        .all()
    )
    books = [
        {
            "contributor": b.contributor,
            "name": b.name,
            "parish": b.parish,
            "type": b.type,
            "date": b.date,
            "count": b.count or 0,
            "url": b.url,
            "last_modified": b.last_modified,
        }
        for b in book_rows
    ]

    contrib_rows = db.execute(
        text("""
            SELECT contributor,
                   COUNT(*)                 AS books_count,
                   COALESCE(SUM(count), 0)  AS total_records
            FROM matricula_books
            GROUP BY contributor
            ORDER BY total_records DESC, contributor
        """)
    ).fetchall()
    top_contributors = [
        {
            "contributor": r.contributor,
            "books_count": int(r.books_count or 0),
            "total_records": int(r.total_records or 0),
        }
        for r in contrib_rows
    ]

    parish_rows = db.execute(
        text("""
            SELECT parish,
                   COUNT(*)                         AS books_count,
                   COALESCE(SUM(count), 0)          AS total_records,
                   COUNT(DISTINCT contributor)      AS contributors_count
            FROM matricula_books
            WHERE parish IS NOT NULL AND parish <> ''
            GROUP BY parish
            ORDER BY total_records DESC, parish
        """)
    ).fetchall()
    top_parishes = [
        {
            "parish": r.parish,
            "books_count": int(r.books_count or 0),
            "total_records": int(r.total_records or 0),
            "contributors_count": int(r.contributors_count or 0),
        }
        for r in parish_rows
    ]

    return {
        "books": books,
        "top_contributors": top_contributors,
        "top_parishes": top_parishes,
    }


def get_matricula_books(db: Session, contributor: str):
    """Return the Matricula books transcribed by the given contributor, keyed
    by the base name (matricula-index.json stores entries under the base
    name, not the ``-matricula`` suffix). Ordered by name."""
    contrib_norm = unicodedata.normalize("NFC", contributor or "")
    contrib_base = _base_contributor_name(contrib_norm)

    rows = (
        db.query(models.MatriculaBook)
        .filter(models.MatriculaBook.contributor == contrib_base)
        .order_by(models.MatriculaBook.parish, models.MatriculaBook.name)
        .all()
    )
    return rows


def get_contributor_matches(db: Session, contributor: str):
    contrib_norm = unicodedata.normalize("NFC", contributor)
    c_forms = [
        contrib_norm,
        contrib_norm + MATRICULA_SUFFIX,
    ]

    rows = db.execute(
        text("""
            SELECT
                contributor_b                                             AS contributor,
                SUM(CASE WHEN record_type = 'person' THEN 1 ELSE 0 END)   AS persons_count,
                SUM(CASE WHEN record_type = 'family' THEN 1 ELSE 0 END)   AS families_count,
                COUNT(*)                                                    AS total_count,
                MAX(confidence)                                             AS max_confidence,
                MAX(computed_at)::text                                      AS computed_at
            FROM matches
            WHERE contributor_a = ANY(:c_forms)
            GROUP BY contributor_b
        """),
        {"c_forms": c_forms},
    ).fetchall()

    return [dict(r._mapping) for r in rows]


def _base_contributor_name(name: str) -> str:
    if name and name.endswith(MATRICULA_SUFFIX):
        name = name[: -len(MATRICULA_SUFFIX)]
    return name


def get_contributors(db: Session):
    """Fetch pre-calculated stats, merging Matricula index entries into their
    base contributor (e.g. ``Kovačič-matricula`` is folded into ``Kovačič``)
    while still exposing the per-source breakdown via ``tree`` / ``matricula``.
    """
    rows = db.query(models.Contributor).all()
    links = _load_contributor_links()

    grouped: dict[str, dict] = {}
    for row in rows:
        is_matricula = row.name.endswith(MATRICULA_SUFFIX)
        base = _base_contributor_name(row.name)
        part = {
            "name": row.name,
            "last_modified": row.last_modified or "",
            "persons_count": row.persons_count or 0,
            "families_count": row.families_count or 0,
            "links_count": row.links_count or 0,
            "url": links.get(row.name),
        }
        bucket = grouped.setdefault(base, {"tree": None, "matricula": None})
        bucket["matricula" if is_matricula else "tree"] = part

    merged = []
    for base, parts in grouped.items():
        tree = parts["tree"]
        mat = parts["matricula"]
        persons = (tree["persons_count"] if tree else 0) + (
            mat["persons_count"] if mat else 0
        )
        families = (tree["families_count"] if tree else 0) + (
            mat["families_count"] if mat else 0
        )
        link_total = (tree["links_count"] if tree else 0) + (
            mat["links_count"] if mat else 0
        )
        last_modified = max(
            (p["last_modified"] for p in (tree, mat) if p and p["last_modified"]),
            default="",
        )
        merged.append(
            {
                "name": base,
                "last_modified": last_modified,
                "persons_count": persons,
                "families_count": families,
                "links_count": link_total,
                "url": (tree["url"] if tree else None) or (mat["url"] if mat else None),
                "tree": tree,
                "matricula": mat,
            }
        )
    return merged


def get_timeline_distribution(db: Session):
    """Year-distribution of births, deaths, and marriages for the timeline.

    Uses the pre-extracted birth_year / death_year / marriage_year SMALLINT
    columns (populated at import by the same `\\d{4}` regex used here) so
    each query is a cheap index-driven GROUP BY instead of a full table
    seq scan with substring/regex on the TEXT date column.
    """
    now = time.time()
    if _timeline_cache["data"] is not None and (
        now - _timeline_cache["time"] < CACHE_TTL
    ):
        return _timeline_cache["data"]

    births = (
        db.query(models.Person.birth_year.label("year"), func.count())
        .filter(models.Person.birth_year.isnot(None))
        .group_by(models.Person.birth_year)
        .all()
    )

    marriages = (
        db.query(models.Family.marriage_year.label("year"), func.count())
        .filter(models.Family.marriage_year.isnot(None))
        .group_by(models.Family.marriage_year)
        .all()
    )

    deaths = (
        db.query(models.Person.death_year.label("year"), func.count())
        .filter(models.Person.death_year.isnot(None))
        .group_by(models.Person.death_year)
        .all()
    )

    timeline = {}
    for y, c in births:
        if y and 1500 <= y <= 2025:
            timeline.setdefault(
                y, {"year": y, "births": 0, "marriages": 0, "deaths": 0}
            )["births"] = c
    for y, c in marriages:
        if y and 1500 <= y <= 2025:
            timeline.setdefault(
                y, {"year": y, "births": 0, "marriages": 0, "deaths": 0}
            )["marriages"] = c
    for y, c in deaths:
        if y and 1500 <= y <= 2025:
            timeline.setdefault(
                y, {"year": y, "births": 0, "marriages": 0, "deaths": 0}
            )["deaths"] = c

    result = list(timeline.values())
    _timeline_cache["data"] = result
    _timeline_cache["time"] = now
    return result


def get_top_surnames(db: Session, contributors: list = None, limit: int = 100):
    """Returns the top surnames by record count, optionally filtered by contributor(s).

    Counts surnames from persons (births/baptisms) as well as from families
    (marriages), where both the husband and wife surnames contribute."""
    cache_key = ",".join(sorted(contributors)) if contributors else ""
    now = time.time()
    cached = _surnames_cache.get(cache_key)
    if cached and (now - cached["time"] < CACHE_TTL):
        return cached["data"][:limit]

    expanded = None
    if contributors:
        expanded = []
        for c in contributors:
            norm_c = unicodedata.normalize("NFC", c)
            if norm_c not in expanded:
                expanded.append(norm_c)
            mat_form = norm_c + MATRICULA_SUFFIX
            if not norm_c.endswith(MATRICULA_SUFFIX) and mat_form not in expanded:
                expanded.append(mat_form)

    def _contributor_filter(q, contributor_col):
        if not expanded:
            return q
        if len(expanded) == 1:
            return q.filter(contributor_col == expanded[0])
        return q.filter(contributor_col.in_(expanded))

    # One aggregation per source, merged in a single SQL statement via UNION ALL.
    # count(*) (rather than count(<pk>)) lets Postgres satisfy each branch with an
    # index-only scan on the btree surname index, avoiding heap fetches. The outer
    # query does the merge, empty/whitespace filtering, and ordering server-side so
    # only distinct surnames cross the wire.
    def _source(surname_col, contributor_col):
        sub = db.query(
            surname_col.label("surname"), func.count().label("c")
        ).group_by(surname_col)
        return _contributor_filter(sub, contributor_col)

    union_sq = (
        _source(models.Person.surname, models.Person.contributor)
        .union_all(
            _source(models.Family.husband_surname, models.Family.contributor),
            _source(models.Family.wife_surname, models.Family.contributor),
        )
        .subquery()
    )

    total = func.sum(union_sq.c.c).label("count")
    rows = (
        db.query(union_sq.c.surname, total)
        .filter(union_sq.c.surname.isnot(None))
        .filter(func.btrim(union_sq.c.surname) != "")
        .group_by(union_sq.c.surname)
        .order_by(total.desc())
        .all()
    )

    result = [{"surname": s, "count": int(c)} for s, c in rows]
    _surnames_cache[cache_key] = {"data": result, "time": now}
    return result[:limit]


def _extract_year(val: str):
    """Extract a 4-digit year from a date string like '15 MAR 1875' or '1875'."""
    m = re.search(r"\d{4}", val)
    return int(m.group()) if m else None


def _date_filter(
    column,
    from_val: str = None,
    to_val: str = None,
    exact: bool = False,
    year_column=None,
):
    if isinstance(from_val, str):
        from_val = unicodedata.normalize("NFC", from_val)
    if isinstance(to_val, str):
        to_val = unicodedata.normalize("NFC", to_val)

    """
    If only from_val is given: existing fuzzy/exact string match.
    If to_val is given: year-range comparison, handling three date formats:
      - Exact year (e.g. "15 MAR 1875"): included when from_year <= year <= to_year
      - Decade approx (e.g. "ABT 193_"): included when range 1930-1939 overlaps search range
      - Century approx (e.g. "ABT 19__"): included when range 1900-1999 overlaps search range

    When `year_column` is supplied (the SmallInt birth_year / death_year /
    marriage_year sibling of the TEXT date column), the exact-year branch
    uses the indexed integer column directly instead of running
    `cast(substring(col, '\\d{4}'), int)` on every row. Since the year
    column is populated by the same `\\d{4}` regex at import time, an
    indexed range scan covers every row that has a parseable 4-digit year.
    The decade/century branches are then gated on `year_column IS NULL`
    so they only walk the small subset of rows where no exact year exists.
    """
    if to_val is not None:
        from_year = _extract_year(from_val) if from_val else None
        to_year = _extract_year(to_val)

        # Case 1: exact 4-digit year.
        if year_column is not None:
            exact_conds = []
            if from_year:
                exact_conds.append(year_column >= from_year)
            if to_year:
                exact_conds.append(year_column <= to_year)
            if not exact_conds:
                exact_conds.append(year_column.isnot(None))
            exact_match = and_(*exact_conds)
        else:
            year_expr = cast(func.substring(column, r"\d{4}"), Integer)
            exact_conds = [column.op("~")(r"\d{4}")]
            if from_year:
                exact_conds.append(year_expr >= from_year)
            if to_year:
                exact_conds.append(year_expr <= to_year)
            exact_match = and_(*exact_conds)

        # Case 2: decade approximation — 3 known digits + underscore (e.g. "193_" → 1930–1939)
        decade_prefix = cast(func.substring(column, r"(\d{3})_"), Integer)
        decade_min = decade_prefix * 10
        decade_max = decade_prefix * 10 + 9
        decade_conds = [column.op("~")(r"\d{3}_")]
        if year_column is not None:
            decade_conds.append(year_column.is_(None))
        if exact:
            if from_year:
                decade_conds.append(decade_min >= from_year)
            if to_year:
                decade_conds.append(decade_max <= to_year)
        else:
            if from_year:
                decade_conds.append(decade_max >= from_year)
            if to_year:
                decade_conds.append(decade_min <= to_year)
        decade_match = and_(*decade_conds)

        # Case 3: century approximation — 2 known digits + two underscores (e.g. "19__" → 1900–1999)
        century_prefix = cast(func.substring(column, r"(\d{2})__"), Integer)
        century_min = century_prefix * 100
        century_max = century_prefix * 100 + 99
        century_conds = [column.op("~")(r"\d{2}__")]
        if year_column is not None:
            century_conds.append(year_column.is_(None))
        if exact:
            if from_year:
                century_conds.append(century_min >= from_year)
            if to_year:
                century_conds.append(century_max <= to_year)
        else:
            if from_year:
                century_conds.append(century_max >= from_year)
            if to_year:
                century_conds.append(century_min <= to_year)
        century_match = and_(*century_conds)

        return or_(exact_match, decade_match, century_match)
    if from_val:
        if exact:
            v = from_val.replace("%", r"\%").replace("_", r"\_")
            return or_(
                column.ilike(v),
                column.ilike(f"{v} %"),
                column.ilike(f"% {v}"),
                column.ilike(f"% {v} %"),
            )
        return column.ilike(f"%{from_val}%")
    return None


def _text_filter(column, value, exact: bool, split_comma: bool = False):
    if not value:
        return None
    if isinstance(value, str):
        value = unicodedata.normalize("NFC", value)
    if split_comma and "," in value:
        parts = [p.strip() for p in value.split(",") if p.strip()]
    else:
        parts = [value]

    conds = []
    for part in parts:
        if exact:
            v = part.replace("%", r"\%").replace("_", r"\_")
            conds.append(
                or_(
                    column.ilike(v),
                    column.ilike(f"{v} %"),
                    column.ilike(f"% {v}"),
                    column.ilike(f"% {v} %"),
                )
            )
        else:
            conds.append(
                or_(column.op("%>")(cast(part, Text)), column.ilike(f"%{part}%"))
            )

    if len(conds) == 1:
        return conds[0]
    elif len(conds) > 1:
        return or_(*conds)
    return None


def _surname_filter(
    surname_col, alt_surname_col, value, exact: bool, split_comma: bool = True
):
    """Search a record by either its primary surname or its alt_surname."""
    primary = _text_filter(surname_col, value, exact, split_comma=split_comma)
    alt = _text_filter(alt_surname_col, value, exact, split_comma=split_comma)
    if primary is not None and alt is not None:
        return or_(primary, alt)
    return primary if primary is not None else alt


def _set_trgm(db: Session, exact: bool):
    # The pg_trgm extension is created once at API startup; no need to issue
    # CREATE EXTENSION per request.
    threshold = 1.0 if exact else 0.5
    db.execute(text(f"SET LOCAL pg_trgm.similarity_threshold = {threshold};"))
    db.execute(text(f"SET LOCAL pg_trgm.word_similarity_threshold = {threshold};"))


def _apply_source_and_contributor(
    query, column, contributor: str, source: str, exact: bool
):
    if source == "tree":
        query = query.filter(~column.like(f"%{MATRICULA_SUFFIX}"))
    elif source == "matricula":
        query = query.filter(column.like(f"%{MATRICULA_SUFFIX}"))

    if contributor:
        if isinstance(contributor, str):
            contributor = unicodedata.normalize("NFC", contributor)
        if "," in contributor:
            parts = [p.strip() for p in contributor.split(",") if p.strip()]
        else:
            parts = [contributor.strip()]

        conds = []
        for part in parts:
            norm_part = unicodedata.normalize("NFC", part)
            conds.append(_text_filter(column, norm_part, exact, split_comma=False))
            if not norm_part.lower().endswith(MATRICULA_SUFFIX):
                conds.append(
                    _text_filter(
                        column, norm_part + MATRICULA_SUFFIX, exact, split_comma=False
                    )
                )
        if len(conds) == 1:
            query = query.filter(conds[0])
        elif len(conds) > 1:
            query = query.filter(or_(*conds))

    return query


def search_all(
    db: Session,
    name: str = None,
    surname: str = None,
    date_from: str = None,
    date_to: str = None,
    place: str = None,
    contributor: str = None,
    source: str = "all",
    has_link: bool = False,
    ext_id: str = None,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
    record_type: str = None,
):
    _set_trgm(db, exact)

    if isinstance(ext_id, str):
        ext_id = unicodedata.normalize("NFC", ext_id)

    persons = []
    if record_type in (None, "persons"):
        q = db.query(models.Person)
        if ext_id:
            q = q.filter(models.Person.ext_id == ext_id)
        if name:
            q = q.filter(
                _text_filter(models.Person.name, name, exact, split_comma=True)
            )
        if surname:
            q = q.filter(
                _surname_filter(
                    models.Person.surname, models.Person.alt_surname, surname, exact
                )
            )
        if place:
            q = q.filter(
                or_(
                    _text_filter(
                        models.Person.place_of_birth, place, exact, split_comma=True
                    ),
                    _text_filter(
                        models.Person.place_of_death, place, exact, split_comma=True
                    ),
                )
            )
        # Date range filters apply to either birth or death.
        date_cond_b = _date_filter(
            models.Person.date_of_birth,
            date_from,
            date_to,
            exact,
            year_column=models.Person.birth_year,
        )
        date_cond_d = _date_filter(
            models.Person.date_of_death,
            date_from,
            date_to,
            exact,
            year_column=models.Person.death_year,
        )
        if date_cond_b is not None and date_cond_d is not None:
            q = q.filter(or_(date_cond_b, date_cond_d))
        elif date_cond_b is not None:
            q = q.filter(date_cond_b)
        q = _apply_source_and_contributor(
            q, models.Person.contributor, contributor, source, exact
        )
        if has_link:
            q = q.filter(_has_links_clause(models.Person.links))
        persons = q.offset(skip).limit(limit).all()

    families = []
    # An ext_id is a person-record identifier; skip families to avoid noise.
    if record_type in (None, "families") and not ext_id:
        families_q = db.query(models.Family)
        if name:
            families_q = families_q.filter(
                or_(
                    _text_filter(
                        models.Family.husband_name, name, exact, split_comma=True
                    ),
                    _text_filter(
                        models.Family.wife_name, name, exact, split_comma=True
                    ),
                )
            )
        if surname:
            families_q = families_q.filter(
                or_(
                    _surname_filter(
                        models.Family.husband_surname,
                        models.Family.husband_alt_surname,
                        surname,
                        exact,
                    ),
                    _surname_filter(
                        models.Family.wife_surname,
                        models.Family.wife_alt_surname,
                        surname,
                        exact,
                    ),
                )
            )
        if place:
            families_q = families_q.filter(
                _text_filter(
                    models.Family.place_of_marriage, place, exact, split_comma=True
                )
            )
        date_cond_f = _date_filter(
            models.Family.date_of_marriage,
            date_from,
            date_to,
            exact,
            year_column=models.Family.marriage_year,
        )
        if date_cond_f is not None:
            families_q = families_q.filter(date_cond_f)
        families_q = _apply_source_and_contributor(
            families_q, models.Family.contributor, contributor, source, exact
        )
        if has_link:
            families_q = families_q.filter(_has_links_clause(models.Family.links))
        families = families_q.offset(skip).limit(limit).all()

    return {"persons": persons, "families": families}


def search_advanced_persons(
    db: Session,
    name: str = None,
    surname: str = None,
    date_of_birth: str = None,
    date_of_birth_to: str = None,
    place_of_birth: str = None,
    date_of_death: str = None,
    date_of_death_to: str = None,
    place_of_death: str = None,
    contributor: str = None,
    source: str = "all",
    has_link: bool = False,
    ext_id: str = None,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    _set_trgm(db, exact)

    query = db.query(models.Person)

    if ext_id:
        ext_id = unicodedata.normalize("NFC", ext_id)
        query = query.filter(models.Person.ext_id == ext_id)
    if name:
        query = query.filter(
            _text_filter(models.Person.name, name, exact, split_comma=True)
        )
    if surname:
        query = query.filter(
            _surname_filter(
                models.Person.surname, models.Person.alt_surname, surname, exact
            )
        )
    if place_of_birth:
        query = query.filter(
            _text_filter(
                models.Person.place_of_birth, place_of_birth, exact, split_comma=True
            )
        )
    if place_of_death:
        query = query.filter(
            _text_filter(
                models.Person.place_of_death, place_of_death, exact, split_comma=True
            )
        )
    bcond = _date_filter(
        models.Person.date_of_birth,
        date_of_birth,
        date_of_birth_to,
        exact,
        year_column=models.Person.birth_year,
    )
    if bcond is not None:
        query = query.filter(bcond)
    dcond = _date_filter(
        models.Person.date_of_death,
        date_of_death,
        date_of_death_to,
        exact,
        year_column=models.Person.death_year,
    )
    if dcond is not None:
        query = query.filter(dcond)
    query = _apply_source_and_contributor(
        query, models.Person.contributor, contributor, source, exact
    )
    if has_link:
        query = query.filter(_has_links_clause(models.Person.links))

    return query.offset(skip).limit(limit).all()


def search_advanced_families(
    db: Session,
    husband_name: str = None,
    husband_surname: str = None,
    husband_birth: str = None,
    husband_birth_to: str = None,
    wife_name: str = None,
    wife_surname: str = None,
    wife_birth: str = None,
    wife_birth_to: str = None,
    children: str = None,
    date_of_marriage: str = None,
    date_of_marriage_to: str = None,
    place_of_marriage: str = None,
    contributor: str = None,
    source: str = "all",
    has_link: bool = False,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    _set_trgm(db, exact)

    query = db.query(models.Family)

    if husband_name:
        query = query.filter(
            _text_filter(
                models.Family.husband_name, husband_name, exact, split_comma=True
            )
        )
    if husband_surname:
        query = query.filter(
            _surname_filter(
                models.Family.husband_surname,
                models.Family.husband_alt_surname,
                husband_surname,
                exact,
            )
        )
    hb_cond = _date_filter(
        models.Family.husband_birth, husband_birth, husband_birth_to, exact
    )
    if hb_cond is not None:
        query = query.filter(
            or_(
                hb_cond,
                models.Family.husband_birth.is_(None),
                models.Family.husband_birth == "",
            )
        )
    if wife_name:
        query = query.filter(
            _text_filter(models.Family.wife_name, wife_name, exact, split_comma=True)
        )
    if wife_surname:
        query = query.filter(
            _surname_filter(
                models.Family.wife_surname,
                models.Family.wife_alt_surname,
                wife_surname,
                exact,
            )
        )
    wb_cond = _date_filter(models.Family.wife_birth, wife_birth, wife_birth_to, exact)
    if wb_cond is not None:
        query = query.filter(
            or_(
                wb_cond,
                models.Family.wife_birth.is_(None),
                models.Family.wife_birth == "",
            )
        )
    if children:
        if isinstance(children, str):
            children = unicodedata.normalize("NFC", children)
        v = children.replace("%", r"\%").replace("_", r"\_")
        # children_list is JSONB; trgm/ILIKE need its text serialization. The
        # matching trgm expression index `idx_family_children_list_trgm`
        # (over `children_list::text`) lets these stay index-fast.
        children_text = cast(models.Family.children_list, Text)
        if exact:
            children_filter = children_text.ilike(f'%"{v}"%')
        else:
            children_filter = or_(
                children_text.ilike(f"%{v}%"),
                children_text.op("%>")(cast(children, Text)),
            )
        query = query.filter(children_filter)
    if place_of_marriage:
        query = query.filter(
            _text_filter(
                models.Family.place_of_marriage,
                place_of_marriage,
                exact,
                split_comma=True,
            )
        )
    date_cond = _date_filter(
        models.Family.date_of_marriage,
        date_of_marriage,
        date_of_marriage_to,
        exact,
        year_column=models.Family.marriage_year,
    )
    if date_cond is not None:
        query = query.filter(date_cond)
    query = _apply_source_and_contributor(
        query, models.Family.contributor, contributor, source, exact
    )
    if has_link:
        query = query.filter(_has_links_clause(models.Family.links))

    return query.offset(skip).limit(limit).all()


def find_parent_record(db: Session, parent_info: dict, contributor: str):
    """Resolve a JSON parent/child/partner entry to a stored Person row.

    GEDCOM xref-ids (`ext_id`) are unique within a single contributor's file,
    so when one is present we use it as a precise primary-key lookup. If
    the id is missing or doesn't match (older imports, matricula data, or
    re-import differences) we fall back to the name/year heuristic.
    """
    ext_id = parent_info.get("id")
    if isinstance(ext_id, str):
        ext_id = unicodedata.normalize("NFC", ext_id)
    if isinstance(contributor, str):
        contributor = unicodedata.normalize("NFC", contributor)

    if ext_id and contributor:
        match = (
            db.query(models.Person)
            .filter(
                models.Person.contributor == contributor,
                models.Person.ext_id == ext_id,
            )
            .first()
        )
        if match:
            return match

    name = parent_info.get("name")
    if isinstance(name, str):
        name = unicodedata.normalize("NFC", name)
    surname = parent_info.get("surname")
    if isinstance(surname, str):
        surname = unicodedata.normalize("NFC", surname)

    date_of_birth = parent_info.get("date_of_birth")
    if (
        not date_of_birth
        and "birth" in parent_info
        and isinstance(parent_info["birth"], dict)
    ):
        date_of_birth = parent_info["birth"].get("date")

    birth_year = _extract_year(str(date_of_birth)) if date_of_birth else None
    if not birth_year and parent_info.get("year"):
        try:
            birth_year = int(parent_info.get("year"))
        except ValueError:
            pass

    if isinstance(date_of_birth, str):
        date_of_birth = unicodedata.normalize("NFC", date_of_birth)

    if not name and not surname:
        return None

    query = db.query(models.Person).filter(models.Person.contributor == contributor)
    if surname:
        query = query.filter(models.Person.surname == surname)
    if name:
        query = query.filter(models.Person.name == name)
    if date_of_birth:
        query = query.filter(models.Person.date_of_birth == date_of_birth)
    elif birth_year:
        query = query.filter(models.Person.birth_year == birth_year)

    return query.first()


def _normalize_info(info):
    """Extract (name, surname, date_of_birth, birth_year, ext_id) from a JSON
    parent/child/partner entry. Mirrors the precedence used by
    find_parent_record so batch and single resolution behave identically."""
    ext_id = (info.get("id") or "").strip() if info else ""
    name = info.get("name") if info else None
    surname = info.get("surname") if info else None

    date_of_birth = info.get("date_of_birth") if info else None
    if (
        not date_of_birth
        and info
        and "birth" in info
        and isinstance(info["birth"], dict)
    ):
        date_of_birth = info["birth"].get("date")

    birth_year = _extract_year(str(date_of_birth)) if date_of_birth else None
    if not birth_year and info and info.get("year"):
        try:
            birth_year = int(info["year"])
        except (ValueError, TypeError):
            pass
    return ext_id, name, surname, date_of_birth, birth_year


def _batch_resolve_persons(db: Session, infos: list, contributor: str) -> list:
    """Resolve a list of JSON parent/child/partner dicts to Person rows in
    bulk. Returns a list of length `len(infos)` aligned by index; entries
    that couldn't be resolved are None.

    Uses up to two batched queries:
      1. One IN-query on (contributor, ext_id) for infos with an id.
      2. One OR-of-AND query on (contributor, name, surname, date_of_birth /
         birth_year) for the rest.

    This collapses what was previously O(N) find_parent_record calls inside
    a recursive tree walk into O(generations).
    """
    if not infos:
        return []

    result = [None] * len(infos)

    # --- ext_id batch ------------------------------------------------------
    ext_id_to_idxs = {}  # ext_id -> [input indices]
    fallback_pending = []  # indices needing the name/year heuristic
    for i, info in enumerate(infos):
        ext_id, name, surname, _, _ = _normalize_info(info)
        if ext_id:
            ext_id_to_idxs.setdefault(ext_id, []).append(i)
        elif name or surname:
            fallback_pending.append(i)

    if ext_id_to_idxs:
        rows = (
            db.query(models.Person)
            .filter(
                models.Person.contributor == contributor,
                models.Person.ext_id.in_(list(ext_id_to_idxs.keys())),
            )
            .all()
        )
        by_ext = {}
        for r in rows:
            by_ext.setdefault(r.ext_id, r)
        for ext_id, idxs in ext_id_to_idxs.items():
            person = by_ext.get(ext_id)
            if person is not None:
                for idx in idxs:
                    result[idx] = person
            else:
                # ext_id didn't resolve — try the name/year fallback for these
                # entries (older imports, re-import drift, ...).
                fallback_pending.extend(idxs)

    # --- fallback batch (name + surname + date/year) -----------------------
    if fallback_pending:
        sub_conds = []
        # (name, surname, date_of_birth, birth_year) -> [indices]
        key_to_idxs = {}
        for idx in fallback_pending:
            if result[idx] is not None:
                continue
            _, name, surname, dob, year = _normalize_info(infos[idx])
            if not name and not surname:
                continue
            key = (name or "", surname or "", dob or None, year)
            key_to_idxs.setdefault(key, []).append(idx)

            conds = [models.Person.contributor == contributor]
            if surname:
                conds.append(models.Person.surname == surname)
            if name:
                conds.append(models.Person.name == name)
            if dob:
                conds.append(models.Person.date_of_birth == dob)
            elif year:
                conds.append(models.Person.birth_year == year)
            sub_conds.append(and_(*conds))

        if sub_conds:
            rows = db.query(models.Person).filter(or_(*sub_conds)).all()
            for row in rows:
                for (name, surname, dob, year), idxs in key_to_idxs.items():
                    if name and name != (row.name or ""):
                        continue
                    if surname and surname != (row.surname or ""):
                        continue
                    if dob:
                        if dob != (row.date_of_birth or ""):
                            continue
                    elif year and year != row.birth_year:
                        continue
                    for idx in idxs:
                        if result[idx] is None:
                            result[idx] = row

    return result


# Hard ceiling on how deep the ancestor/descendant walks go. Both walks stop
# on their own once the frontier is empty (and a `visited` set bounds the total
# work to the contributor's distinct persons), so this is just a safety net
# against pathological data. A caller passing max_generations <= 0 means
# "all generations" and gets capped here.
_MAX_GENERATIONS_CAP = 100


def _resolve_max_generations(max_generations: int) -> int:
    """0/negative means unlimited; clamp everything to the safety ceiling."""
    if max_generations <= 0 or max_generations > _MAX_GENERATIONS_CAP:
        return _MAX_GENERATIONS_CAP
    return max_generations


def _person_full_dict(p):
    """Full set of a Person record's exportable fields. Shared by the ancestor
    and descendant node builders so CSV/GEDCOM exports get birth, baptism,
    death, notes and source links in addition to the basic identity fields."""
    return {
        "id": p.id,
        "ext_id": p.ext_id,
        "name": p.name,
        "surname": p.surname,
        "alt_surname": p.alt_surname,
        "sex": p.sex,
        "date_of_birth": p.date_of_birth,
        "place_of_birth": p.place_of_birth,
        "date_of_baptism": p.date_of_baptism,
        "place_of_baptism": p.place_of_baptism,
        "date_of_death": p.date_of_death,
        "place_of_death": p.place_of_death,
        "notes": p.notes,
        "links": p.links or [],
    }


# Fields present on record-backed nodes but unknown for unresolved JSON entries;
# spread into the *_from_info builders so every node has a consistent shape.
_EMPTY_PERSON_EXTRAS = {
    "alt_surname": None,
    "place_of_birth": None,
    "date_of_baptism": None,
    "place_of_baptism": None,
    "date_of_death": None,
    "place_of_death": None,
    "notes": None,
    "links": [],
}


def _make_ancestor_node_from_record(p):
    node = _person_full_dict(p)
    node["parents"] = []
    return node


def _make_ancestor_node_from_info(info):
    return {
        "id": None,
        "ext_id": info.get("id"),
        "name": info.get("name"),
        "surname": info.get("surname"),
        "sex": info.get("sex"),
        "date_of_birth": (
            info.get("date_of_birth")
            or info.get("year")
            or (
                info.get("birth", {}).get("date")
                if isinstance(info.get("birth"), dict)
                else None
            )
        ),
        **_EMPTY_PERSON_EXTRAS,
        "parents": [],
    }


def get_ancestors_tree(
    db: Session, person_id: int, max_generations: int = 5, include_marriage: bool = True
):
    """Build the ancestors tree using breadth-first expansion with per-level
    batched lookups. Two queries per generation (parents resolution + family
    lookup for parents_marriage) replace what used to be O(N) round-trips.

    `include_marriage=False` skips the parents-marriage attachment (an extra
    query plus a full-tree walk); the tree-comparison view doesn't render
    marriages, so it opts out to save that work on both trees it builds.
    """
    max_generations = _resolve_max_generations(max_generations)
    root_person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if not root_person:
        return None
    contributor = root_person.contributor

    root_node = _make_ancestor_node_from_record(root_person)
    # Track parallel "records" list so we know which nodes can still grow
    # (only nodes backed by a DB record have parents_list to expand).
    current_records = [root_person]
    current_nodes = [root_node]
    visited = {root_person.id}

    for _gen in range(max_generations):
        # Gather (parent_node, parent_info) pairs from every record in this level.
        pending = []
        for parent_node, record in zip(current_nodes, current_records):
            if not record or not record.parents_list:
                continue
            parents = _as_list(record.parents_list)
            if not parents:
                continue
            for p_info in parents:
                if not p_info:
                    continue
                pending.append((parent_node, p_info))

        if not pending:
            break

        resolved = _batch_resolve_persons(db, [p[1] for p in pending], contributor)

        next_records, next_nodes = [], []
        for (parent_node, p_info), record in zip(pending, resolved):
            if record:
                if record.id in visited:
                    continue
                visited.add(record.id)
                child_node = _make_ancestor_node_from_record(record)
                next_records.append(record)
                next_nodes.append(child_node)
            else:
                child_node = _make_ancestor_node_from_info(p_info)
            parent_node["parents"].append(child_node)

        current_records, current_nodes = next_records, next_nodes

    # Batch-fetch parents_marriage families for every node that ended up with
    # two parents. The single OR'd query collapses N family lookups into one.
    if include_marriage:
        _attach_parents_marriage(db, root_node, contributor)

    return root_node


def _attach_parents_marriage(db: Session, root_node: dict, contributor: str):
    nodes_two = []

    def walk(node):
        if len(node.get("parents", [])) == 2:
            nodes_two.append(node)
        for p in node.get("parents", []):
            walk(p)

    walk(root_node)
    if not nodes_two:
        return

    # Determine husband/wife orientation and build per-node lookup conditions.
    sub_conds = []
    keys = []  # parallel: (node, husband_dict, wife_dict)
    for node in nodes_two:
        p1, p2 = node["parents"][0], node["parents"][1]
        if p1.get("sex") == "m" or p2.get("sex") == "f":
            h, w = p1, p2
        elif p1.get("sex") == "f" or p2.get("sex") == "m":
            h, w = p2, p1
        else:
            h, w = p1, p2

        conds = [models.Family.contributor == contributor]
        filter_count = 0
        for role, ext_col, name_col, surname_col in (
            (
                h,
                models.Family.husband_ext_id,
                models.Family.husband_name,
                models.Family.husband_surname,
            ),
            (
                w,
                models.Family.wife_ext_id,
                models.Family.wife_name,
                models.Family.wife_surname,
            ),
        ):
            role_ext = role.get("ext_id")
            if role_ext:
                name_terms = []
                if role.get("name"):
                    name_terms.append(name_col == role["name"])
                if role.get("surname"):
                    name_terms.append(surname_col == role["surname"])
                empty = or_(ext_col.is_(None), ext_col == "")
                if name_terms:
                    conds.append(or_(ext_col == role_ext, and_(empty, *name_terms)))
                else:
                    conds.append(ext_col == role_ext)
                # ext_id is a strong, unique constraint on its own.
                filter_count += 2
            else:
                if role.get("surname"):
                    conds.append(surname_col == role["surname"])
                    filter_count += 1
                if role.get("name"):
                    conds.append(name_col == role["name"])
                    filter_count += 1
        if filter_count >= 2:
            sub_conds.append(and_(*conds))
            keys.append((node, h, w))

    if not sub_conds:
        return

    def _side_matches(role, fam_ext, fam_name, fam_surname):
        role_ext = role.get("ext_id") or ""
        fam_ext = fam_ext or ""
        if role_ext and fam_ext:
            return role_ext == fam_ext
        if role.get("name") and (fam_name or "") != role["name"]:
            return False
        if role.get("surname") and (fam_surname or "") != role["surname"]:
            return False
        return True

    fams = db.query(models.Family).filter(or_(*sub_conds)).all()
    for node, h, w in keys:
        for fam in fams:
            if not _side_matches(
                h, fam.husband_ext_id, fam.husband_name, fam.husband_surname
            ):
                continue
            if not _side_matches(w, fam.wife_ext_id, fam.wife_name, fam.wife_surname):
                continue
            if fam.date_of_marriage or fam.place_of_marriage:
                node["parents_marriage"] = {
                    "date": fam.date_of_marriage,
                    "place": fam.place_of_marriage,
                }
            break


def _make_descendant_node_from_record(p):
    node = _person_full_dict(p)
    node["children"] = []
    node["is_family"] = False
    return node


def _make_descendant_node_from_info(info):
    return {
        "id": None,
        "ext_id": info.get("id"),
        "name": info.get("name"),
        "surname": info.get("surname"),
        "sex": info.get("sex"),
        "date_of_birth": (
            info.get("date_of_birth")
            or info.get("year")
            or (
                info.get("birth", {}).get("date")
                if isinstance(info.get("birth"), dict)
                else None
            )
        ),
        **_EMPTY_PERSON_EXTRAS,
        "children": [],
        "is_family": False,
    }


def _enrich_partner_from_record(partner, person):
    """Fill a family-derived partner dict with the rest of its Person record
    (baptism, death, notes, links, …) so descendant partners export with the
    same depth as the bloodline persons. Family rows only carry name/surname/
    birth, so the extra fields are unavailable until the partner is resolved."""
    if not person:
        return
    partner["alt_surname"] = person.alt_surname
    partner["place_of_birth"] = person.place_of_birth
    partner["date_of_baptism"] = person.date_of_baptism
    partner["place_of_baptism"] = person.place_of_baptism
    partner["date_of_death"] = person.date_of_death
    partner["place_of_death"] = person.place_of_death
    partner["notes"] = person.notes
    partner["links"] = person.links or []
    if not partner.get("date_of_birth"):
        partner["date_of_birth"] = person.date_of_birth


def _person_family_filter(record):
    """Build the SQL fragment that locates families where `record` is husband
    or wife (constrained by sex if known). Returns None when the record has
    insufficient identifying info to look anything up.

    When the record carries an ext_id we prefer matching on
    husband_ext_id / wife_ext_id — the GEDCOM xref-id disambiguates same-named
    persons within a contributor. Name match remains as a fallback for legacy
    family rows whose ext_id columns are empty.
    """
    ext_id = record.ext_id
    name = record.name
    surname = record.surname
    if not ext_id and not name and not surname:
        return None

    def side_filter(ext_col, name_col, surname_col):
        if ext_id:
            name_terms = []
            if name:
                name_terms.append(name_col == name)
            if surname:
                name_terms.append(surname_col == surname)
            empty = or_(ext_col.is_(None), ext_col == "")
            if name_terms:
                return or_(ext_col == ext_id, and_(empty, *name_terms))
            return ext_col == ext_id
        terms = []
        if name:
            terms.append(name_col == name)
        if surname:
            terms.append(surname_col == surname)
        if not terms:
            return None
        return and_(*terms) if len(terms) > 1 else terms[0]

    h_filter = side_filter(
        models.Family.husband_ext_id,
        models.Family.husband_name,
        models.Family.husband_surname,
    )
    w_filter = side_filter(
        models.Family.wife_ext_id,
        models.Family.wife_name,
        models.Family.wife_surname,
    )

    sex = record.sex
    if sex == "m":
        return h_filter
    if sex == "f":
        return w_filter
    if h_filter is not None and w_filter is not None:
        return or_(h_filter, w_filter)
    return h_filter if h_filter is not None else w_filter


def _family_belongs_to(fam, record, known_partners):
    """Decide whether `fam` is a marriage of `record`, given the record's
    known partners (from partners_list). Returns (is_husband, partner_dict)
    or (None, None) when the family fails the filter."""
    sex = record.sex
    name = record.name or ""
    surname = record.surname or ""
    ext_id = record.ext_id or ""

    if sex == "m":
        is_husband = True
    elif sex == "f":
        is_husband = False
    elif ext_id and ((fam.husband_ext_id or "") or (fam.wife_ext_id or "")):
        # Unknown sex but ext_ids are present: use them to pick the side.
        if ext_id == (fam.husband_ext_id or ""):
            is_husband = True
        elif ext_id == (fam.wife_ext_id or ""):
            is_husband = False
        else:
            return None, None
    else:
        h_name = fam.husband_name or ""
        h_sur = fam.husband_surname or ""
        is_husband = True
        if name and name != h_name:
            is_husband = False
        if surname and surname != h_sur:
            is_husband = False

    # When the record has an ext_id and the matching family side also has one,
    # they must agree — otherwise this is a same-named different person.
    if ext_id:
        fam_ext = (fam.husband_ext_id if is_husband else fam.wife_ext_id) or ""
        if fam_ext and fam_ext != ext_id:
            return None, None

    fam_birth = fam.husband_birth if is_husband else fam.wife_birth
    if record.date_of_birth and fam_birth and record.date_of_birth != fam_birth:
        return None, None

    if known_partners is not None:
        part_name = (fam.wife_name if is_husband else fam.husband_name) or ""
        part_sur = (fam.wife_surname if is_husband else fam.husband_surname) or ""
        # Families with a fully-unknown partner are not represented in
        # partners_list (GEDCOM export skips empty spouse pointers), so don't
        # let the partner check orphan them.
        if part_name or part_sur:
            matched = False
            for kp in known_partners:
                n_match = not kp["name"] or kp["name"] == part_name
                s_match = not kp["surname"] or kp["surname"] == part_sur
                if n_match and s_match:
                    matched = True
                    break
            if not matched:
                return None, None

    if is_husband:
        partner = {
            "ext_id": fam.wife_ext_id,
            "name": fam.wife_name,
            "surname": fam.wife_surname,
            "date_of_birth": fam.wife_birth,
            "sex": "f",
        }
    else:
        partner = {
            "ext_id": fam.husband_ext_id,
            "name": fam.husband_name,
            "surname": fam.husband_surname,
            "date_of_birth": fam.husband_birth,
            "sex": "m",
        }
    return is_husband, partner


def get_descendants_tree(db: Session, person_id: int, max_generations: int = 5):
    """Build the descendants tree using breadth-first expansion with per-level
    batched lookups. Two queries per generation (families OR'd across the
    level, then children resolution) replace the previously per-node fetches.
    """
    max_generations = _resolve_max_generations(max_generations)
    root_person = db.query(models.Person).filter(models.Person.id == person_id).first()
    if not root_person:
        return None
    contributor = root_person.contributor

    root_node = _make_descendant_node_from_record(root_person)
    current_records = [root_person]
    current_nodes = [root_node]
    visited = {root_person.id}

    # Iterate max_generations+1 times so the deepest persons still get their
    # families/marriage info attached (with empty children arrays), matching
    # the original recursive behaviour.
    for gen in range(max_generations + 1):
        is_last_gen = gen == max_generations
        # 1) Build per-record family-lookup conditions and OR them together.
        sub_conds = []
        owners = []  # parallel to sub_conds: (record, node)
        for record, node in zip(current_records, current_nodes):
            if not record:
                continue
            cond = _person_family_filter(record)
            if cond is None:
                continue
            sub_conds.append(and_(models.Family.contributor == contributor, cond))
            owners.append((record, node))

        if not sub_conds:
            break

        # 2) One query fetches every family relevant to this generation.
        fams_all = db.query(models.Family).filter(or_(*sub_conds)).all()

        # 3) For each owner, filter the families that genuinely belong to them
        #    and collect child-info dicts for batch resolution.
        pending_children = []  # (fam_node, child_info) pairs
        gen_partners = []  # partner dicts created this generation, to enrich
        for record, node in owners:
            known_partners = None
            if record.partners_list:
                p_list = _as_list(record.partners_list)
                if p_list:
                    known_partners = [
                        {"name": p.get("name") or "", "surname": p.get("surname") or ""}
                        for p in p_list
                        if p
                    ]

            name = record.name or ""
            surname = record.surname or ""
            sex = record.sex

            for fam in fams_all:
                # Cheap pre-check: does this family even reference the record's name?
                if sex == "m":
                    if name and fam.husband_name != name:
                        continue
                    if surname and fam.husband_surname != surname:
                        continue
                elif sex == "f":
                    if name and fam.wife_name != name:
                        continue
                    if surname and fam.wife_surname != surname:
                        continue
                else:
                    on_h = (not name or fam.husband_name == name) and (
                        not surname or fam.husband_surname == surname
                    )
                    on_w = (not name or fam.wife_name == name) and (
                        not surname or fam.wife_surname == surname
                    )
                    if not (on_h or on_w):
                        continue

                is_husband, partner = _family_belongs_to(fam, record, known_partners)
                if is_husband is None:
                    continue

                if not node.get("sex"):
                    node["sex"] = "m" if is_husband else "f"

                fam_node = {
                    "is_family": True,
                    "partner": partner,
                    "marriage": {
                        "date": fam.date_of_marriage,
                        "place": fam.place_of_marriage,
                    },
                    "children": [],
                }
                node["children"].append(fam_node)
                if partner:
                    gen_partners.append(partner)

                if fam.children_list:
                    for c_info in _as_list(fam.children_list):
                        if not c_info:
                            continue
                        pending_children.append((fam_node, c_info))

        # Enrich this generation's partners with their full Person records in a
        # single batched lookup (partner dicts only carry name/surname/birth from
        # the family row). Done before the deepest-generation break below so leaf
        # families' partners are enriched too.
        if gen_partners:
            partner_infos = [
                {
                    "id": pt.get("ext_id") or "",
                    "name": pt.get("name"),
                    "surname": pt.get("surname"),
                    "date_of_birth": pt.get("date_of_birth"),
                }
                for pt in gen_partners
            ]
            for pt, person in zip(
                gen_partners, _batch_resolve_persons(db, partner_infos, contributor)
            ):
                _enrich_partner_from_record(pt, person)

        # At the deepest generation we still want the families to appear on
        # the leaf persons, but we don't expand further (their children would
        # exceed max_generations).
        if is_last_gen or not pending_children:
            break

        # 4) Batch-resolve every child across this level in a single query
        #    (uses the partial (contributor, ext_id) btree from migration 006).
        resolved = _batch_resolve_persons(
            db, [c[1] for c in pending_children], contributor
        )

        next_records, next_nodes = [], []
        for (fam_node, c_info), record in zip(pending_children, resolved):
            if record:
                if record.id in visited:
                    continue
                visited.add(record.id)
                child_node = _make_descendant_node_from_record(record)
                next_records.append(record)
                next_nodes.append(child_node)
            else:
                child_node = _make_descendant_node_from_info(c_info)
            fam_node["children"].append(child_node)

        current_records, current_nodes = next_records, next_nodes

    return root_node


# ---------------------------------------------------------------------------
# Tree comparison (Phase 1: ancestors)
# ---------------------------------------------------------------------------
#
# Given two persons — one from genealogist A, one from genealogist B — that have
# been matched as the same individual, build both ancestor trees and align them
# slot-by-slot. A person has at most two parents distinguishable by sex, so the
# alignment is a clean lockstep walk: root↔root (the anchor pair), then
# father_A↔father_B and mother_A↔mother_B, recursively. Each aligned slot is
# classified as agree / conflict / only_a / only_b, and the precomputed
# `matches` table supplies a confidence score wherever the two persons are a
# known match.

# Person fields compared when deciding agree vs. conflict. A "conflict" is a
# field both genealogists filled in but with differing values; a value present
# on only one side is extra information, not a disagreement.
_COMPARE_FIELDS = [
    "name",
    "surname",
    "sex",
    "date_of_birth",
    "place_of_birth",
    "date_of_baptism",
    "place_of_baptism",
    "date_of_death",
    "place_of_death",
]


def _norm_cmp(v):
    """Normalise a field value for equality comparison: trim whitespace and
    NFC-normalise unicode so e.g. trailing spaces or composed/decomposed
    accents don't read as a difference."""
    if v is None:
        return ""
    s = str(v).strip()
    return unicodedata.normalize("NFC", s) if s else ""


def _conflict_fields(a, b):
    """Fields that both sides populated but disagree on (the CONFLICT signal)."""
    diffs = []
    for f in _COMPARE_FIELDS:
        va, vb = _norm_cmp(a.get(f)), _norm_cmp(b.get(f))
        if va and vb and va != vb:
            diffs.append(f)
    return diffs


# Identity fields — when these disagree the two records may not even be the same
# person, so that gets its own "conflict" status (vs. a "minor" difference in
# secondary fields like place of baptism or date of death).
_IDENTITY_FIELDS = {"name", "surname", "date_of_birth"}


def _compare_status(a, b):
    """Classify an aligned pair: agree (no differing fields), conflict (an
    identity field differs), or minor (only secondary fields differ)."""
    diffs = _conflict_fields(a, b)
    if not diffs:
        return "agree"
    if any(f in _IDENTITY_FIELDS for f in diffs):
        return "conflict"
    return "minor"


def _split_parents_by_sex(node):
    """Return (father, mother) from a node's parents list. Known sexes take
    their slot; unknown-sex parents fill whatever slot is still empty. Ancestor
    nodes carry at most two parents, so this never drops anyone."""
    father = mother = None
    unknown = []
    for p in node.get("parents") or []:
        if p.get("sex") == "m" and father is None:
            father = p
        elif p.get("sex") == "f" and mother is None:
            mother = p
        else:
            unknown.append(p)
    for p in unknown:
        if father is None:
            father = p
        elif mother is None:
            mother = p
    return father, mother


# Scalar person fields kept in each merged node's `a`/`b` for the side-by-side
# detail. Deliberately excludes the structural `parents`/`children` arrays so a
# merged node doesn't embed its own subtree (which would blow up the payload).
_VIEW_FIELDS = [
    "id", "ext_id", "name", "surname", "alt_surname", "sex",
    "date_of_birth", "place_of_birth", "date_of_baptism", "place_of_baptism",
    "date_of_death", "place_of_death", "notes", "links",
]


def _scalar_person(node):
    if not node:
        return None
    return {f: node.get(f) for f in _VIEW_FIELDS}


def _merged_person_core(a, b, status, confidence):
    """Shared body of a merged comparison node. Display fields (name/sex/…) are
    flattened from whichever side is present (A preferred) so the D3 renderer can
    read them directly; slimmed `a`/`b` records back the side-by-side detail.
    Callers add the structural key (`parents` for ancestors, `children` +
    `is_family` for descendants)."""
    av, bv = _scalar_person(a), _scalar_person(b)
    src = av or bv or {}
    return {
        "status": status,
        "field_diffs": _conflict_fields(a, b) if (a and b) else [],
        "confidence": confidence,
        "a": av,
        "b": bv,
        "name": src.get("name"),
        "surname": src.get("surname"),
        "sex": src.get("sex"),
        "date_of_birth": src.get("date_of_birth"),
        "place_of_birth": src.get("place_of_birth"),
    }


def _merged_person_node(a, b, status, confidence):
    """Merged ancestor node (children live under `parents`)."""
    node = _merged_person_core(a, b, status, confidence)
    node["parents"] = []
    return node


def _only_subtree(node, side):
    """Wrap a whole ancestor subtree that exists for just one genealogist,
    tagging every node only_a / only_b and recursing through its parents."""
    status = "only_" + side
    a = node if side == "a" else None
    b = node if side == "b" else None
    merged = _merged_person_node(a, b, status, None)
    for parent in node.get("parents") or []:
        merged["parents"].append(_only_subtree(parent, side))
    return merged


def _align_ancestors(na, nb, match_conf):
    """Lockstep-align two ancestor nodes known to be the same person. Compares
    their fields, then pairs up fathers and mothers and recurses; an ancestor
    present on only one side becomes an only_a/only_b subtree."""
    conf = match_conf.get((na.get("id"), nb.get("id")))
    status = _compare_status(na, nb)
    merged = _merged_person_node(na, nb, status, conf)

    a_father, a_mother = _split_parents_by_sex(na)
    b_father, b_mother = _split_parents_by_sex(nb)

    for ca, cb in ((a_father, b_father), (a_mother, b_mother)):
        if ca and cb:
            merged["parents"].append(_align_ancestors(ca, cb, match_conf))
        elif ca:
            merged["parents"].append(_only_subtree(ca, "a"))
        elif cb:
            merged["parents"].append(_only_subtree(cb, "b"))

    return merged


# --- Descendant alignment ---------------------------------------------------
#
# Descendant trees interleave person nodes and family nodes: a person's
# `children` are family nodes (one per marriage, each with a `partner`,
# `marriage` and its own `children` = the bloodline persons of that union).
# Alignment therefore proceeds person→family→person: align two persons, match
# their families by partner identity, then within each matched family match the
# children and recurse.


# Max birth-year gap still treated as the same person in the heuristic child /
# partner fallback (mirrors compute_matches.YEAR_TOLERANCE).
_COMPARE_YEAR_TOLERANCE = 5


def _birth_year(node):
    dob = node.get("date_of_birth") if node else None
    return _extract_year(str(dob)) if dob else None


# Min similarity (0–1) for two given-names / surnames to count as the same.
# Tolerant enough for spelling variants (e.g. "Sebastjan" vs "Sebastijan",
# ratio ~0.95) without merging genuinely different names.
_NAME_SIM_THRESHOLD = 0.8


def _similar(a, b):
    """Normalised-string similarity in [0, 1]; 1.0 for an exact match. Used for
    the fuzzy child/partner fallback so given-name spelling variants still align.
    """
    a, b = _norm_cmp(a).lower(), _norm_cmp(b).lower()
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def _person_similarity(a, b, year_tol=_COMPARE_YEAR_TOLERANCE):
    """Fallback child/partner identity *score* when no precomputed match exists:
    0.0 means "not the same person" (fails the surname / name / birth-year
    gates), otherwise a positive magnitude (higher = better) so the best of
    several candidate siblings wins the pairing rather than the first seen.

    Names from two genealogists routinely differ only in spelling — the matches
    table absorbs most via trigram scoring, but borderline variants (below its
    0.72 threshold, e.g. "Sebastjan" vs "Sebastijan") reach here and must still
    align, or the whole subtree below them splits into only_a/only_b duplicates.

    `year_tol` is the max birth-year gap still allowed. Bloodline children use
    the tight default (precise baptism dates); spouses use a wider window since
    their birth years are often rough estimates ("ABT 1725" vs 1716)."""
    sa, sb = _norm_cmp(a.get("surname")), _norm_cmp(b.get("surname"))
    # A clear surname disagreement rules it out; an absent surname on either
    # side leaves the decision to the given name + birth year.
    sur_sim = _similar(sa, sb) if (sa and sb) else None
    if sur_sim is not None and sur_sim < _NAME_SIM_THRESHOLD:
        return 0.0

    na, nb = _norm_cmp(a.get("name")), _norm_cmp(b.get("name"))
    if not na and not nb:
        return 0.0
    name_sim = _similar(na, nb)
    if name_sim < _NAME_SIM_THRESHOLD:
        return 0.0

    # Birth year is a graded signal, not a hard filter beyond the tolerance:
    # within the window, a closer year scores higher so the nearest of several
    # same-named candidates wins; outside it, the pair is rejected.
    ya, yb = _birth_year(a), _birth_year(b)
    if ya and yb:
        gap = abs(ya - yb)
        if gap > year_tol:
            return 0.0
        year_bonus = 0.2 * (1 - gap / year_tol)
    else:
        year_bonus = 0.0

    return name_sim + (sur_sim or 0.0) + year_bonus


# Spouse birth years are frequently rough estimates, so partner matching uses a
# far wider window than bloodline children — a same-named, same-surnamed spouse
# off by a decade is a data discrepancy to flag, not a different person.
_PARTNER_YEAR_TOLERANCE = 20


def _partner_score(pa, pb):
    """Match score for two families' partners. Partner dicts carry no DB id, so
    this is name-based (same fuzzy test as children, with a generous birth-year
    window); two empty/unknown partners (a single unrecorded spouse on each
    side) are treated as the same union."""
    a_empty = not pa or (not _norm_cmp(pa.get("name")) and not _norm_cmp(pa.get("surname")))
    b_empty = not pb or (not _norm_cmp(pb.get("name")) and not _norm_cmp(pb.get("surname")))
    if a_empty or b_empty:
        return 1.0 if (a_empty and b_empty) else 0.0
    return _person_similarity(pa, pb, year_tol=_PARTNER_YEAR_TOLERANCE)


def _child_score(ca, cb, match_conf):
    """Match score for two candidate children. A precomputed match (authoritative,
    trigram-scored across the whole dataset) outranks any fuzzy fallback."""
    conf = match_conf.get((ca.get("id"), cb.get("id")))
    if conf is not None:
        return 2.0 + conf
    return _person_similarity(ca, cb)


# Marriage years come from church records and are usually precise, so a tight
# window. A man marrying two different women within a couple of years is
# essentially impossible, which makes a matching marriage date a strong "same
# union" signal — strong enough to pair families whose spouse names diverge.
_MARRIAGE_YEAR_TOLERANCE = 3


def _marriage_year(fam):
    m = (fam or {}).get("marriage") or {}
    d = m.get("date")
    return _extract_year(str(d)) if d else None


def _family_score(fa, fb):
    """Match score for two families (unions). Builds on partner identity, then
    folds in the marriage date when both sides have one: a matching date
    confirms the pairing and disambiguates a person's several marriages, and on
    its own it can rescue a union whose spouse name one genealogist left vague."""
    pscore = _partner_score(fa.get("partner"), fb.get("partner"))

    ya, yb = _marriage_year(fa), _marriage_year(fb)
    if ya and yb:
        gap = abs(ya - yb)
        if gap <= _MARRIAGE_YEAR_TOLERANCE:
            boost = 0.5 * (1 - gap / _MARRIAGE_YEAR_TOLERANCE)
            # Confirm a partner match, or rescue a union the partner names alone
            # couldn't (one side's spouse unnamed or recorded very differently).
            return (pscore if pscore > 0 else 1.0) + boost
        # Both dated but clearly different marriages: keep the partner-only score
        # so a better-dated candidate is preferred without dropping this one.

    return pscore


def _best_pairs(a_items, b_items, score):
    """Pair items from two lists by best score first. `score(x, y)` returns 0 for
    non-candidates and a positive magnitude otherwise; the highest-scoring pairs
    are assigned greedily (each item used once) so a person with several
    same-named siblings pairs with the closest one rather than the first seen.
    Returns (a, b) tuples; unmatched items pair with None."""
    candidates = []
    for i, ia in enumerate(a_items):
        for j, ib in enumerate(b_items):
            s = score(ia, ib)
            if s > 0:
                candidates.append((s, i, j))
    # Sort by score desc; (i, j) tiebreak keeps the assignment stable.
    candidates.sort(key=lambda c: (-c[0], c[1], c[2]))

    used_a, used_b, a_to_b = set(), set(), {}
    for _s, i, j in candidates:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        a_to_b[i] = j

    pairs = [(ia, b_items[a_to_b[i]] if i in a_to_b else None) for i, ia in enumerate(a_items)]
    pairs.extend((None, ib) for j, ib in enumerate(b_items) if j not in used_b)
    return pairs


def _merged_descendant_person(a, b, status, confidence):
    """Merged descendant person node (children live under `children`)."""
    node = _merged_person_core(a, b, status, confidence)
    node["is_family"] = False
    node["children"] = []
    return node


def _merged_family_node(fa, fb, status):
    """Merged family/marriage node joining two persons' corresponding unions."""
    pa = fa.get("partner") if fa else None
    pb = fb.get("partner") if fb else None
    src_p = pa or pb or {}
    marriage = (fa or fb or {}).get("marriage") or {}
    return {
        "is_family": True,
        "status": status,
        "field_diffs": _conflict_fields(pa, pb) if (pa and pb) else [],
        "partner": {
            "name": src_p.get("name"),
            "surname": src_p.get("surname"),
            "sex": src_p.get("sex"),
            "date_of_birth": src_p.get("date_of_birth"),
        },
        "a": _scalar_person(pa),
        "b": _scalar_person(pb),
        "marriage": marriage,
        "children": [],
    }


def _person_families(node):
    return [c for c in (node.get("children") or []) if c.get("is_family")]


def _family_children(fam):
    return [c for c in (fam.get("children") or []) if not c.get("is_family")]


def _only_descendant_subtree(node, side):
    status = "only_" + side
    a = node if side == "a" else None
    b = node if side == "b" else None
    merged = _merged_descendant_person(a, b, status, None)
    for fam in _person_families(node):
        merged["children"].append(_only_family_subtree(fam, side))
    return merged


def _only_family_subtree(fam, side):
    status = "only_" + side
    fa = fam if side == "a" else None
    fb = fam if side == "b" else None
    merged = _merged_family_node(fa, fb, status)
    for child in _family_children(fam):
        merged["children"].append(_only_descendant_subtree(child, side))
    return merged


def _align_family(fa, fb, match_conf):
    status = _compare_status(fa.get("partner"), fb.get("partner"))
    merged = _merged_family_node(fa, fb, status)

    a_children = _family_children(fa)
    b_children = _family_children(fb)

    for ca, cb in _best_pairs(
        a_children, b_children, lambda ca, cb: _child_score(ca, cb, match_conf)
    ):
        if ca and cb:
            merged["children"].append(_align_descendants(ca, cb, match_conf))
        elif ca:
            merged["children"].append(_only_descendant_subtree(ca, "a"))
        else:
            merged["children"].append(_only_descendant_subtree(cb, "b"))
    return merged


def _align_descendants(na, nb, match_conf):
    """Align two descendant persons known to be the same individual: compare
    their fields, match their families by partner, recurse into matched ones."""
    conf = match_conf.get((na.get("id"), nb.get("id")))
    status = _compare_status(na, nb)
    merged = _merged_descendant_person(na, nb, status, conf)

    a_families = _person_families(na)
    b_families = _person_families(nb)

    for fa, fb in _best_pairs(a_families, b_families, _family_score):
        if fa and fb:
            merged["children"].append(_align_family(fa, fb, match_conf))
        elif fa:
            merged["children"].append(_only_family_subtree(fa, "a"))
        else:
            merged["children"].append(_only_family_subtree(fb, "b"))
    return merged


def _summarize(merged):
    """Count person nodes by status across the whole merged tree. Family nodes
    (descendant marriages) are traversed but not counted — the summary reflects
    people, not unions."""
    counts = {"agree": 0, "minor": 0, "conflict": 0, "only_a": 0, "only_b": 0}

    def walk(node):
        if not node.get("is_family"):
            counts[node["status"]] = counts.get(node["status"], 0) + 1
        for child in node.get("parents", []):
            walk(child)
        for child in node.get("children", []):
            walk(child)

    walk(merged)
    return counts


def _contributor_forms(name):
    """Both spellings a contributor may appear under in the matches table:
    the NFC-normalised name and its -matricula variant."""
    norm = unicodedata.normalize("NFC", name or "")
    return [norm, norm + MATRICULA_SUFFIX]


def _collect_node_ids(node, acc):
    """Gather the DB ids of every record-backed person node in a raw tree.
    Walks both `parents` (ancestors) and `children` (descendants); family nodes
    and unresolved JSON-only nodes have no id and contribute nothing."""
    nid = node.get("id")
    if nid is not None:
        acc.add(nid)
    for child in node.get("parents", []):
        _collect_node_ids(child, acc)
    for child in node.get("children", []):
        _collect_node_ids(child, acc)


def _build_trees_parallel(a_id, b_id, max_generations, direction):
    """Build the two trees concurrently, each on its own session so the DB
    round-trips overlap. Ancestors skip the unused parents-marriage attachment;
    descendants need their family nodes. Sessions are closed in the worker."""

    def build(person_id):
        session = SessionLocal()
        try:
            if direction == "ancestors":
                return get_ancestors_tree(
                    session, person_id, max_generations, include_marriage=False
                )
            return get_descendants_tree(session, person_id, max_generations)
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        fut_a = executor.submit(build, a_id)
        fut_b = executor.submit(build, b_id)
        return fut_a.result(), fut_b.result()


def _find_person_by_ext(db: Session, contributor: str, ext_id: str):
    """Resolve a person by its stable (contributor, GEDCOM ext_id) identity.
    Preferred over the row id, which can change on re-import."""
    if not contributor or not ext_id:
        return None
    norm_c = unicodedata.normalize("NFC", contributor)
    return (
        db.query(models.Person)
        .filter(models.Person.contributor == norm_c, models.Person.ext_id == ext_id)
        .first()
    )


def compare_trees(
    db: Session,
    a_contributor: str,
    a_ext_id: str,
    b_contributor: str,
    b_ext_id: str,
    direction: str = "ancestors",
    max_generations: int = 0,
):
    """Build and align two genealogists' trees rooted at a matched person pair.

    Each side is identified by its stable (contributor, GEDCOM ext_id) pair —
    not the internal row id, which can change on re-import. `direction` is
    "ancestors" or "descendants". Returns a merged tree of comparison nodes plus
    a status summary, or None if either anchor person can't be resolved.
    """
    if direction not in ("ancestors", "descendants"):
        return None

    person_a = _find_person_by_ext(db, a_contributor, a_ext_id)
    person_b = _find_person_by_ext(db, b_contributor, b_ext_id)
    if not person_a or not person_b:
        return None

    a_id, b_id = person_a.id, person_b.id

    # The two trees are independent, I/O-bound builds — run them concurrently on
    # their own sessions (psycopg2 releases the GIL during DB round-trips, so
    # this genuinely overlaps the work).
    tree_a, tree_b = _build_trees_parallel(a_id, b_id, max_generations, direction)
    if not tree_a or not tree_b:
        return None

    # Person ids present in each tree, so the matches lookup is bounded to the
    # pairs that can actually be aligned rather than every match between the
    # two contributors.
    a_ids, b_ids = set(), set()
    _collect_node_ids(tree_a, a_ids)
    _collect_node_ids(tree_b, b_ids)

    # Precomputed person matches between the two contributors: (a_pid, b_pid) ->
    # confidence. Used to annotate aligned pairs; alignment itself is structural.
    rows = db.execute(
        text("""
        SELECT record_a_id, record_b_id, confidence
        FROM matches
        WHERE record_type = 'person'
          AND contributor_a = ANY(:a_forms)
          AND contributor_b = ANY(:b_forms)
          AND record_a_id = ANY(:a_ids)
          AND record_b_id = ANY(:b_ids)
    """),
        {
            "a_forms": _contributor_forms(person_a.contributor),
            "b_forms": _contributor_forms(person_b.contributor),
            "a_ids": list(a_ids),
            "b_ids": list(b_ids),
        },
    ).fetchall()
    match_conf = {(r.record_a_id, r.record_b_id): r.confidence for r in rows}

    if direction == "ancestors":
        merged = _align_ancestors(tree_a, tree_b, match_conf)
    else:
        merged = _align_descendants(tree_a, tree_b, match_conf)

    return {
        "direction": direction,
        # Anchor identity is the stable (contributor, ext_id) pair, not row ids.
        "anchor": {
            "a_ext_id": person_a.ext_id,
            "b_ext_id": person_b.ext_id,
            "confidence": match_conf.get((a_id, b_id)),
        },
        "contributor_a": person_a.contributor,
        "contributor_b": person_b.contributor,
        "summary": _summarize(merged),
        "tree": merged,
    }
