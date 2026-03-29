from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text, cast, Text
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
    return [
        {
            "name": c.name,
            "last_modified": c.last_modified,
            "births_count": births_counts.get(c.name, 0),
            "families_count": families_counts.get(c.name, 0),
        }
        for c in db.query(models.Contributor).all()
    ]


def _text_filter(column, value, exact: bool):
    if exact:
        return column.ilike(value)  # case-insensitive exact match, no wildcards
    return or_(column.op("%")(cast(value, Text)), column.ilike(f"%{value}%"))


def search_all(db: Session, query: str, skip: int = 0, limit: int = 100, exact: bool = False):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

    search_term = f"%{query}%"

    births = (
        db.query(models.Birth)
        .filter(
            or_(
                _text_filter(models.Birth.name, query, exact),
                _text_filter(models.Birth.surname, query, exact),
                _text_filter(models.Birth.place_of_birth, query, exact),
                models.Birth.date_of_birth.ilike(search_term),
            )
        )
        .offset(skip)
        .limit(limit)
        .all()
    )

    families = (
        db.query(models.Family)
        .filter(
            or_(
                _text_filter(models.Family.husband_name, query, exact),
                _text_filter(models.Family.husband_surname, query, exact),
                _text_filter(models.Family.wife_name, query, exact),
                _text_filter(models.Family.wife_surname, query, exact),
                _text_filter(models.Family.place_of_marriage, query, exact),
                models.Family.date_of_marriage.ilike(search_term),
            )
        )
        .offset(skip)
        .limit(limit)
        .all()
    )

    return {"births": births, "families": families}


def search_advanced_births(
    db: Session,
    name: str = None,
    surname: str = None,
    date_of_birth: str = None,
    place_of_birth: str = None,
    contributor: str = None,
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
        query = query.filter(_text_filter(models.Birth.place_of_birth, place_of_birth, exact))
    if date_of_birth:
        query = query.filter(models.Birth.date_of_birth.ilike(f"%{date_of_birth}%"))
    if contributor:
        query = query.filter(_text_filter(models.Birth.contributor, contributor, exact))

    return query.offset(skip).limit(limit).all()


def search_advanced_families(
    db: Session,
    husband_name: str = None,
    husband_surname: str = None,
    wife_name: str = None,
    wife_surname: str = None,
    date_of_marriage: str = None,
    place_of_marriage: str = None,
    contributor: str = None,
    skip: int = 0,
    limit: int = 100,
    exact: bool = False,
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text(f"SELECT set_limit({0.3 if not exact else 1.0});"))
    db.commit()

    query = db.query(models.Family)

    if husband_name:
        query = query.filter(_text_filter(models.Family.husband_name, husband_name, exact))
    if husband_surname:
        query = query.filter(_text_filter(models.Family.husband_surname, husband_surname, exact))
    if wife_name:
        query = query.filter(_text_filter(models.Family.wife_name, wife_name, exact))
    if wife_surname:
        query = query.filter(_text_filter(models.Family.wife_surname, wife_surname, exact))
    if place_of_marriage:
        query = query.filter(_text_filter(models.Family.place_of_marriage, place_of_marriage, exact))
    if date_of_marriage:
        query = query.filter(models.Family.date_of_marriage.ilike(f"%{date_of_marriage}%"))
    if contributor:
        query = query.filter(_text_filter(models.Family.contributor, contributor, exact))

    return query.offset(skip).limit(limit).all()
