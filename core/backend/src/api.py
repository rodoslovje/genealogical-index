import os
from typing import List, Optional
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import jwt
from sqlalchemy import text

from . import crud, models, schemas
from .database import SessionLocal, engine

# Optional JWT auth. When JWT_SECRET is unset (test/cro deployments) the
# `require_user` dependency is a no-op so the API stays open. On the Slovenia
# deployment we set JWT_SECRET to the WordPress `JWT_AUTH_SECRET_KEY` so tokens
# issued by the JWT Authentication for WP REST API plugin can be verified here.
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"

# Create database tables
models.Base.metadata.create_all(bind=engine)

# pg_trgm is required for the trigram operators used in search. Doing this
# once at startup avoids a per-request roundtrip from inside _set_trgm.
with engine.connect() as _conn:
    _conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    _conn.commit()

# Initialize the FastAPI app
app = FastAPI()

# Configure CORS so the frontend can make requests to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "*"
    ],  # In production, replace "*" with your frontend domain e.g., ["https://sgi.renko.fyi"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_user(authorization: Optional[str] = Header(None)):
    if not JWT_SECRET:
        return None
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.post("/api/cache/clear")
def clear_cache():
    """
    Manually clear the server's in-memory caches for timeline, top surnames,
    and match counts. Useful after a data import.
    """
    return crud.clear_all_caches()


@app.get("/api/contributors/", response_model=List[schemas.Contributor])
def read_contributors(db: Session = Depends(get_db)):
    return crud.get_contributors(db)


@app.get("/api/matches/counts", response_model=List[schemas.MatchCount])
def get_match_counts(db: Session = Depends(get_db)):
    return crud.get_match_counts(db)


@app.get("/api/contributors/{name}/matches", response_model=List[schemas.MatchPartner])
def get_contributor_matches(name: str, db: Session = Depends(get_db)):
    return crud.get_contributor_matches(db, name)


@app.get(
    "/api/contributors/{name}/matricula",
    response_model=List[schemas.MatriculaBook],
)
def get_contributor_matricula(name: str, db: Session = Depends(get_db)):
    return crud.get_matricula_books(db, name)


@app.get("/api/matricula/stats")
def get_matricula_stats(db: Session = Depends(get_db)):
    return crud.get_matricula_stats(db)


@app.get("/api/contributors/{name}/matches/{other}")
def get_contributor_match_detail(
    name: str,
    other: str,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    return crud.get_contributor_match_detail(db, name, other)


@app.get("/api/stats/timeline", response_model=List[schemas.TimelineStat])
def read_timeline(db: Session = Depends(get_db)):
    return crud.get_timeline_distribution(db)


@app.get("/api/stats/top_surnames", response_model=List[schemas.SurnameStat])
def read_top_surnames(
    contributor: Optional[str] = None,
    contributors: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    contributor_list = None
    if contributors:
        contributor_list = [c.strip() for c in contributors.split(",") if c.strip()]
    elif contributor:
        contributor_list = [contributor]
    return crud.get_top_surnames(db, contributors=contributor_list, limit=limit)


@app.get("/api/search/general", response_model=schemas.GeneralSearchResponse)
def search_general(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    place: Optional[str] = None,
    contributor: Optional[str] = None,
    source: str = "all",
    has_link: bool = False,
    id: Optional[str] = None,
    limit: int = 999,
    exact: bool = False,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not any([name, surname, date_from, date_to, place, contributor, has_link, id]):
        return {"persons": [], "families": []}
    return crud.search_all(
        db,
        name=name,
        surname=surname,
        date_from=date_from,
        date_to=date_to,
        place=place,
        contributor=contributor,
        source=source,
        has_link=has_link,
        ext_id=id,
        limit=limit,
        exact=exact,
        record_type=type,
    )


@app.get("/api/search/advanced/persons", response_model=List[schemas.Person])
def search_advanced_persons(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    date_of_birth_to: Optional[str] = None,
    place_of_birth: Optional[str] = None,
    date_of_death: Optional[str] = None,
    date_of_death_to: Optional[str] = None,
    place_of_death: Optional[str] = None,
    contributor: Optional[str] = None,
    source: str = "all",
    has_link: bool = False,
    id: Optional[str] = None,
    limit: int = 999,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    return crud.search_advanced_persons(
        db,
        name=name,
        surname=surname,
        date_of_birth=date_of_birth,
        date_of_birth_to=date_of_birth_to,
        place_of_birth=place_of_birth,
        date_of_death=date_of_death,
        date_of_death_to=date_of_death_to,
        place_of_death=place_of_death,
        contributor=contributor,
        source=source,
        has_link=has_link,
        ext_id=id,
        limit=limit,
        exact=exact,
    )


@app.get("/api/persons/{person_id}/ancestors")
def get_person_ancestors(
    person_id: int,
    max_generations: int = 5,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    return crud.get_ancestors_tree(db, person_id, max_generations)


@app.get("/api/persons/{person_id}/descendants")
def get_person_descendants(
    person_id: int,
    max_generations: int = 5,
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    return crud.get_descendants_tree(db, person_id, max_generations)


@app.get("/api/compare/ancestors")
def compare_ancestors(
    a_id: int,
    b_id: int,
    max_generations: int = 0,  # 0 = all generations
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    """Compare the ancestor trees of two matched persons (one per genealogist).
    `a_id` / `b_id` are Person row ids from the match-detail pair view."""
    return crud.compare_trees(
        db, a_id, b_id, direction="ancestors", max_generations=max_generations
    )


@app.get("/api/descendants")
def get_descendants_by_params(
    n: Optional[str] = None,
    sn: Optional[str] = None,
    dob: Optional[str] = None,
    c: Optional[str] = None,
    id: Optional[str] = None,
    max_generations: int = 0,  # 0 = all generations (the web tree pages)
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    if not c:
        return None

    parent_info = {"name": n, "surname": sn}
    if id:
        parent_info["id"] = id
    if dob:
        if len(dob.strip()) == 4 and dob.strip().isdigit():
            parent_info["year"] = dob
        else:
            parent_info["date_of_birth"] = dob

    person = crud.find_parent_record(db, parent_info, c)

    if not person:
        return None

    return crud.get_descendants_tree(db, person.id, max_generations)


@app.get("/api/search/advanced/families", response_model=List[schemas.Family])
def search_advanced_families(
    husband_name: Optional[str] = None,
    husband_surname: Optional[str] = None,
    husband_birth: Optional[str] = None,
    husband_birth_to: Optional[str] = None,
    wife_name: Optional[str] = None,
    wife_surname: Optional[str] = None,
    wife_birth: Optional[str] = None,
    wife_birth_to: Optional[str] = None,
    children: Optional[str] = None,
    date_of_marriage: Optional[str] = None,
    date_of_marriage_to: Optional[str] = None,
    place_of_marriage: Optional[str] = None,
    contributor: Optional[str] = None,
    source: str = "all",
    has_link: bool = False,
    limit: int = 999,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    return crud.search_advanced_families(
        db,
        husband_name=husband_name,
        husband_surname=husband_surname,
        husband_birth=husband_birth,
        husband_birth_to=husband_birth_to,
        wife_name=wife_name,
        wife_surname=wife_surname,
        wife_birth=wife_birth,
        wife_birth_to=wife_birth_to,
        children=children,
        date_of_marriage=date_of_marriage,
        date_of_marriage_to=date_of_marriage_to,
        place_of_marriage=place_of_marriage,
        contributor=contributor,
        source=source,
        has_link=has_link,
        limit=limit,
        exact=exact,
    )


@app.get("/api/ancestors")
def get_ancestors_by_params(
    n: Optional[str] = None,
    sn: Optional[str] = None,
    dob: Optional[str] = None,
    c: Optional[str] = None,
    id: Optional[str] = None,
    max_generations: int = 0,  # 0 = all generations (the web tree pages)
    db: Session = Depends(get_db),
    user: Optional[dict] = Depends(require_user),
):
    if not c:
        return None

    parent_info = {"name": n, "surname": sn}
    if id:
        parent_info["id"] = id
    if dob:
        if len(dob.strip()) == 4 and dob.strip().isdigit():
            parent_info["year"] = dob
        else:
            parent_info["date_of_birth"] = dob

    person = crud.find_parent_record(db, parent_info, c)

    if not person:
        return None

    return crud.get_ancestors_tree(db, person.id, max_generations)
