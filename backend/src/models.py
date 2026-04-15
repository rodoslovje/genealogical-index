from sqlalchemy import Column, Integer, Text
from .database import Base


class Birth(Base):
    __tablename__ = "births"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, index=True)
    surname = Column(Text, index=True)
    date_of_birth = Column(Text)
    place_of_birth = Column(Text)
    father_name = Column(Text)
    father_surname = Column(Text)
    mother_name = Column(Text)
    mother_surname = Column(Text)
    contributor = Column(Text, index=True)
    links = Column(Text)


class Family(Base):
    __tablename__ = "families"

    id = Column(Integer, primary_key=True, index=True)
    husband_name = Column(Text, index=True)
    husband_surname = Column(Text, index=True)
    wife_name = Column(Text, index=True)
    wife_surname = Column(Text, index=True)
    children_list = Column(Text)
    husband_parents = Column(Text)
    wife_parents = Column(Text)
    date_of_marriage = Column(Text)
    place_of_marriage = Column(Text)
    contributor = Column(Text, index=True)
    links = Column(Text)


class Death(Base):
    __tablename__ = "deaths"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, index=True)
    surname = Column(Text, index=True)
    date_of_death = Column(Text)
    place_of_death = Column(Text)
    father_name = Column(Text)
    father_surname = Column(Text)
    mother_name = Column(Text)
    mother_surname = Column(Text)
    contributor = Column(Text, index=True)
    links = Column(Text)


class Contributor(Base):
    __tablename__ = "contributors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, unique=True, index=True)
    last_modified = Column(Text)
    births_count = Column(Integer, default=0)
    families_count = Column(Integer, default=0)
    deaths_count = Column(Integer, default=0)
    links_count = Column(Integer, default=0)
