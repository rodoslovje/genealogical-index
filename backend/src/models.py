from sqlalchemy import Column, Integer, String, Text
from .database import Base


class Birth(Base):
    __tablename__ = "births"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    surname = Column(String, index=True)
    date_of_birth = Column(String)
    place_of_birth = Column(Text)
    contributor = Column(String, index=True)


class Family(Base):
    __tablename__ = "families"

    id = Column(Integer, primary_key=True, index=True)
    husband_name = Column(String, index=True)
    husband_surname = Column(String, index=True)
    wife_name = Column(String, index=True)
    wife_surname = Column(String, index=True)
    date_of_marriage = Column(String)
    place_of_marriage = Column(Text)
    contributor = Column(String, index=True)


class Contributor(Base):
    __tablename__ = "contributors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    last_modified = Column(String)
