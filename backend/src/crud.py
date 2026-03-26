from sqlalchemy.orm import Session
from sqlalchemy import func, or_, text
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

    births = (
        db.query(models.Birth)
        .filter(
            or_(
                models.Birth.name.op("%")(query),
                models.Birth.surname.op("%")(query),
                models.Birth.place_of_birth.op("%")(query),
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
                models.Family.husband_name.op("%")(query),
                models.Family.husband_surname.op("%")(query),
                models.Family.wife_name.op("%")(query),
                models.Family.wife_surname.op("%")(query),
                models.Family.place_of_marriage.op("%")(query),
                models.Family.date_of_marriage.ilike(search_term),
            )
        )
        .offset(skip)
        .limit(limit)
        .all()
    )

    return {"births": births, "families": families}
