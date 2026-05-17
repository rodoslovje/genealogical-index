from typing import List, Optional, Any
from pydantic import BaseModel


class PersonBase(BaseModel):
    ext_id: Optional[str] = None
    name: Optional[str] = None
    surname: Optional[str] = None
    alt_surname: Optional[str] = None
    sex: Optional[str] = None
    date_of_birth: Optional[str] = None
    place_of_birth: Optional[str] = None
    date_of_baptism: Optional[str] = None
    place_of_baptism: Optional[str] = None
    date_of_death: Optional[str] = None
    place_of_death: Optional[str] = None
    parents_list: Optional[Any] = None
    partners_list: Optional[Any] = None
    notes: Optional[str] = None
    contributor: Optional[str] = None
    links: Optional[Any] = None


class Person(PersonBase):
    id: int

    class Config:
        from_attributes = True


class FamilyBase(BaseModel):
    husband_ext_id: Optional[str] = None
    husband_name: Optional[str] = None
    husband_surname: Optional[str] = None
    husband_alt_surname: Optional[str] = None
    husband_birth: Optional[str] = None
    wife_ext_id: Optional[str] = None
    wife_name: Optional[str] = None
    wife_surname: Optional[str] = None
    wife_alt_surname: Optional[str] = None
    wife_birth: Optional[str] = None
    children_list: Optional[Any] = None
    husband_parents: Optional[Any] = None
    wife_parents: Optional[Any] = None
    date_of_marriage: Optional[str] = None
    place_of_marriage: Optional[str] = None
    notes: Optional[str] = None
    contributor: Optional[str] = None
    links: Optional[Any] = None


class Family(FamilyBase):
    id: int

    class Config:
        from_attributes = True


class GeneralSearchResponse(BaseModel):
    persons: List[Person]
    families: List[Family]


class TimelineStat(BaseModel):
    year: int
    births: int = 0
    marriages: int = 0
    deaths: int = 0


class ContributorPart(BaseModel):
    name: str
    last_modified: str
    persons_count: int
    families_count: int
    links_count: int
    url: Optional[str] = None


class Contributor(BaseModel):
    name: str
    last_modified: str
    persons_count: int
    families_count: int
    links_count: int
    url: Optional[str] = None
    tree: Optional[ContributorPart] = None
    matricula: Optional[ContributorPart] = None

    class Config:
        from_attributes = True


class SurnameStat(BaseModel):
    surname: str
    count: int


class MatchPartner(BaseModel):
    contributor: str
    persons_count: int = 0
    families_count: int = 0
    total_count: int = 0
    max_confidence: float = 0.0
    computed_at: Optional[str] = None

    class Config:
        from_attributes = True


class MatchCount(BaseModel):
    contributor: str
    partners_count: int = 0
