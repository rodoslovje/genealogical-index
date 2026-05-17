import json
import os
import re
import time
import unicodedata
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text, cast, Text, Integer
from sqlalchemy.dialects.postgresql import JSONB
from . import models


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
        SELECT contributor_a AS contributor, COUNT(DISTINCT contributor_b) AS partners_count
        FROM matches
        GROUP BY contributor_a
    """)).fetchall()
    result = [dict(r._mapping) for r in rows]
    _match_counts_cache["data"] = result
    _match_counts_cache["time"] = now
    return result


def get_contributor_match_detail(db: Session, contributor_a: str, contributor_b: str):
    results = []

    person_rows = db.execute(
        text("""
        SELECT m.confidence, m.match_fields,
               p1.id AS a_id, p1.ext_id AS a_ext_id, p1.name AS a_name,
               p1.surname AS a_surname, p1.alt_surname AS a_alt_surname, p1.sex AS a_sex,
               p1.date_of_birth AS a_dob, p1.place_of_birth AS a_pob,
               p1.date_of_baptism AS a_dobap, p1.place_of_baptism AS a_pobap,
               p1.date_of_death AS a_dod, p1.place_of_death AS a_pod,
               p1.parents_list AS a_parents, p1.partners_list AS a_partners,
               p1.notes AS a_notes, p1.links AS a_links,
               p2.id AS b_id, p2.ext_id AS b_ext_id, p2.name AS b_name,
               p2.surname AS b_surname, p2.alt_surname AS b_alt_surname, p2.sex AS b_sex,
               p2.date_of_birth AS b_dob, p2.place_of_birth AS b_pob,
               p2.date_of_baptism AS b_dobap, p2.place_of_baptism AS b_pobap,
               p2.date_of_death AS b_dod, p2.place_of_death AS b_pod,
               p2.parents_list AS b_parents, p2.partners_list AS b_partners,
               p2.notes AS b_notes, p2.links AS b_links
        FROM matches m
        JOIN persons p1 ON m.record_a_id = p1.id
        JOIN persons p2 ON m.record_b_id = p2.id
        WHERE m.contributor_a = :a AND m.contributor_b = :b AND m.record_type = 'person'
        ORDER BY m.confidence DESC
    """),
        {"a": contributor_a, "b": contributor_b},
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
               f1.notes AS a_notes, f1.links AS a_links,
               f1.husband_parents AS a_hp, f1.wife_parents AS a_wp, f1.children_list AS a_cl,
               f2.id AS b_id,
               f2.husband_ext_id AS b_hext, f2.husband_name AS b_hname,
               f2.husband_surname AS b_hsur, f2.husband_alt_surname AS b_halt,
               f2.husband_birth AS b_hbirth,
               f2.wife_ext_id AS b_wext, f2.wife_name AS b_wname,
               f2.wife_surname AS b_wsur, f2.wife_alt_surname AS b_walt,
               f2.wife_birth AS b_wbirth,
               f2.date_of_marriage AS b_date, f2.place_of_marriage AS b_place,
               f2.notes AS b_notes, f2.links AS b_links,
               f2.husband_parents AS b_hp, f2.wife_parents AS b_wp, f2.children_list AS b_cl
        FROM matches m
        JOIN families f1 ON m.record_a_id = f1.id
        JOIN families f2 ON m.record_b_id = f2.id
        WHERE m.contributor_a = :a AND m.contributor_b = :b AND m.record_type = 'family'
        ORDER BY m.confidence DESC
    """),
        {"a": contributor_a, "b": contributor_b},
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
                },
            }
        )

    return results


def get_contributor_matches(db: Session, contributor: str):
    rows = db.execute(
        text("""
            SELECT
                contributor_b                                               AS contributor,
                SUM(CASE WHEN record_type = 'person' THEN 1 ELSE 0 END)   AS persons_count,
                SUM(CASE WHEN record_type = 'family' THEN 1 ELSE 0 END)   AS families_count,
                COUNT(*)                                                    AS total_count,
                MAX(confidence)                                             AS max_confidence,
                MAX(computed_at)::text                                      AS computed_at
            FROM matches
            WHERE contributor_a = :contrib
            GROUP BY contributor_b
            ORDER BY total_count DESC
        """),
        {"contrib": contributor},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


MATRICULA_SUFFIX = "-matricula"


def _base_contributor_name(name: str) -> str:
    if name and name.endswith(MATRICULA_SUFFIX):
        name = name[: -len(MATRICULA_SUFFIX)]
    # Imported contributor names may have inconsistent unicode forms
    # (e.g. "Kovačič" stored as NFC vs NFD); normalize so they group together.
    return unicodedata.normalize("NFC", name) if name else name


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
                "url": (tree["url"] if tree else None)
                or (mat["url"] if mat else None),
                "tree": tree,
                "matricula": mat,
            }
        )
    return merged


def get_timeline_distribution(db: Session):
    """Extracts 4-digit years from persons (birth & death) and families (marriage)."""
    now = time.time()
    if _timeline_cache["data"] is not None and (
        now - _timeline_cache["time"] < CACHE_TTL
    ):
        return _timeline_cache["data"]

    birth_year = cast(func.substring(models.Person.date_of_birth, r"\d{4}"), Integer)
    births = (
        db.query(birth_year.label("year"), func.count(models.Person.id))
        .filter(models.Person.date_of_birth.op("~")(r"\d{4}"))
        .group_by("year")
        .all()
    )

    marr_year = cast(func.substring(models.Family.date_of_marriage, r"\d{4}"), Integer)
    marriages = (
        db.query(marr_year.label("year"), func.count(models.Family.id))
        .filter(models.Family.date_of_marriage.op("~")(r"\d{4}"))
        .group_by("year")
        .all()
    )

    death_year = cast(func.substring(models.Person.date_of_death, r"\d{4}"), Integer)
    deaths = (
        db.query(death_year.label("year"), func.count(models.Person.id))
        .filter(models.Person.date_of_death.op("~")(r"\d{4}"))
        .group_by("year")
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
    """Returns the top surnames by record count, optionally filtered by contributor(s)."""
    cache_key = ",".join(sorted(contributors)) if contributors else ""
    now = time.time()
    cached = _surnames_cache.get(cache_key)
    if cached and (now - cached["time"] < CACHE_TTL):
        return cached["data"][:limit]

    q = db.query(models.Person.surname, func.count(models.Person.id)).group_by(
        models.Person.surname
    )
    if contributors:
        if len(contributors) == 1:
            q = q.filter(models.Person.contributor == contributors[0])
        else:
            q = q.filter(models.Person.contributor.in_(contributors))

    counts = {}
    for surname, c in q.all():
        if surname and surname.strip():
            counts[surname] = c

    result = sorted(
        [{"surname": s, "count": c} for s, c in counts.items() if s.strip()],
        key=lambda x: x["count"],
        reverse=True,
    )
    _surnames_cache[cache_key] = {"data": result, "time": now}
    return result[:limit]


def _extract_year(val: str):
    """Extract a 4-digit year from a date string like '15 MAR 1875' or '1875'."""
    m = re.search(r"\d{4}", val)
    return int(m.group()) if m else None


def _date_filter(column, from_val: str = None, to_val: str = None, exact: bool = False):
    """
    If only from_val is given: existing fuzzy/exact string match.
    If to_val is given: year-range comparison, handling three date formats:
      - Exact year (e.g. "15 MAR 1875"): included when from_year <= year <= to_year
      - Decade approx (e.g. "ABT 193_"): included when range 1930-1939 overlaps search range
      - Century approx (e.g. "ABT 19__"): included when range 1900-1999 overlaps search range
    """
    if to_val is not None:
        from_year = _extract_year(from_val) if from_val else None
        to_year = _extract_year(to_val)

        # Case 1: exact 4-digit year
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


def _surname_filter(surname_col, alt_surname_col, value, exact: bool, split_comma: bool = True):
    """Search a record by either its primary surname or its alt_surname."""
    primary = _text_filter(surname_col, value, exact, split_comma=split_comma)
    alt = _text_filter(alt_surname_col, value, exact, split_comma=split_comma)
    if primary is not None and alt is not None:
        return or_(primary, alt)
    return primary if primary is not None else alt


def _set_trgm(db: Session, exact: bool):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SET pg_trgm.similarity_threshold = {0.5 if not exact else 1.0};"))
    db.execute(
        text(f"SET pg_trgm.word_similarity_threshold = {0.5 if not exact else 1.0};")
    )


def search_all(
    db: Session,
    name: str = None,
    surname: str = None,
    date_from: str = None,
    date_to: str = None,
    place: str = None,
    contributor: str = None,
    has_link: bool = False,
    ext_id: str = None,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
    record_type: str = None,
):
    _set_trgm(db, exact)

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
            models.Person.date_of_birth, date_from, date_to, exact
        )
        date_cond_d = _date_filter(
            models.Person.date_of_death, date_from, date_to, exact
        )
        if date_cond_b is not None and date_cond_d is not None:
            q = q.filter(or_(date_cond_b, date_cond_d))
        elif date_cond_b is not None:
            q = q.filter(date_cond_b)
        if contributor:
            q = q.filter(
                _text_filter(
                    models.Person.contributor, contributor, exact, split_comma=True
                )
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
                        surname, exact,
                    ),
                    _surname_filter(
                        models.Family.wife_surname,
                        models.Family.wife_alt_surname,
                        surname, exact,
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
            models.Family.date_of_marriage, date_from, date_to, exact
        )
        if date_cond_f is not None:
            families_q = families_q.filter(date_cond_f)
        if contributor:
            families_q = families_q.filter(
                _text_filter(
                    models.Family.contributor, contributor, exact, split_comma=True
                )
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
    has_link: bool = False,
    ext_id: str = None,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    _set_trgm(db, exact)

    query = db.query(models.Person)

    if ext_id:
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
        models.Person.date_of_birth, date_of_birth, date_of_birth_to, exact
    )
    if bcond is not None:
        query = query.filter(bcond)
    dcond = _date_filter(
        models.Person.date_of_death, date_of_death, date_of_death_to, exact
    )
    if dcond is not None:
        query = query.filter(dcond)
    if contributor:
        query = query.filter(
            _text_filter(
                models.Person.contributor, contributor, exact, split_comma=True
            )
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
                husband_surname, exact,
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
                wife_surname, exact,
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
        models.Family.date_of_marriage, date_of_marriage, date_of_marriage_to, exact
    )
    if date_cond is not None:
        query = query.filter(date_cond)
    if contributor:
        query = query.filter(
            _text_filter(
                models.Family.contributor, contributor, exact, split_comma=True
            )
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
    surname = parent_info.get("surname")

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
    ext_id_to_idxs = {}   # ext_id -> [input indices]
    fallback_pending = [] # indices needing the name/year heuristic
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


def _make_ancestor_node_from_record(p):
    return {
        "id": p.id,
        "name": p.name,
        "surname": p.surname,
        "sex": p.sex,
        "date_of_birth": p.date_of_birth,
        "place_of_birth": p.place_of_birth,
        "parents": [],
    }


def _make_ancestor_node_from_info(info):
    return {
        "id": None,
        "name": info.get("name"),
        "surname": info.get("surname"),
        "sex": info.get("sex"),
        "date_of_birth": (
            info.get("date_of_birth")
            or info.get("year")
            or (info.get("birth", {}).get("date") if isinstance(info.get("birth"), dict) else None)
        ),
        "place_of_birth": None,
        "parents": [],
    }


def get_ancestors_tree(db: Session, person_id: int, max_generations: int = 5):
    """Build the ancestors tree using breadth-first expansion with per-level
    batched lookups. Two queries per generation (parents resolution + family
    lookup for parents_marriage) replace what used to be O(N) round-trips.
    """
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
        if h.get("surname"):
            conds.append(models.Family.husband_surname == h["surname"])
            filter_count += 1
        if h.get("name"):
            conds.append(models.Family.husband_name == h["name"])
            filter_count += 1
        if w.get("surname"):
            conds.append(models.Family.wife_surname == w["surname"])
            filter_count += 1
        if w.get("name"):
            conds.append(models.Family.wife_name == w["name"])
            filter_count += 1
        if filter_count >= 2:
            sub_conds.append(and_(*conds))
            keys.append((node, h, w))

    if not sub_conds:
        return

    fams = db.query(models.Family).filter(or_(*sub_conds)).all()
    for node, h, w in keys:
        for fam in fams:
            if h.get("surname") and fam.husband_surname != h["surname"]:
                continue
            if h.get("name") and fam.husband_name != h["name"]:
                continue
            if w.get("surname") and fam.wife_surname != w["surname"]:
                continue
            if w.get("name") and fam.wife_name != w["name"]:
                continue
            if fam.date_of_marriage or fam.place_of_marriage:
                node["parents_marriage"] = {
                    "date": fam.date_of_marriage,
                    "place": fam.place_of_marriage,
                }
            break


def _make_descendant_node_from_record(p):
    return {
        "id": p.id,
        "name": p.name,
        "surname": p.surname,
        "sex": p.sex,
        "date_of_birth": p.date_of_birth,
        "place_of_birth": p.place_of_birth,
        "children": [],
        "is_family": False,
    }


def _make_descendant_node_from_info(info):
    return {
        "id": None,
        "name": info.get("name"),
        "surname": info.get("surname"),
        "sex": info.get("sex"),
        "date_of_birth": (
            info.get("date_of_birth")
            or info.get("year")
            or (info.get("birth", {}).get("date") if isinstance(info.get("birth"), dict) else None)
        ),
        "place_of_birth": None,
        "children": [],
        "is_family": False,
    }


def _person_family_filter(record):
    """Build the SQL fragment that locates families where `record` is husband
    or wife (constrained by sex if known). Returns None when the record has
    insufficient identifying info to look anything up."""
    name = record.name
    surname = record.surname
    if not name and not surname:
        return None

    h_conds = []
    if name:    h_conds.append(models.Family.husband_name == name)
    if surname: h_conds.append(models.Family.husband_surname == surname)
    w_conds = []
    if name:    w_conds.append(models.Family.wife_name == name)
    if surname: w_conds.append(models.Family.wife_surname == surname)

    sex = record.sex
    if sex == "m":
        return and_(*h_conds) if h_conds else None
    if sex == "f":
        return and_(*w_conds) if w_conds else None
    # Unknown sex: match either side.
    if h_conds and w_conds:
        return or_(and_(*h_conds), and_(*w_conds))
    if h_conds:
        return and_(*h_conds)
    if w_conds:
        return and_(*w_conds)
    return None


def _family_belongs_to(fam, record, known_partners):
    """Decide whether `fam` is a marriage of `record`, given the record's
    known partners (from partners_list). Returns (is_husband, partner_dict)
    or (None, None) when the family fails the filter."""
    sex = record.sex
    name = record.name or ""
    surname = record.surname or ""

    if sex == "m":
        is_husband = True
    elif sex == "f":
        is_husband = False
    else:
        h_name = fam.husband_name or ""
        h_sur = fam.husband_surname or ""
        is_husband = True
        if name and name != h_name:    is_husband = False
        if surname and surname != h_sur: is_husband = False

    fam_birth = fam.husband_birth if is_husband else fam.wife_birth
    if record.date_of_birth and fam_birth and record.date_of_birth != fam_birth:
        return None, None

    if known_partners is not None:
        part_name = (fam.wife_name if is_husband else fam.husband_name) or ""
        part_sur  = (fam.wife_surname if is_husband else fam.husband_surname) or ""
        matched = False
        for kp in known_partners:
            n_match = not kp["name"]    or kp["name"]    == part_name
            s_match = not kp["surname"] or kp["surname"] == part_sur
            if n_match and s_match:
                matched = True
                break
        if not matched:
            return None, None

    if is_husband:
        partner = {
            "name": fam.wife_name, "surname": fam.wife_surname,
            "date_of_birth": fam.wife_birth, "sex": "f",
        }
    else:
        partner = {
            "name": fam.husband_name, "surname": fam.husband_surname,
            "date_of_birth": fam.husband_birth, "sex": "m",
        }
    return is_husband, partner


def get_descendants_tree(db: Session, person_id: int, max_generations: int = 5):
    """Build the descendants tree using breadth-first expansion with per-level
    batched lookups. Two queries per generation (families OR'd across the
    level, then children resolution) replace the previously per-node fetches.
    """
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
        is_last_gen = (gen == max_generations)
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
        for record, node in owners:
            known_partners = None
            if record.partners_list:
                p_list = _as_list(record.partners_list)
                if p_list:
                    known_partners = [
                        {"name": p.get("name") or "", "surname": p.get("surname") or ""}
                        for p in p_list if p
                    ]

            name = record.name or ""
            surname = record.surname or ""
            sex = record.sex

            for fam in fams_all:
                # Cheap pre-check: does this family even reference the record's name?
                if sex == "m":
                    if name and fam.husband_name != name: continue
                    if surname and fam.husband_surname != surname: continue
                elif sex == "f":
                    if name and fam.wife_name != name: continue
                    if surname and fam.wife_surname != surname: continue
                else:
                    on_h = (not name or fam.husband_name == name) and (not surname or fam.husband_surname == surname)
                    on_w = (not name or fam.wife_name == name)    and (not surname or fam.wife_surname == surname)
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

                if fam.children_list:
                    for c_info in _as_list(fam.children_list):
                        if not c_info:
                            continue
                        pending_children.append((fam_node, c_info))

        # At the deepest generation we still want the families to appear on
        # the leaf persons, but we don't expand further (their children would
        # exceed max_generations).
        if is_last_gen or not pending_children:
            break

        # 4) Batch-resolve every child across this level in a single query
        #    (with the ext_id partial index this is a cheap PK probe).
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
