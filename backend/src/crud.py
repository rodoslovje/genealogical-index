import re
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, text, cast, Text, Integer
from . import models


def get_contributors(db: Session):
    births_counts = dict(
        db.query(models.Birth.contributor, func.count(models.Birth.id))
        .group_by(models.Birth.contributor)
        .all()
    )
    families_counts = dict(
        db.query(models.Family.contributor, func.count(models.Family.id))
        .group_by(models.Family.contributor)
        .all()
    )
    deaths_counts = dict(
        db.query(models.Death.contributor, func.count(models.Death.id))
        .group_by(models.Death.contributor)
        .all()
    )
    birth_links = dict(
        db.query(models.Birth.contributor, func.count(models.Birth.id))
        .filter(models.Birth.link.isnot(None), models.Birth.link != "")
        .group_by(models.Birth.contributor)
        .all()
    )
    family_links = dict(
        db.query(models.Family.contributor, func.count(models.Family.id))
        .filter(models.Family.link.isnot(None), models.Family.link != "")
        .group_by(models.Family.contributor)
        .all()
    )
    death_links = dict(
        db.query(models.Death.contributor, func.count(models.Death.id))
        .filter(models.Death.link.isnot(None), models.Death.link != "")
        .group_by(models.Death.contributor)
        .all()
    )
    return [
        {
            "name": c.name,
            "last_modified": c.last_modified,
            "births_count": births_counts.get(c.name, 0),
            "families_count": families_counts.get(c.name, 0),
            "deaths_count": deaths_counts.get(c.name, 0),
            "links_count": birth_links.get(c.name, 0)
            + family_links.get(c.name, 0)
            + death_links.get(c.name, 0),
        }
        for c in db.query(models.Contributor).all()
    ]


def _extract_year(val: str):
    """Extract a 4-digit year from a date string like '15 MAR 1875' or '1875'."""
    m = re.search(r"\d{4}", val)
    return int(m.group()) if m else None


def _date_filter(column, from_val: str = None, to_val: str = None, exact: bool = False):
    """
    If only from_val is given: existing fuzzy/exact string match.
    If to_val is given: year-range comparison using the 4-digit year extracted
    from the stored date string.
    """
    if to_val is not None:
        # Year-range mode: extract year with PostgreSQL regex, cast to integer
        year_expr = cast(func.substring(column, r"\d{4}"), Integer)
        conditions = [column.op("~")(r"\d{4}")]  # only rows that have a year
        from_year = _extract_year(from_val) if from_val else None
        to_year = _extract_year(to_val)
        if from_year:
            conditions.append(year_expr >= from_year)
        if to_year:
            conditions.append(year_expr <= to_year)
        return and_(*conditions)
    if from_val:
        if exact:
            safe_value = re.sub(r"([.*+?^${}()|\[\]\\])", r"\\\1", from_val)
            return column.op("~*")(rf"\y{safe_value}\y")
        return column.ilike(f"%{from_val}%")
    return None


def _text_filter(column, value, exact: bool):
    if exact:
        safe_value = re.sub(r"([.*+?^${}()|\[\]\\])", r"\\\1", value)
        return column.op("~*")(
            rf"\y{safe_value}\y"
        )  # case-insensitive word boundary match
    return or_(column.op("%")(cast(value, Text)), column.ilike(f"%{value}%"))


def search_all(
    db: Session,
    query: str = None,
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
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

    births_q = db.query(models.Birth)
    if query:
        births_q = births_q.filter(
            or_(
                _text_filter(models.Birth.name, query, exact),
                _text_filter(models.Birth.surname, query, exact),
                _text_filter(models.Birth.place_of_birth, query, exact),
                _text_filter(models.Birth.date_of_birth, query, exact),
                _text_filter(models.Birth.contributor, query, exact),
            )
        )
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
            models.Birth.link.isnot(None), models.Birth.link != ""
        )

    births = births_q.offset(skip).limit(limit).all()

    families_q = db.query(models.Family)
    if query:
        families_q = families_q.filter(
            or_(
                _text_filter(models.Family.husband_name, query, exact),
                _text_filter(models.Family.husband_surname, query, exact),
                _text_filter(models.Family.wife_name, query, exact),
                _text_filter(models.Family.wife_surname, query, exact),
                _text_filter(models.Family.children, query, exact),
                _text_filter(models.Family.place_of_marriage, query, exact),
                _text_filter(models.Family.date_of_marriage, query, exact),
                _text_filter(models.Family.contributor, query, exact),
            )
        )
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
            models.Family.link.isnot(None), models.Family.link != ""
        )

    families = families_q.offset(skip).limit(limit).all()

    deaths_q = db.query(models.Death)
    if query:
        deaths_q = deaths_q.filter(
            or_(
                _text_filter(models.Death.name, query, exact),
                _text_filter(models.Death.surname, query, exact),
                _text_filter(models.Death.place_of_death, query, exact),
                _text_filter(models.Death.date_of_death, query, exact),
                _text_filter(models.Death.contributor, query, exact),
            )
        )
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
            models.Death.link.isnot(None), models.Death.link != ""
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
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

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
        query = query.filter(models.Birth.link.isnot(None), models.Birth.link != "")

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
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

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
        query = query.filter(_text_filter(models.Family.children, children, exact))
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
        query = query.filter(models.Family.link.isnot(None), models.Family.link != "")

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
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

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
        query = query.filter(models.Death.link.isnot(None), models.Death.link != "")

    return query.offset(skip).limit(limit).all()
