from pydantic import BaseModel


class BirthBase(BaseModel):
    name: str
    surname: str
    date_of_birth: str
    place_of_birth: str
    contributor: str


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


class Family(FamilyBase):
    id: int

    class Config:
        from_attributes = True


class Contributor(BaseModel):
    name: str
    last_modified: str
    births_count: int
    families_count: int
