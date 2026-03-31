from typing import Optional
from pydantic import BaseModel


class BirthBase(BaseModel):
    name: str
    surname: str
    date_of_birth: str
    place_of_birth: str
    contributor: str
    link: Optional[str] = None


class Birth(BirthBase):
    id: int

    class Config:
        from_attributes = True


class FamilyBase(BaseModel):
    husband_name: str
    husband_surname: str
    wife_name: str
    wife_surname: str
    date_of_marriage: str
    place_of_marriage: str
    contributor: str
    link: Optional[str] = None


class Family(FamilyBase):
    id: int

    class Config:
        from_attributes = True


class DeathBase(BaseModel):
    name: str
    surname: str
    date_of_death: str
    place_of_death: str
    contributor: str
    link: Optional[str] = None


class Death(DeathBase):
    id: int

    class Config:
        from_attributes = True


class Contributor(BaseModel):
    name: str
    last_modified: str
    births_count: int
    families_count: int
    deaths_count: int
    links_count: int
