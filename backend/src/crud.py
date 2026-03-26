from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text, cast, Text
from . import models


def get_contributors(db: Session):
    results = []
    contributors = db.query(models.Contributor).all()
    for contributor in contributors:
        births_count = (
            db.query(models.Birth)
            .filter(models.Birth.contributor == contributor.name)
            .count()
        )
        families_count = (
            db.query(models.Family)
            .filter(models.Family.contributor == contributor.name)
            .count()
        )
        results.append(
            {
                "name": contributor.name,
                "last_modified": contributor.last_modified,
                "births_count": births_count,
                "families_count": families_count,
            }
        )
    return results


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
                models.Birth.surname.op("%")(query_text),
                models.Birth.place_of_birth.op("%")(query_text),
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
                models.Family.husband_surname.op("%")(query_text),
                models.Family.wife_name.op("%")(query_text),
                models.Family.wife_surname.op("%")(query_text),
                models.Family.place_of_marriage.op("%")(query_text),
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
        query = query.filter(models.Birth.name.op("%")(cast(name, Text)))
    if surname:
        query = query.filter(models.Birth.surname.op("%")(cast(surname, Text)))
    if place_of_birth:
        query = query.filter(
            models.Birth.place_of_birth.op("%")(cast(place_of_birth, Text))
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
            models.Family.husband_name.op("%")(cast(husband_name, Text))
        )
    if husband_surname:
        query = query.filter(
            models.Family.husband_surname.op("%")(cast(husband_surname, Text))
        )
    if wife_name:
        query = query.filter(models.Family.wife_name.op("%")(cast(wife_name, Text)))
    if wife_surname:
        query = query.filter(
            models.Family.wife_surname.op("%")(cast(wife_surname, Text))
        )
    if place_of_marriage:
        query = query.filter(
            models.Family.place_of_marriage.op("%")(cast(place_of_marriage, Text))
        )
    if date_of_marriage:
        query = query.filter(
            models.Family.date_of_marriage.ilike(f"%{date_of_marriage}%")
        )

    return query.offset(skip).limit(limit).all()
