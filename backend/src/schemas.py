from typing import List, Optional
from pydantic import BaseModel


class BirthBase(BaseModel):
    name: str
    surname: str
    date_of_birth: str
    place_of_birth: str
    father_name: Optional[str] = None
    father_surname: Optional[str] = None
    mother_name: Optional[str] = None
    mother_surname: Optional[str] = None
    contributor: str
    links: Optional[str] = None


class Birth(BirthBase):
    id: int

    class Config:
        from_attributes = True


class FamilyBase(BaseModel):
    husband_name: str
    husband_surname: str
    wife_name: str
    wife_surname: str
    children_list: Optional[str] = None
    husband_parents: Optional[str] = None
    wife_parents: Optional[str] = None
    date_of_marriage: str
    place_of_marriage: str
    contributor: str
    links: Optional[str] = None


class Family(FamilyBase):
    id: int

    class Config:
        from_attributes = True


class DeathBase(BaseModel):
    name: str
    surname: str
    date_of_death: str
    place_of_death: str
    father_name: Optional[str] = None
    father_surname: Optional[str] = None
    mother_name: Optional[str] = None
    mother_surname: Optional[str] = None
    contributor: str
    links: Optional[str] = None


class Death(DeathBase):
    id: int

    class Config:
        from_attributes = True


class GeneralSearchResponse(BaseModel):
    births: List[Birth]
    families: List[Family]
    deaths: List[Death]


class TimelineStat(BaseModel):
    year: int
    births: int = 0
    marriages: int = 0
    deaths: int = 0


class Contributor(BaseModel):
    name: str
    last_modified: str
    births_count: int
    families_count: int
    deaths_count: int
    links_count: int
    url: Optional[str] = None

    class Config:
        from_attributes = True


class SurnameStat(BaseModel):
    surname: str
    count: int
