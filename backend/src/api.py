from typing import List, Optional
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import SessionLocal, engine

# Create database tables
models.Base.metadata.create_all(bind=engine)

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


@app.get("/api/contributors/", response_model=List[schemas.Contributor])
def read_contributors(db: Session = Depends(get_db)):
    return crud.get_contributors(db)


@app.get("/api/search/general", response_model=schemas.GeneralSearchResponse)
def search_general(
    q: Optional[str] = None,
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    place: Optional[str] = None,
    contributor: Optional[str] = None,
    has_link: bool = False,
    limit: int = 500,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    if not any([q, name, surname, date_from, date_to, place, contributor]):
        return {"births": [], "families": [], "deaths": []}
    return crud.search_all(
        db,
        query=q,
        name=name,
        surname=surname,
        date_from=date_from,
        date_to=date_to,
        place=place,
        contributor=contributor,
        has_link=has_link,
        limit=limit,
        exact=exact,
    )


@app.get("/api/search/advanced/births", response_model=List[schemas.Birth])
def search_advanced_births(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_of_birth: Optional[str] = None,
    date_of_birth_to: Optional[str] = None,
    place_of_birth: Optional[str] = None,
    contributor: Optional[str] = None,
    has_link: bool = False,
    limit: int = 500,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    return crud.search_advanced_births(
        db,
        name,
        surname,
        date_of_birth,
        date_of_birth_to=date_of_birth_to,
        place_of_birth=place_of_birth,
        contributor=contributor,
        has_link=has_link,
        limit=limit,
        exact=exact,
    )


@app.get("/api/search/advanced/families", response_model=List[schemas.Family])
def search_advanced_families(
    husband_name: Optional[str] = None,
    husband_surname: Optional[str] = None,
    wife_name: Optional[str] = None,
    wife_surname: Optional[str] = None,
    children: Optional[str] = None,
    date_of_marriage: Optional[str] = None,
    date_of_marriage_to: Optional[str] = None,
    place_of_marriage: Optional[str] = None,
    contributor: Optional[str] = None,
    has_link: bool = False,
    limit: int = 500,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    return crud.search_advanced_families(
        db,
        husband_name,
        husband_surname,
        wife_name,
        wife_surname,
        children,
        date_of_marriage,
        date_of_marriage_to=date_of_marriage_to,
        place_of_marriage=place_of_marriage,
        contributor=contributor,
        has_link=has_link,
        limit=limit,
        exact=exact,
    )


@app.get("/api/search/advanced/deaths", response_model=List[schemas.Death])
def search_advanced_deaths(
    name: Optional[str] = None,
    surname: Optional[str] = None,
    date_of_death: Optional[str] = None,
    date_of_death_to: Optional[str] = None,
    place_of_death: Optional[str] = None,
    contributor: Optional[str] = None,
    has_link: bool = False,
    limit: int = 500,
    exact: bool = False,
    db: Session = Depends(get_db),
):
    return crud.search_advanced_deaths(
        db,
        name,
        surname,
        date_of_death,
        date_of_death_to=date_of_death_to,
        place_of_death=place_of_death,
        contributor=contributor,
        has_link=has_link,
        limit=limit,
        exact=exact,
    )
