from typing import List, Optional
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.orm import Session

from . import crud, models, schemas
from .database import SessionLocal, engine

# Create database tables
models.Base.metadata.create_all(bind=engine)

# Initialize the FastAPI app
app = FastAPI()


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


@app.get("/api/search/general")
def search_general(q: Optional[str] = None, db: Session = Depends(get_db)):
    if not q:
        return {"births": [], "families": []}

    results = crud.search_all(db, query=q)
    return results
