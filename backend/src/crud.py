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


def search_all(db: Session, query: str, skip: int = 0, limit: int = 100):
    # Enable trigram extension for fuzzy search
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))

    # Set similarity threshold
    db.execute(text("SELECT set_limit(0.3);"))
    db.commit()

    search_term = f"%{query}%"
    query_text = cast(query, Text)

    births = (
        db.query(models.Birth)
        .filter(
            or_(
                models.Birth.name.op("%")(query_text),
                models.Birth.name.ilike(search_term),
                models.Birth.surname.op("%")(query_text),
                models.Birth.surname.ilike(search_term),
                models.Birth.place_of_birth.op("%")(query_text),
                models.Birth.place_of_birth.ilike(search_term),
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
                models.Family.husband_name.op("%")(query_text),
                models.Family.husband_name.ilike(search_term),
                models.Family.husband_surname.op("%")(query_text),
                models.Family.husband_surname.ilike(search_term),
                models.Family.wife_name.op("%")(query_text),
                models.Family.wife_name.ilike(search_term),
                models.Family.wife_surname.op("%")(query_text),
                models.Family.wife_surname.ilike(search_term),
                models.Family.place_of_marriage.op("%")(query_text),
                models.Family.place_of_marriage.ilike(search_term),
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
    skip: int = 0,
    limit: int = 100,
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text("SELECT set_limit(0.3);"))
    db.commit()

    query = db.query(models.Birth)

    if name:
        query = query.filter(
            or_(
                models.Birth.name.op("%")(cast(name, Text)),
                models.Birth.name.ilike(f"%{name}%"),
            )
        )
    if surname:
        query = query.filter(
            or_(
                models.Birth.surname.op("%")(cast(surname, Text)),
                models.Birth.surname.ilike(f"%{surname}%"),
            )
        )
    if place_of_birth:
        query = query.filter(
            or_(
                models.Birth.place_of_birth.op("%")(cast(place_of_birth, Text)),
                models.Birth.place_of_birth.ilike(f"%{place_of_birth}%"),
            )
        )
    if date_of_birth:
        query = query.filter(models.Birth.date_of_birth.ilike(f"%{date_of_birth}%"))

    return query.offset(skip).limit(limit).all()


def search_advanced_families(
    db: Session,
    husband_name: str = None,
    husband_surname: str = None,
    wife_name: str = None,
    wife_surname: str = None,
    date_of_marriage: str = None,
    place_of_marriage: str = None,
    skip: int = 0,
    limit: int = 100,
):
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text("SELECT set_limit(0.3);"))
    db.commit()

    query = db.query(models.Family)

    if husband_name:
        query = query.filter(
            or_(
                models.Family.husband_name.op("%")(cast(husband_name, Text)),
                models.Family.husband_name.ilike(f"%{husband_name}%"),
            )
        )
    if husband_surname:
        query = query.filter(
            or_(
                models.Family.husband_surname.op("%")(cast(husband_surname, Text)),
                models.Family.husband_surname.ilike(f"%{husband_surname}%"),
            )
        )
    if wife_name:
        query = query.filter(
            or_(
                models.Family.wife_name.op("%")(cast(wife_name, Text)),
                models.Family.wife_name.ilike(f"%{wife_name}%"),
            )
        )
    if wife_surname:
        query = query.filter(
            or_(
                models.Family.wife_surname.op("%")(cast(wife_surname, Text)),
                models.Family.wife_surname.ilike(f"%{wife_surname}%"),
            )
        )
    if place_of_marriage:
        query = query.filter(
            or_(
                models.Family.place_of_marriage.op("%")(cast(place_of_marriage, Text)),
                models.Family.place_of_marriage.ilike(f"%{place_of_marriage}%"),
            )
        )
    if date_of_marriage:
        query = query.filter(
            models.Family.date_of_marriage.ilike(f"%{date_of_marriage}%")
        )

    return query.offset(skip).limit(limit).all()
