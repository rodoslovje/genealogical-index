import argparse
import os
import json
import re
import unicodedata
from sqlalchemy import create_engine, text
import urllib.request
import urllib.error
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

DATA_DIR = "data/output"

# --- Database Setup ---
try:
    load_dotenv("../.env")
except Exception:
    pass

if os.getenv("POSTGRES_USER") and os.getenv("POSTGRES_DB"):
    import urllib.parse

    _db_host = os.getenv(
        "POSTGRES_HOST", "db" if os.path.exists("/.dockerenv") else "localhost"
    )
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{urllib.parse.quote(os.getenv('POSTGRES_PASSWORD', ''))}@{_db_host}:5432/{os.getenv('POSTGRES_DB')}"
else:
    DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    os.environ["DATABASE_URL"] = DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_full(db):
    """Drop and recreate all tables (full mode)."""
    print("Setting up database tables and extensions (full rebuild)...")
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text("""
        DROP TABLE IF EXISTS persons, births, families, deaths, contributors, match_jobs, matches CASCADE;

        CREATE TABLE contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255),
            persons_count INTEGER DEFAULT 0,
            families_count INTEGER DEFAULT 0,
            links_count INTEGER DEFAULT 0
        );
        CREATE TABLE persons (
            id SERIAL PRIMARY KEY, ext_id TEXT,
            name TEXT, surname TEXT, alt_surname TEXT, sex TEXT,
            date_of_birth TEXT, birth_year SMALLINT, place_of_birth TEXT,
            date_of_baptism TEXT, place_of_baptism TEXT,
            date_of_death TEXT, death_year SMALLINT, place_of_death TEXT,
            parents_list TEXT, partners_list TEXT,
            notes TEXT, contributor TEXT, links TEXT
        );
        CREATE TABLE families (
            id SERIAL PRIMARY KEY,
            husband_ext_id TEXT, husband_name TEXT, husband_surname TEXT,
            husband_alt_surname TEXT, husband_birth TEXT,
            wife_ext_id TEXT, wife_name TEXT, wife_surname TEXT,
            wife_alt_surname TEXT, wife_birth TEXT,
            date_of_marriage TEXT, marriage_year SMALLINT, place_of_marriage TEXT,
            children_list TEXT, husband_parents TEXT, wife_parents TEXT,
            notes TEXT, contributor TEXT, links TEXT
        );

        CREATE INDEX idx_person_name_trgm    ON persons  USING gist (name gist_trgm_ops);
        CREATE INDEX idx_person_surname_trgm ON persons  USING gist (surname gist_trgm_ops);
        CREATE INDEX idx_family_h_surname_trgm   ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX idx_family_w_surname_trgm   ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX idx_family_children_list_trgm ON families USING gist (children_list gist_trgm_ops);

        -- Composite indexes allow instantaneous Index-Only Scans for DISTINCT surnames
        -- and fast equality joins during the match compute phase.
        CREATE INDEX idx_person_contrib_sur  ON persons(contributor, surname);
        CREATE INDEX idx_family_contrib_surs ON families(contributor, husband_surname, wife_surname);

        -- Partial indexes on alt_surname columns: the column is sparsely populated,
        -- so a partial index keeps it tiny while still supporting the OR-join in
        -- compute_matches (surname = X OR alt_surname = X).
        CREATE INDEX idx_person_contrib_alt_sur
            ON persons(contributor, alt_surname) WHERE alt_surname <> '';
        CREATE INDEX idx_family_contrib_h_alt_sur
            ON families(contributor, husband_alt_surname) WHERE husband_alt_surname <> '';
        CREATE INDEX idx_family_contrib_w_alt_sur
            ON families(contributor, wife_alt_surname) WHERE wife_alt_surname <> '';

        -- B-tree indexes on year columns — used to pre-filter candidates by year range
        -- before the trigram similarity join, significantly reducing the candidate set.
        CREATE INDEX idx_person_birth_year ON persons(birth_year);
        CREATE INDEX idx_person_ancestor_search ON persons(contributor, surname, name, birth_year);
        CREATE INDEX idx_person_death_year ON persons(death_year);
        CREATE INDEX idx_family_year       ON families(marriage_year);

        -- Indexes for finding families for descendants tree
        CREATE INDEX idx_family_descendant_h_search ON families(contributor, husband_surname, husband_name);
        CREATE INDEX idx_family_descendant_w_search ON families(contributor, wife_surname, wife_name);

        CREATE TABLE match_jobs (
            contributor_a TEXT NOT NULL,
            contributor_b TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            queued_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            PRIMARY KEY (contributor_a, contributor_b)
        );
        CREATE INDEX idx_match_jobs_status ON match_jobs(status, queued_at);
        CREATE TABLE matches (
            id SERIAL PRIMARY KEY,
            contributor_a TEXT NOT NULL,
            contributor_b TEXT NOT NULL,
            record_type TEXT NOT NULL,
            record_a_id INTEGER NOT NULL,
            record_b_id INTEGER NOT NULL,
            confidence REAL NOT NULL,
            match_fields TEXT,
            computed_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX idx_matches_b  ON matches(contributor_b);
        CREATE INDEX idx_matches_ab ON matches(contributor_a, contributor_b);
    """))
    db.commit()


def _col_exists(db, table, column):
    return (
        db.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name=:t AND column_name=:c"
            ),
            {"t": table, "c": column},
        ).fetchone()
        is not None
    )


def _table_exists(db, table):
    return (
        db.execute(
            text("SELECT 1 FROM information_schema.tables WHERE table_name=:t"),
            {"t": table},
        ).fetchone()
        is not None
    )


def setup_update(db):
    """Migrate from old (births/deaths) schema to new persons schema, or create from scratch."""
    print("Setting up database tables and extensions (update mode)...")

    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.commit()

    # Detect legacy schema and drop it — the data shape change is fundamental,
    # so we discard births/deaths/old matches and re-import everything.
    if _table_exists(db, "births") or _table_exists(db, "deaths"):
        print(
            "  Legacy schema detected — dropping old births/deaths tables and matches."
        )
        db.execute(text("""
            DROP TABLE IF EXISTS births CASCADE;
            DROP TABLE IF EXISTS deaths CASCADE;
            TRUNCATE matches;
            DELETE FROM match_jobs;
        """))
        db.commit()

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255)
        );
        CREATE TABLE IF NOT EXISTS persons (
            id SERIAL PRIMARY KEY, ext_id TEXT,
            name TEXT, surname TEXT, alt_surname TEXT, sex TEXT,
            date_of_birth TEXT, birth_year SMALLINT, place_of_birth TEXT,
            date_of_baptism TEXT, place_of_baptism TEXT,
            date_of_death TEXT, death_year SMALLINT, place_of_death TEXT,
            parents_list TEXT, partners_list TEXT,
            notes TEXT, contributor TEXT, links TEXT
        );
        CREATE TABLE IF NOT EXISTS families (
            id SERIAL PRIMARY KEY,
            husband_ext_id TEXT, husband_name TEXT, husband_surname TEXT,
            husband_alt_surname TEXT, husband_birth TEXT,
            wife_ext_id TEXT, wife_name TEXT, wife_surname TEXT,
            wife_alt_surname TEXT, wife_birth TEXT,
            date_of_marriage TEXT, marriage_year SMALLINT, place_of_marriage TEXT,
            children_list TEXT, husband_parents TEXT, wife_parents TEXT,
            notes TEXT, contributor TEXT, links TEXT
        );
        CREATE TABLE IF NOT EXISTS matches (
            id SERIAL PRIMARY KEY,
            contributor_a TEXT NOT NULL,
            contributor_b TEXT NOT NULL,
            record_type TEXT NOT NULL,
            record_a_id INTEGER NOT NULL,
            record_b_id INTEGER NOT NULL,
            confidence REAL NOT NULL,
            match_fields TEXT,
            computed_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS match_jobs (
            contributor_a TEXT NOT NULL,
            contributor_b TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            queued_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            PRIMARY KEY (contributor_a, contributor_b)
        );
    """))
    db.commit()

    # contributors column migration: drop births_count/deaths_count, add persons_count
    db.execute(text("""
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS persons_count  INTEGER DEFAULT 0;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS families_count INTEGER DEFAULT 0;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS links_count    INTEGER DEFAULT 0;
        ALTER TABLE contributors DROP COLUMN IF EXISTS births_count;
        ALTER TABLE contributors DROP COLUMN IF EXISTS deaths_count;

        ALTER TABLE families ADD COLUMN IF NOT EXISTS husband_birth TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS wife_birth    TEXT;
        ALTER TABLE families DROP COLUMN IF EXISTS husband_year;
        ALTER TABLE families DROP COLUMN IF EXISTS wife_year;

        -- New optional fields imported from richer JSON exports.
        ALTER TABLE persons  ADD COLUMN IF NOT EXISTS ext_id           TEXT;
        ALTER TABLE persons  ADD COLUMN IF NOT EXISTS alt_surname      TEXT;
        ALTER TABLE persons  ADD COLUMN IF NOT EXISTS date_of_baptism  TEXT;
        ALTER TABLE persons  ADD COLUMN IF NOT EXISTS place_of_baptism TEXT;
        ALTER TABLE persons  ADD COLUMN IF NOT EXISTS notes            TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS husband_ext_id      TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS husband_alt_surname TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS wife_ext_id         TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS wife_alt_surname    TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS notes               TEXT;
    """))
    db.commit()

    db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_person_name_trgm        ON persons  USING gist (name gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_person_surname_trgm     ON persons  USING gist (surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_h_surname_trgm   ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_w_surname_trgm   ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_children_list_trgm ON families USING gist (children_list gist_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_person_contrib_sur      ON persons(contributor, surname);
        CREATE INDEX IF NOT EXISTS idx_family_contrib_surs     ON families(contributor, husband_surname, wife_surname);

        -- Partial indexes for alt_surname matches (sparse column → tiny index).
        CREATE INDEX IF NOT EXISTS idx_person_contrib_alt_sur
            ON persons(contributor, alt_surname) WHERE alt_surname <> '';
        CREATE INDEX IF NOT EXISTS idx_family_contrib_h_alt_sur
            ON families(contributor, husband_alt_surname) WHERE husband_alt_surname <> '';
        CREATE INDEX IF NOT EXISTS idx_family_contrib_w_alt_sur
            ON families(contributor, wife_alt_surname) WHERE wife_alt_surname <> '';

        CREATE INDEX IF NOT EXISTS idx_person_ancestor_search  ON persons(contributor, surname, name, birth_year);
        CREATE INDEX IF NOT EXISTS idx_person_birth_year       ON persons(birth_year);
        CREATE INDEX IF NOT EXISTS idx_person_death_year       ON persons(death_year);
        CREATE INDEX IF NOT EXISTS idx_family_year             ON families(marriage_year);

        -- Indexes for finding families for descendants tree
        CREATE INDEX IF NOT EXISTS idx_family_descendant_h_search ON families(contributor, husband_surname, husband_name);
        CREATE INDEX IF NOT EXISTS idx_family_descendant_w_search ON families(contributor, wife_surname, wife_name);

        CREATE INDEX IF NOT EXISTS idx_matches_b  ON matches(contributor_b);
        CREATE INDEX IF NOT EXISTS idx_matches_ab ON matches(contributor_a, contributor_b);
        CREATE INDEX IF NOT EXISTS idx_match_jobs_status ON match_jobs(status, queued_at);
    """))
    db.commit()


def get_db_state(db, contributor_name):
    """Returns pre-calculated stats stored in DB, or (None, 0, 0, 0)."""
    row = db.execute(
        text(
            "SELECT last_modified, persons_count, families_count, links_count FROM contributors WHERE name = :name"
        ),
        {"name": contributor_name},
    ).fetchone()
    if not row:
        return None, 0, 0, 0
    return row[0], row[1], row[2], row[3]


def find_data_file(directory, filename):
    """
    Find a file in the directory, falling back to case-insensitive,
    Unicode-insensitive matching, and an aggressive alphanumeric fallback.
    """
    exact_path = os.path.join(directory, filename)
    if os.path.exists(exact_path):
        return exact_path

    if os.path.isdir(directory):
        # 1. Normalize and casefold for robust cross-platform Unicode comparison
        target = unicodedata.normalize("NFD", filename).casefold()
        for f in os.listdir(directory):
            if unicodedata.normalize("NFD", f).casefold() == target:
                return os.path.join(directory, f)

        # 2. Aggressive fallback: strip everything except alphanumeric
        target_clean = "".join(c for c in target if c.isalnum())
        for f in os.listdir(directory):
            f_clean = "".join(
                c for c in unicodedata.normalize("NFD", f).casefold() if c.isalnum()
            )
            if f_clean == target_clean:
                return os.path.join(directory, f)

    return exact_path


_YEAR_RE = re.compile(r"\d{4}")


def _extract_year(date_str):
    m = _YEAR_RE.search(str(date_str)) if date_str else None
    return int(m.group()) if m else None


_nul_stripped_count = 0


def _strip_nul(v):
    """Recursively strip NUL bytes (PostgreSQL TEXT can't store them).
    Counts strips into _nul_stripped_count for end-of-contributor reporting.
    """
    global _nul_stripped_count
    if v is None:
        return None
    if isinstance(v, str):
        if "\x00" in v:
            _nul_stripped_count += 1
            return v.replace("\x00", "")
        return v
    if isinstance(v, list):
        return [_strip_nul(x) for x in v]
    if isinstance(v, dict):
        return {k: _strip_nul(x) for k, x in v.items()}
    return v


def _to_json_or_none(v):
    if v is None:
        return None
    if isinstance(v, str):
        return v.replace("\x00", "") if "\x00" in v else v
    cleaned = _strip_nul(v)
    return json.dumps(cleaned, ensure_ascii=False)


def _s(v):
    """Coerce to string, strip NULs."""
    if v is None:
        return ""
    s = str(v)
    if "\x00" in s:
        global _nul_stripped_count
        _nul_stripped_count += 1
        return s.replace("\x00", "")
    return s


def _flatten_person(p, contributor_id):
    birth = p.get("birth") or {}
    baptism = p.get("baptism") or {}
    death = p.get("death") or {}
    return {
        "ext_id": _s(p.get("id")),
        "name": _s(p.get("name")),
        "surname": _s(p.get("surname")),
        "alt_surname": _s(p.get("alt_surname")),
        "sex": _s(p.get("sex")),
        "date_of_birth": _s(birth.get("date")),
        "birth_year": _extract_year(birth.get("date")),
        "place_of_birth": _s(birth.get("place")),
        "date_of_baptism": _s(baptism.get("date")),
        "place_of_baptism": _s(baptism.get("place")),
        "date_of_death": _s(death.get("date")),
        "death_year": _extract_year(death.get("date")),
        "place_of_death": _s(death.get("place")),
        "parents_list": _to_json_or_none(p.get("parents_list")),
        "partners_list": _to_json_or_none(p.get("partners_list")),
        "notes": _s(p.get("notes")),
        "links": _to_json_or_none(p.get("links")),
        "contributor": contributor_id,
    }


def _flatten_family(f, contributor_id):
    husband = f.get("husband") or {}
    wife = f.get("wife") or {}
    marriage = f.get("marriage") or {}
    return {
        "husband_ext_id": _s(husband.get("id")),
        "husband_name": _s(husband.get("name")),
        "husband_surname": _s(husband.get("surname")),
        "husband_alt_surname": _s(husband.get("alt_surname")),
        "husband_birth": _s(husband.get("date_of_birth")),
        "wife_ext_id": _s(wife.get("id")),
        "wife_name": _s(wife.get("name")),
        "wife_surname": _s(wife.get("surname")),
        "wife_alt_surname": _s(wife.get("alt_surname")),
        "wife_birth": _s(wife.get("date_of_birth")),
        "date_of_marriage": _s(marriage.get("date")),
        "marriage_year": _extract_year(marriage.get("date")),
        "place_of_marriage": _s(marriage.get("place")),
        "children_list": _to_json_or_none(f.get("children_list")),
        "husband_parents": _to_json_or_none(f.get("husband_parents")),
        "wife_parents": _to_json_or_none(f.get("wife_parents")),
        "notes": _s(marriage.get("notes") or f.get("notes")),
        "links": _to_json_or_none(f.get("links")),
        "contributor": contributor_id,
    }


def import_contributor(
    db,
    contributor_id,
    last_modified,
    persons_count,
    families_count,
    links_count,
    imp_persons=True,
    imp_families=True,
):
    """Delete existing records for contributor and reinsert from JSON files."""
    global _nul_stripped_count
    _nul_stripped_count = 0
    db.execute(
        text(
            "INSERT INTO contributors (name, last_modified, persons_count, families_count, links_count) "
            "VALUES (:name, :last_modified, :persons_count, :families_count, :links_count) "
            "ON CONFLICT (name) DO UPDATE SET "
            "last_modified = :last_modified, persons_count = :persons_count, "
            "families_count = :families_count, links_count = :links_count;"
        ),
        {
            "name": contributor_id,
            "last_modified": last_modified,
            "persons_count": persons_count,
            "families_count": families_count,
            "links_count": links_count,
        },
    )

    if imp_persons:
        db.execute(
            text("DELETE FROM persons WHERE contributor = :name"),
            {"name": contributor_id},
        )
        persons_file = find_data_file(DATA_DIR, f"{contributor_id}-persons.json")
        if os.path.exists(persons_file):
            with open(persons_file, "r", encoding="utf-8") as f:
                persons_data = json.load(f)
            if persons_data:
                print(f"  -> Inserting {len(persons_data)} person records...")
                rows = [_flatten_person(p, contributor_id) for p in persons_data]
                db.execute(
                    text("""
                        INSERT INTO persons (ext_id, name, surname, alt_surname, sex,
                            date_of_birth, birth_year, place_of_birth,
                            date_of_baptism, place_of_baptism,
                            date_of_death, death_year, place_of_death,
                            parents_list, partners_list, notes, contributor, links)
                        VALUES (:ext_id, :name, :surname, :alt_surname, :sex,
                            :date_of_birth, :birth_year, :place_of_birth,
                            :date_of_baptism, :place_of_baptism,
                            :date_of_death, :death_year, :place_of_death,
                            :parents_list, :partners_list, :notes, :contributor, :links)
                    """),
                    rows,
                )
        else:
            visible = [
                f
                for f in os.listdir(DATA_DIR)
                if contributor_id.casefold() in f.casefold()
            ]
            print(
                f"  -> WARNING: Could not find persons file at {persons_file}\n     (Docker sync issue? Container only sees: {visible})"
            )

    if imp_families:
        db.execute(
            text("DELETE FROM families WHERE contributor = :name"),
            {"name": contributor_id},
        )
        families_file = find_data_file(DATA_DIR, f"{contributor_id}-families.json")
        if os.path.exists(families_file):
            with open(families_file, "r", encoding="utf-8") as f:
                families_data = json.load(f)
            if families_data:
                print(f"  -> Inserting {len(families_data)} family records...")
                rows = [_flatten_family(fam, contributor_id) for fam in families_data]
                db.execute(
                    text("""
                        INSERT INTO families (
                            husband_ext_id, husband_name, husband_surname,
                            husband_alt_surname, husband_birth,
                            wife_ext_id, wife_name, wife_surname,
                            wife_alt_surname, wife_birth,
                            date_of_marriage, marriage_year, place_of_marriage,
                            children_list, husband_parents, wife_parents,
                            notes, contributor, links)
                        VALUES (
                            :husband_ext_id, :husband_name, :husband_surname,
                            :husband_alt_surname, :husband_birth,
                            :wife_ext_id, :wife_name, :wife_surname,
                            :wife_alt_surname, :wife_birth,
                            :date_of_marriage, :marriage_year, :place_of_marriage,
                            :children_list, :husband_parents, :wife_parents,
                            :notes, :contributor, :links)
                    """),
                    rows,
                )
        else:
            visible = [
                f
                for f in os.listdir(DATA_DIR)
                if contributor_id.casefold() in f.casefold()
            ]
            print(
                f"  -> WARNING: Could not find families file at {families_file}\n     (Docker sync issue? Container only sees: {visible})"
            )

    db.commit()
    if _nul_stripped_count:
        print(
            f"  -> WARNING: stripped NUL byte from {_nul_stripped_count} "
            f"string value(s) for {contributor_id}"
        )


def main():
    parser = argparse.ArgumentParser(description="Import JSON data into the database.")
    parser.add_argument(
        "--mode",
        choices=["update", "full"],
        default="update",
        help="update (default): only reimport contributors whose data has changed; "
        "full: re-import all contributors regardless of modification time.",
    )
    parser.add_argument(
        "--drop-tables",
        action="store_true",
        help="Drop and recreate all tables from scratch before importing.",
    )
    parser.add_argument(
        "--force-persons",
        action="store_true",
        help="Force re-import of person records for all contributors.",
    )
    parser.add_argument(
        "--force-families",
        action="store_true",
        help="Force re-import of family records for all contributors.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of parallel workers for automatic match computation (default: 4)",
    )
    parser.add_argument(
        "--skip-matches",
        action="store_true",
        help="Skip automatic match computation after import.",
    )
    parser.add_argument(
        "-d",
        "--detach",
        action="store_true",
        help="Run automatic match computation in the background and exit immediately.",
    )
    args = parser.parse_args()
    full_mode = args.mode == "full" or args.drop_tables

    db = SessionLocal()
    print(
        f"Connecting to the database (mode: {args.mode}, drop_tables: {args.drop_tables})..."
    )

    if args.drop_tables:
        setup_full(db)
    else:
        setup_update(db)

    if not os.path.isdir(DATA_DIR):
        print(f"Error: Data directory '{DATA_DIR}' not found.")
        return

    metadata_file = os.path.join(DATA_DIR, "metadata.json")
    if not os.path.exists(metadata_file):
        print(
            f"Error: Metadata file '{metadata_file}' not found. Run extract script first."
        )
        return

    with open(metadata_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    if not args.drop_tables:
        known = {m["contributor"] for m in metadata}
        stale = db.execute(text("SELECT name FROM contributors")).fetchall()
        for (name,) in stale:
            if name not in known:
                print(f"\nRemoving stale contributor: {name}")
                db.execute(
                    text("DELETE FROM persons WHERE contributor = :name"),
                    {"name": name},
                )
                db.execute(
                    text("DELETE FROM families WHERE contributor = :name"),
                    {"name": name},
                )
                db.execute(
                    text(
                        "DELETE FROM matches "
                        "WHERE contributor_a = :name OR contributor_b = :name"
                    ),
                    {"name": name},
                )
                db.execute(
                    text(
                        "DELETE FROM match_jobs "
                        "WHERE contributor_a = :name OR contributor_b = :name"
                    ),
                    {"name": name},
                )
                db.execute(
                    text("DELETE FROM contributors WHERE name = :name"), {"name": name}
                )
        db.commit()

    total_contributors = len(metadata)
    updated_contributors = []
    for index, meta in enumerate(metadata, start=1):
        contributor_id = meta["contributor"]
        last_modified = meta.get("last_modified", "")
        meta_persons_count = meta.get("persons_count", 0)
        meta_families_count = meta.get("families_count", 0)
        meta_links_count = meta.get("links_count", 0)

        do_import = False
        imp_persons = imp_families = False

        if full_mode:
            do_import = True
            imp_persons = imp_families = True
            print(
                f"\nProcessing contributor {index}/{total_contributors}: {contributor_id}"
            )
        else:
            (
                db_last_modified,
                db_persons_count,
                db_families_count,
                db_links_count,
            ) = get_db_state(db, contributor_id)

            is_up_to_date = (
                db_last_modified == last_modified
                and db_persons_count == meta_persons_count
                and db_families_count == meta_families_count
                and db_links_count == meta_links_count
            )

            if is_up_to_date:
                if args.force_persons or args.force_families:
                    do_import = True
                    if args.force_persons:
                        imp_persons = True
                    if args.force_families:
                        imp_families = True
                    print(
                        f"\nProcessing contributor {index}/{total_contributors}: {contributor_id} (forced update)"
                    )
                else:
                    print(
                        f"\nSkipping contributor {index}/{total_contributors}: {contributor_id} (up to date)"
                    )
            else:
                do_import = True
                print(
                    f"\nProcessing contributor {index}/{total_contributors}: {contributor_id} (mismatch detected)"
                )

                if (
                    db_last_modified != last_modified
                    or db_links_count != meta_links_count
                ):
                    imp_persons = imp_families = True
                    if db_last_modified != last_modified:
                        print(
                            f"  -> Mismatch in last_modified: DB='{db_last_modified}' vs Meta='{last_modified}'"
                        )
                    if db_links_count != meta_links_count:
                        print(
                            f"  -> Mismatch in links_count: DB={db_links_count} vs Meta={meta_links_count}"
                        )
                    print("  -> Doing full re-import for this contributor.")
                else:
                    if db_persons_count != meta_persons_count or args.force_persons:
                        imp_persons = True
                        if db_persons_count != meta_persons_count:
                            print(
                                f"  -> Mismatch in persons_count: DB={db_persons_count} vs Meta={meta_persons_count}"
                            )
                        else:
                            print("  -> Forcing persons update")
                    if db_families_count != meta_families_count or args.force_families:
                        imp_families = True
                        if db_families_count != meta_families_count:
                            print(
                                f"  -> Mismatch in families_count: DB={db_families_count} vs Meta={meta_families_count}"
                            )
                        else:
                            print("  -> Forcing families update")

        if do_import:
            import_contributor(
                db,
                contributor_id,
                last_modified,
                meta_persons_count,
                meta_families_count,
                meta_links_count,
                imp_persons,
                imp_families,
            )
            updated_contributors.append(contributor_id)

    print("\nData import finished successfully.")

    if updated_contributors:
        # After a successful import, try to clear the API cache so changes are visible immediately.
        print("\nAttempting to clear API server cache...")
        try:
            # The script is run inside the 'api' container, so it can reach the API on localhost:8000
            api_url = "http://localhost:8000/api/cache/clear"
            req = urllib.request.Request(api_url, method="POST")
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    print("  -> Successfully cleared API cache.")
                else:
                    print(f"  -> Failed to clear API cache. Status: {response.status}")
        except urllib.error.URLError as e:
            print(
                f"  -> Could not connect to API to clear cache. Is the API server running? Error: {e}"
            )

        if not args.skip_matches:
            print(
                f"Updated {len(updated_contributors)} contributor(s). "
                "Automatically triggering match computation..."
            )
            import sys

            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import trigger_matches
            import compute_matches

            all_names = [
                r.name
                for r in db.execute(text("SELECT name FROM contributors")).fetchall()
            ]
            pairs = set()
            for t in updated_contributors:
                for other in all_names:
                    if other != t:
                        a, b = (t, other) if t < other else (other, t)
                        pairs.add((a, b))
            pairs = sorted(pairs)

            if pairs:
                trigger_matches.queue_pairs(db, pairs)
                print(f"Queued {len(pairs)} pairs for matching.")

            db.close()
            db = None

            if pairs:
                if args.detach:
                    import subprocess

                    script_path = "/app/tools/compute_matches.py"
                    log_file = "/app/data/output/compute_matches.log"
                    print(
                        f"Starting match computation in the background. Log: {log_file}"
                    )
                    with open(log_file, "a") as f:
                        subprocess.Popen(
                            ["python", script_path, f"--workers={args.workers}"],
                            stdout=f,
                            stderr=f,
                            start_new_session=True,
                        )
                else:
                    compute_matches.main(workers=args.workers)
        else:
            print(
                f"Updated {len(updated_contributors)} contributor(s). "
                "Run matches manually: python tools/trigger_matches.py --all"
            )

    if db is not None:
        db.close()


if __name__ == "__main__":
    main()
