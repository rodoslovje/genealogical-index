from sqlalchemy import Column, Integer, Text, Float, DateTime, SmallInteger
import datetime
from .database import Base


class Person(Base):
    __tablename__ = "persons"

    id = Column(Integer, primary_key=True, index=True)
    ext_id = Column(Text)
    name = Column(Text, index=True)
    surname = Column(Text, index=True)
    alt_surname = Column(Text)
    sex = Column(Text)
    date_of_birth = Column(Text)
    birth_year = Column(SmallInteger)
    place_of_birth = Column(Text)
    date_of_baptism = Column(Text)
    place_of_baptism = Column(Text)
    date_of_death = Column(Text)
    death_year = Column(SmallInteger)
    place_of_death = Column(Text)
    parents_list = Column(Text, nullable=True)
    partners_list = Column(Text, nullable=True)
    notes = Column(Text)
    contributor = Column(Text, index=True)
    links = Column(Text)


class Family(Base):
    __tablename__ = "families"

    id = Column(Integer, primary_key=True, index=True)
    husband_ext_id = Column(Text)
    husband_name = Column(Text, index=True)
    husband_surname = Column(Text, index=True)
    husband_alt_surname = Column(Text)
    husband_birth = Column(Text)
    wife_ext_id = Column(Text)
    wife_name = Column(Text, index=True)
    wife_surname = Column(Text, index=True)
    wife_alt_surname = Column(Text)
    wife_birth = Column(Text)
    date_of_marriage = Column(Text)
    marriage_year = Column(SmallInteger)
    place_of_marriage = Column(Text)
    children_list = Column(Text)
    husband_parents = Column(Text)
    wife_parents = Column(Text)
    notes = Column(Text)
    contributor = Column(Text, index=True)
    links = Column(Text)


class Contributor(Base):
    __tablename__ = "contributors"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, unique=True, index=True)
    last_modified = Column(Text)
    persons_count = Column(Integer, default=0)
    families_count = Column(Integer, default=0)
    links_count = Column(Integer, default=0)


class MatchJob(Base):
    __tablename__ = "match_jobs"

    contributor = Column(Text, primary_key=True)
    status = Column(Text, default="pending")
    queued_at = Column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
    completed_at = Column(DateTime, nullable=True)


class Match(Base):
    __tablename__ = "matches"

    id = Column(Integer, primary_key=True, index=True)
    contributor_a = Column(Text, index=True)
    contributor_b = Column(Text, index=True)
    record_type = Column(Text)
    record_a_id = Column(Integer)
    record_b_id = Column(Integer)
    confidence = Column(Float)
    match_fields = Column(Text)
    computed_at = Column(
        DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)
    )
