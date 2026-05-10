import json
import os
import re
import time
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text, cast, Text, Integer
from . import models

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
               p1.id AS a_id, p1.name AS a_name, p1.surname AS a_surname, p1.sex AS a_sex,
               p1.date_of_birth AS a_dob, p1.place_of_birth AS a_pob,
               p1.date_of_death AS a_dod, p1.place_of_death AS a_pod,
               p1.parents_list AS a_parents, p1.partners_list AS a_partners,
               p2.id AS b_id, p2.name AS b_name, p2.surname AS b_surname, p2.sex AS b_sex,
               p2.date_of_birth AS b_dob, p2.place_of_birth AS b_pob,
               p2.date_of_death AS b_dod, p2.place_of_death AS b_pod,
               p2.parents_list AS b_parents, p2.partners_list AS b_partners
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
                    "name": r.a_name,
                    "surname": r.a_surname,
                    "sex": r.a_sex,
                    "date_of_birth": r.a_dob,
                    "place_of_birth": r.a_pob,
                    "date_of_death": r.a_dod,
                    "place_of_death": r.a_pod,
                    "parents_list": r.a_parents,
                    "partners_list": r.a_partners,
                },
                "record_b": {
                    "id": r.b_id,
                    "name": r.b_name,
                    "surname": r.b_surname,
                    "sex": r.b_sex,
                    "date_of_birth": r.b_dob,
                    "place_of_birth": r.b_pob,
                    "date_of_death": r.b_dod,
                    "place_of_death": r.b_pod,
                    "parents_list": r.b_parents,
                    "partners_list": r.b_partners,
                },
            }
        )

    family_rows = db.execute(
        text("""
        SELECT m.confidence, m.match_fields,
               f1.id AS a_id, f1.husband_name AS a_hname, f1.husband_surname AS a_hsur,
               f1.husband_birth AS a_hbirth,
               f1.wife_name AS a_wname, f1.wife_surname AS a_wsur,
               f1.wife_birth AS a_wbirth,
               f1.date_of_marriage AS a_date, f1.place_of_marriage AS a_place,
               f1.husband_parents AS a_hp, f1.wife_parents AS a_wp, f1.children_list AS a_cl,
               f2.id AS b_id, f2.husband_name AS b_hname, f2.husband_surname AS b_hsur,
               f2.husband_birth AS b_hbirth,
               f2.wife_name AS b_wname, f2.wife_surname AS b_wsur,
               f2.wife_birth AS b_wbirth,
               f2.date_of_marriage AS b_date, f2.place_of_marriage AS b_place,
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
                    "husband_name": r.a_hname,
                    "husband_surname": r.a_hsur,
                    "husband_birth": r.a_hbirth,
                    "wife_name": r.a_wname,
                    "wife_surname": r.a_wsur,
                    "wife_birth": r.a_wbirth,
                    "date_of_marriage": r.a_date,
                    "place_of_marriage": r.a_place,
                    "husband_parents": r.a_hp,
                    "wife_parents": r.a_wp,
                    "children_list": r.a_cl,
                },
                "record_b": {
                    "id": r.b_id,
                    "husband_name": r.b_hname,
                    "husband_surname": r.b_hsur,
                    "husband_birth": r.b_hbirth,
                    "wife_name": r.b_wname,
                    "wife_surname": r.b_wsur,
                    "wife_birth": r.b_wbirth,
                    "date_of_marriage": r.b_date,
                    "place_of_marriage": r.b_place,
                    "husband_parents": r.b_hp,
                    "wife_parents": r.b_wp,
                    "children_list": r.b_cl,
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


def get_contributors(db: Session):
    """Fetch pre-calculated stats, enriched with optional contributor links."""
    rows = db.query(models.Contributor).all()
    links = _load_contributor_links()
    for row in rows:
        row.url = links.get(row.name)
    return rows


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
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
    record_type: str = None,
):
    _set_trgm(db, exact)

    persons = []
    if record_type in (None, "persons"):
        q = db.query(models.Person)
        if name:
            q = q.filter(
                _text_filter(models.Person.name, name, exact, split_comma=True)
            )
        if surname:
            q = q.filter(
                _text_filter(models.Person.surname, surname, exact, split_comma=True)
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
            q = q.filter(_text_filter(models.Person.contributor, contributor, exact))
        if has_link:
            q = q.filter(models.Person.links.isnot(None), models.Person.links != "")
        persons = q.offset(skip).limit(limit).all()

    families = []
    if record_type in (None, "families"):
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
                    _text_filter(
                        models.Family.husband_surname, surname, exact, split_comma=True
                    ),
                    _text_filter(
                        models.Family.wife_surname, surname, exact, split_comma=True
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
                _text_filter(models.Family.contributor, contributor, exact)
            )
        if has_link:
            families_q = families_q.filter(
                models.Family.links.isnot(None), models.Family.links != ""
            )
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
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    _set_trgm(db, exact)

    query = db.query(models.Person)

    if name:
        query = query.filter(
            _text_filter(models.Person.name, name, exact, split_comma=True)
        )
    if surname:
        query = query.filter(
            _text_filter(models.Person.surname, surname, exact, split_comma=True)
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
            _text_filter(models.Person.contributor, contributor, exact)
        )
    if has_link:
        query = query.filter(models.Person.links.isnot(None), models.Person.links != "")

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
            _text_filter(
                models.Family.husband_surname, husband_surname, exact, split_comma=True
            )
        )
    hb_cond = _date_filter(
        models.Family.husband_birth, husband_birth, husband_birth_to, exact
    )
    if hb_cond is not None:
        query = query.filter(hb_cond)
    if wife_name:
        query = query.filter(
            _text_filter(models.Family.wife_name, wife_name, exact, split_comma=True)
        )
    if wife_surname:
        query = query.filter(
            _text_filter(
                models.Family.wife_surname, wife_surname, exact, split_comma=True
            )
        )
    wb_cond = _date_filter(models.Family.wife_birth, wife_birth, wife_birth_to, exact)
    if wb_cond is not None:
        query = query.filter(wb_cond)
    if children:
        v = children.replace("%", r"\%").replace("_", r"\_")
        if exact:
            children_filter = models.Family.children_list.ilike(f'%"{v}"%')
        else:
            children_filter = or_(
                models.Family.children_list.ilike(f"%{v}%"),
                models.Family.children_list.op("%>")(cast(children, Text)),
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
            _text_filter(models.Family.contributor, contributor, exact)
        )
    if has_link:
        query = query.filter(models.Family.links.isnot(None), models.Family.links != "")

    return query.offset(skip).limit(limit).all()
