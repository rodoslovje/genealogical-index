import json
import os
import re
import time
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text, cast, Text, Integer
from . import models

METADATA_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'data', 'output', 'metadata.json'
)

def _load_contributor_links():
    """Returns a dict of contributor name -> public URL extracted from metadata.json."""
    try:
        with open(METADATA_PATH, encoding='utf-8') as f:
            data = json.load(f)
        return {entry['contributor']: entry['url'] for entry in data if entry.get('url')}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

CACHE_TTL = 3600  # Cache duration in seconds (1 hour)
_timeline_cache = {"data": None, "time": 0}
_surnames_cache = {}  # keyed by contributor name (or "" for all)


def get_contributors(db: Session):
    """Fetch pre-calculated stats, enriched with optional contributor links."""
    rows = db.query(models.Contributor).all()
    links = _load_contributor_links()
    for row in rows:
        row.url = links.get(row.name)
    return rows


def get_timeline_distribution(db: Session):
    """Extracts 4-digit years from births, marriages, and deaths for the timeline."""
    now = time.time()
    if _timeline_cache["data"] is not None and (
        now - _timeline_cache["time"] < CACHE_TTL
    ):
        return _timeline_cache["data"]

    birth_year = cast(func.substring(models.Birth.date_of_birth, r"\d{4}"), Integer)
    births = (
        db.query(birth_year.label("year"), func.count(models.Birth.id))
        .filter(models.Birth.date_of_birth.op("~")(r"\d{4}"))
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

    death_year = cast(func.substring(models.Death.date_of_death, r"\d{4}"), Integer)
    deaths = (
        db.query(death_year.label("year"), func.count(models.Death.id))
        .filter(models.Death.date_of_death.op("~")(r"\d{4}"))
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

    q = db.query(models.Birth.surname, func.count(models.Birth.id)).group_by(models.Birth.surname)
    if contributors:
        if len(contributors) == 1:
            q = q.filter(models.Birth.contributor == contributors[0])
        else:
            q = q.filter(models.Birth.contributor.in_(contributors))

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
            # Entire decade must fall within the search range
            if from_year:
                decade_conds.append(decade_min >= from_year)
            if to_year:
                decade_conds.append(decade_max <= to_year)
        else:
            # Any overlap with the search range is enough
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
            # Entire century must fall within the search range
            if from_year:
                century_conds.append(century_min >= from_year)
            if to_year:
                century_conds.append(century_max <= to_year)
        else:
            # Any overlap with the search range is enough
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


def _text_filter(column, value, exact: bool):
    if exact:
        # Match value as a whole word using ILIKE patterns — all are index-friendly.
        # Covers: full field, start, end, and middle word positions.
        v = value.replace("%", r"\%").replace("_", r"\_")
        return or_(
            column.ilike(v),
            column.ilike(f"{v} %"),
            column.ilike(f"% {v}"),
            column.ilike(f"% {v} %"),
        )
    return or_(column.op("%>")(cast(value, Text)), column.ilike(f"%{value}%"))


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
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SET pg_trgm.similarity_threshold = {0.5 if not exact else 1.0};"))
    db.execute(
        text(f"SET pg_trgm.word_similarity_threshold = {0.5 if not exact else 1.0};")
    )

    births = []
    if record_type in (None, 'births'):
        births_q = db.query(models.Birth)
        if name:
            births_q = births_q.filter(_text_filter(models.Birth.name, name, exact))
        if surname:
            births_q = births_q.filter(_text_filter(models.Birth.surname, surname, exact))
        if place:
            births_q = births_q.filter(
                _text_filter(models.Birth.place_of_birth, place, exact)
            )
        date_cond_b = _date_filter(models.Birth.date_of_birth, date_from, date_to, exact)
        if date_cond_b is not None:
            births_q = births_q.filter(date_cond_b)
        if contributor:
            births_q = births_q.filter(
                _text_filter(models.Birth.contributor, contributor, exact)
            )
        if has_link:
            births_q = births_q.filter(
                models.Birth.links.isnot(None), models.Birth.links != ""
            )
        births = births_q.offset(skip).limit(limit).all()

    families = []
    if record_type in (None, 'families'):
        families_q = db.query(models.Family)
        if name:
            families_q = families_q.filter(
                or_(
                    _text_filter(models.Family.husband_name, name, exact),
                    _text_filter(models.Family.wife_name, name, exact),
                )
            )
        if surname:
            families_q = families_q.filter(
                or_(
                    _text_filter(models.Family.husband_surname, surname, exact),
                    _text_filter(models.Family.wife_surname, surname, exact),
                )
            )
        if place:
            families_q = families_q.filter(
                _text_filter(models.Family.place_of_marriage, place, exact)
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

    deaths = []
    if record_type in (None, 'deaths'):
        deaths_q = db.query(models.Death)
        if name:
            deaths_q = deaths_q.filter(_text_filter(models.Death.name, name, exact))
        if surname:
            deaths_q = deaths_q.filter(_text_filter(models.Death.surname, surname, exact))
        if place:
            deaths_q = deaths_q.filter(
                _text_filter(models.Death.place_of_death, place, exact)
            )
        date_cond_d = _date_filter(models.Death.date_of_death, date_from, date_to, exact)
        if date_cond_d is not None:
            deaths_q = deaths_q.filter(date_cond_d)
        if contributor:
            deaths_q = deaths_q.filter(
                _text_filter(models.Death.contributor, contributor, exact)
            )
        if has_link:
            deaths_q = deaths_q.filter(
                models.Death.links.isnot(None), models.Death.links != ""
            )
        deaths = deaths_q.offset(skip).limit(limit).all()

    return {"births": births, "families": families, "deaths": deaths}


def search_advanced_births(
    db: Session,
    name: str = None,
    surname: str = None,
    date_of_birth: str = None,
    date_of_birth_to: str = None,
    place_of_birth: str = None,
    contributor: str = None,
    has_link: bool = False,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SET pg_trgm.similarity_threshold = {0.5 if not exact else 1.0};"))
    db.execute(
        text(f"SET pg_trgm.word_similarity_threshold = {0.5 if not exact else 1.0};")
    )

    query = db.query(models.Birth)

    if name:
        query = query.filter(_text_filter(models.Birth.name, name, exact))
    if surname:
        query = query.filter(_text_filter(models.Birth.surname, surname, exact))
    if place_of_birth:
        query = query.filter(
            _text_filter(models.Birth.place_of_birth, place_of_birth, exact)
        )
    date_cond = _date_filter(
        models.Birth.date_of_birth, date_of_birth, date_of_birth_to, exact
    )
    if date_cond is not None:
        query = query.filter(date_cond)
    if contributor:
        query = query.filter(_text_filter(models.Birth.contributor, contributor, exact))
    if has_link:
        query = query.filter(models.Birth.links.isnot(None), models.Birth.links != "")

    return query.offset(skip).limit(limit).all()


def search_advanced_families(
    db: Session,
    husband_name: str = None,
    husband_surname: str = None,
    wife_name: str = None,
    wife_surname: str = None,
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
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SET pg_trgm.similarity_threshold = {0.5 if not exact else 1.0};"))
    db.execute(
        text(f"SET pg_trgm.word_similarity_threshold = {0.5 if not exact else 1.0};")
    )

    query = db.query(models.Family)

    if husband_name:
        query = query.filter(
            _text_filter(models.Family.husband_name, husband_name, exact)
        )
    if husband_surname:
        query = query.filter(
            _text_filter(models.Family.husband_surname, husband_surname, exact)
        )
    if wife_name:
        query = query.filter(_text_filter(models.Family.wife_name, wife_name, exact))
    if wife_surname:
        query = query.filter(
            _text_filter(models.Family.wife_surname, wife_surname, exact)
        )
    if children:
        # children_list is a JSON array: names appear as JSON string values surrounded by quotes.
        # Use ILIKE '%"value"%' for exact word match, or '%value%' for approximate.
        v = children.replace("%", r"\%").replace("_", r"\_")
        if exact:
            children_filter = models.Family.children_list.ilike(f'%"{v}"%')
        else:
            children_filter = or_(
                models.Family.children_list.ilike(f'%{v}%'),
                models.Family.children_list.op("%>")(cast(children, Text)),
            )
        query = query.filter(children_filter)
    if place_of_marriage:
        query = query.filter(
            _text_filter(models.Family.place_of_marriage, place_of_marriage, exact)
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


def search_advanced_deaths(
    db: Session,
    name: str = None,
    surname: str = None,
    date_of_death: str = None,
    date_of_death_to: str = None,
    place_of_death: str = None,
    contributor: str = None,
    has_link: bool = False,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SET pg_trgm.similarity_threshold = {0.5 if not exact else 1.0};"))
    db.execute(
        text(f"SET pg_trgm.word_similarity_threshold = {0.5 if not exact else 1.0};")
    )

    query = db.query(models.Death)

    if name:
        query = query.filter(_text_filter(models.Death.name, name, exact))
    if surname:
        query = query.filter(_text_filter(models.Death.surname, surname, exact))
    if place_of_death:
        query = query.filter(
            _text_filter(models.Death.place_of_death, place_of_death, exact)
        )
    date_cond = _date_filter(
        models.Death.date_of_death, date_of_death, date_of_death_to, exact
    )
    if date_cond is not None:
        query = query.filter(date_cond)
    if contributor:
        query = query.filter(_text_filter(models.Death.contributor, contributor, exact))
    if has_link:
        query = query.filter(models.Death.links.isnot(None), models.Death.links != "")

    return query.offset(skip).limit(limit).all()
