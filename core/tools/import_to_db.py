import argparse
import os
import json
import re
import unicodedata
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

DATA_DIR = "data/output"

# --- Database Setup ---
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Fallback to local .env file if running outside of Docker Compose
    load_dotenv("../.env")
    import urllib.parse

    _db_host = "db" if os.path.exists("/.dockerenv") else "localhost"
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{urllib.parse.quote_plus(os.getenv('POSTGRES_PASSWORD', ''))}@{_db_host}:5432/{os.getenv('POSTGRES_DB')}"
    # Prevent a poisoned DATABASE_URL from .env affecting downstream scripts
    if "DATABASE_URL" in os.environ:
        os.environ["DATABASE_URL"] = DATABASE_URL

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_full(db):
    """Drop and recreate all tables (full mode)."""
    print("Setting up database tables and extensions (full rebuild)...")
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text("""
        DROP TABLE IF EXISTS births, families, deaths, contributors, match_jobs, matches CASCADE;

        CREATE TABLE contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255),
            births_count INTEGER DEFAULT 0,
            families_count INTEGER DEFAULT 0,
            deaths_count INTEGER DEFAULT 0,
            links_count INTEGER DEFAULT 0
        );
        CREATE TABLE births (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_birth TEXT, birth_year SMALLINT, place_of_birth TEXT, father_name TEXT, father_surname TEXT, mother_name TEXT, mother_surname TEXT, husbands_list TEXT, wifes_list TEXT, contributor TEXT, links TEXT
        );
        CREATE TABLE families (
            id SERIAL PRIMARY KEY, husband_name TEXT, husband_surname TEXT, wife_name TEXT, wife_surname TEXT, children_list TEXT, husband_parents TEXT, wife_parents TEXT, date_of_marriage TEXT, marriage_year SMALLINT, place_of_marriage TEXT, contributor TEXT, links TEXT
        );
        CREATE TABLE deaths (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_death TEXT, death_year SMALLINT, place_of_death TEXT, father_name TEXT, father_surname TEXT, mother_name TEXT, mother_surname TEXT, husbands_list TEXT, wifes_list TEXT, contributor TEXT, links TEXT
        );

        CREATE INDEX idx_birth_name_trgm ON births USING gist (name gist_trgm_ops);
        CREATE INDEX idx_birth_surname_trgm ON births USING gist (surname gist_trgm_ops);
        CREATE INDEX idx_family_h_surname_trgm ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX idx_family_w_surname_trgm ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX idx_family_children_list_trgm ON families USING gist (children_list gist_trgm_ops);
        CREATE INDEX idx_death_name_trgm ON deaths USING gist (name gist_trgm_ops);
        CREATE INDEX idx_death_surname_trgm ON deaths USING gist (surname gist_trgm_ops);

        -- B-tree indexes on contributor — lets the planner quickly isolate one contributor's rows
        -- Composite indexes allow instantaneous Index-Only Scans for DISTINCT surnames
        -- and fast equality joins during the match compute phase.
        CREATE INDEX idx_birth_contrib_sur  ON births(contributor, surname);
        CREATE INDEX idx_family_contrib_surs ON families(contributor, husband_surname, wife_surname);
        CREATE INDEX idx_death_contrib_sur  ON deaths(contributor, surname);

        -- B-tree indexes on year columns — used to pre-filter candidates by year range
        -- before the trigram similarity join, significantly reducing the candidate set.
        CREATE INDEX idx_birth_year   ON births(birth_year);
        CREATE INDEX idx_family_year  ON families(marriage_year);
        CREATE INDEX idx_death_year   ON deaths(death_year);

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


def setup_update(db):
    """Create tables and apply schema migrations (update mode).

    Each logical step is committed independently so DDL locks are held for the
    shortest possible time.  Migrations are guarded by schema checks so they
    only run when actually needed — re-running import on an up-to-date database
    is fast regardless of table size.
    """
    print("Setting up database tables and extensions (update mode)...")

    # ------------------------------------------------------------------ #
    # 1. Extension + base tables — never touches existing data             #
    # ------------------------------------------------------------------ #
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255)
        );
        CREATE TABLE IF NOT EXISTS births (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT,
            date_of_birth TEXT, place_of_birth TEXT,
            father_name TEXT, father_surname TEXT,
            mother_name TEXT, mother_surname TEXT,
            contributor TEXT, links TEXT
        );
        CREATE TABLE IF NOT EXISTS families (
            id SERIAL PRIMARY KEY,
            husband_name TEXT, husband_surname TEXT,
            wife_name TEXT, wife_surname TEXT,
            date_of_marriage TEXT, place_of_marriage TEXT,
            contributor TEXT, links TEXT
        );
        CREATE TABLE IF NOT EXISTS deaths (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT,
            date_of_death TEXT, place_of_death TEXT,
            father_name TEXT, father_surname TEXT,
            mother_name TEXT, mother_surname TEXT,
            contributor TEXT, links TEXT
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
    """))
    db.commit()

    # ------------------------------------------------------------------ #
    # 2. Column additions — each ALTER TABLE IF NOT EXISTS is instant      #
    #    when the column already exists                                    #
    # ------------------------------------------------------------------ #
    db.execute(text("""
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS links TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS links TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS links TEXT;
    """))
    db.commit()

    # Migrate old single-URL 'link' column to JSON array 'links', then drop it
    db.execute(text("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='births' AND column_name='link') THEN
                UPDATE births SET links = '["' || link || '"]' WHERE link IS NOT NULL AND link != '' AND links IS NULL;
                ALTER TABLE births DROP COLUMN link;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='families' AND column_name='link') THEN
                UPDATE families SET links = '["' || link || '"]' WHERE link IS NOT NULL AND link != '' AND links IS NULL;
                ALTER TABLE families DROP COLUMN link;
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deaths' AND column_name='link') THEN
                UPDATE deaths SET links = '["' || link || '"]' WHERE link IS NOT NULL AND link != '' AND links IS NULL;
                ALTER TABLE deaths DROP COLUMN link;
            END IF;
        END $$;
    """))
    db.commit()

    db.execute(text("""
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS father_name TEXT;
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS father_surname TEXT;
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS mother_name TEXT;
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS mother_surname TEXT;
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS husbands_list TEXT;
        ALTER TABLE births  ADD COLUMN IF NOT EXISTS wifes_list TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS father_name TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS father_surname TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS mother_name TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS mother_surname TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS husbands_list TEXT;
        ALTER TABLE deaths  ADD COLUMN IF NOT EXISTS wifes_list TEXT;
        ALTER TABLE families DROP COLUMN IF EXISTS children_json;
        ALTER TABLE families DROP COLUMN IF EXISTS children;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS children_list TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS husband_parents TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS wife_parents TEXT;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS births_count   INTEGER DEFAULT 0;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS families_count INTEGER DEFAULT 0;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS deaths_count   INTEGER DEFAULT 0;
        ALTER TABLE contributors ADD COLUMN IF NOT EXISTS links_count    INTEGER DEFAULT 0;
        ALTER TABLE births   ADD COLUMN IF NOT EXISTS birth_year    SMALLINT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS marriage_year SMALLINT;
        ALTER TABLE deaths   ADD COLUMN IF NOT EXISTS death_year    SMALLINT;
    """))
    db.commit()

    # ------------------------------------------------------------------ #
    # 3. Indexes — CREATE IF NOT EXISTS skips instantly when they exist;   #
    #    only slow on the very first setup                                 #
    # ------------------------------------------------------------------ #
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_birth_name_trgm          ON births   USING gist (name gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_birth_surname_trgm        ON births   USING gist (surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_h_surname_trgm     ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_w_surname_trgm     ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_children_list_trgm ON families USING gist (children_list gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_death_name_trgm           ON deaths   USING gist (name gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_death_surname_trgm        ON deaths   USING gist (surname gist_trgm_ops);

        CREATE INDEX IF NOT EXISTS idx_birth_contrib_sur         ON births(contributor, surname);
        CREATE INDEX IF NOT EXISTS idx_family_contrib_surs       ON families(contributor, husband_surname, wife_surname);
        CREATE INDEX IF NOT EXISTS idx_death_contrib_sur         ON deaths(contributor, surname);

        DROP INDEX IF EXISTS idx_birth_contrib_sur_name;
        DROP INDEX IF EXISTS idx_death_contrib_sur_name;
        DROP INDEX IF EXISTS idx_birth_contributor;
        DROP INDEX IF EXISTS idx_family_contributor;
        DROP INDEX IF EXISTS idx_death_contributor;

        CREATE INDEX IF NOT EXISTS idx_birth_year                ON births(birth_year);
        CREATE INDEX IF NOT EXISTS idx_family_year               ON families(marriage_year);
        CREATE INDEX IF NOT EXISTS idx_death_year                ON deaths(death_year);
        CREATE INDEX IF NOT EXISTS idx_matches_b  ON matches(contributor_b);
        CREATE INDEX IF NOT EXISTS idx_matches_ab ON matches(contributor_a, contributor_b);
        DROP INDEX IF EXISTS idx_matches_a;
    """))
    db.commit()

    # ------------------------------------------------------------------ #
    # 4. match_jobs migration — only runs when old single-contributor      #
    #    schema is detected; skipped entirely on up-to-date databases      #
    # ------------------------------------------------------------------ #
    if _col_exists(db, "match_jobs", "contributor"):
        print("  Migrating match_jobs to pair-based schema...")
        db.execute(text("DROP TABLE match_jobs;"))
        db.execute(text("""
            CREATE TABLE match_jobs (
                contributor_a TEXT NOT NULL,
                contributor_b TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                queued_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                PRIMARY KEY (contributor_a, contributor_b)
            );
            CREATE INDEX idx_match_jobs_status ON match_jobs(status, queued_at);
        """))
        db.commit()
    else:
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS match_jobs (
                contributor_a TEXT NOT NULL,
                contributor_b TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                queued_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                PRIMARY KEY (contributor_a, contributor_b)
            );
            CREATE INDEX IF NOT EXISTS idx_match_jobs_status ON match_jobs(status, queued_at);
        """))
        db.commit()

    # ------------------------------------------------------------------ #
    # 5. matches column cleanup                                            #
    # ------------------------------------------------------------------ #
    if _col_exists(db, "matches", "owner"):
        db.execute(text("ALTER TABLE matches DROP COLUMN owner;"))
        db.execute(text("DROP INDEX IF EXISTS idx_matches_owner;"))
        db.commit()


def get_db_state(db, contributor_name):
    """Returns pre-calculated stats stored in DB, or (None, 0, 0, 0, 0)."""
    row = db.execute(
        text(
            "SELECT last_modified, births_count, families_count, deaths_count, links_count FROM contributors WHERE name = :name"
        ),
        {"name": contributor_name},
    ).fetchone()
    if not row:
        return None, 0, 0, 0, 0
    return row[0], row[1], row[2], row[3], row[4]


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


def import_contributor(
    db,
    contributor_id,
    last_modified,
    births_count,
    families_count,
    deaths_count,
    links_count,
    imp_births=True,
    imp_families=True,
    imp_deaths=True,
):
    """Delete existing records for contributor and reinsert from JSON files."""
    # Update contributor timestamp and pre-calculated stats
    db.execute(
        text(
            "INSERT INTO contributors (name, last_modified, births_count, families_count, deaths_count, links_count) "
            "VALUES (:name, :last_modified, :births_count, :families_count, :deaths_count, :links_count) "
            "ON CONFLICT (name) DO UPDATE SET "
            "last_modified = :last_modified, births_count = :births_count, "
            "families_count = :families_count, deaths_count = :deaths_count, links_count = :links_count;"
        ),
        {
            "name": contributor_id,
            "last_modified": last_modified,
            "births_count": births_count,
            "families_count": families_count,
            "deaths_count": deaths_count,
            "links_count": links_count,
        },
    )

    # Load Births
    if imp_births:
        db.execute(
            text("DELETE FROM births WHERE contributor = :name"),
            {"name": contributor_id},
        )
        births_file = find_data_file(DATA_DIR, f"{contributor_id}-births.json")
        if os.path.exists(births_file):
            with open(births_file, "r", encoding="utf-8") as f:
                births_data = json.load(f)
            if births_data:
                print(f"  -> Inserting {len(births_data)} birth records...")
                for birth in births_data:
                    birth["contributor"] = contributor_id
                    if isinstance(birth.get("links"), list):
                        birth["links"] = json.dumps(birth["links"], ensure_ascii=False)
                    birth.setdefault("links", None)
                    birth.setdefault("father_name", None)
                    birth.setdefault("father_surname", None)
                    birth.setdefault("mother_name", None)
                    birth.setdefault("mother_surname", None)
                    birth.setdefault("husbands_list", None)
                    birth.setdefault("wifes_list", None)
                    if isinstance(birth.get("husbands_list"), list):
                        birth["husbands_list"] = json.dumps(
                            birth["husbands_list"], ensure_ascii=False
                        )
                    if isinstance(birth.get("wifes_list"), list):
                        birth["wifes_list"] = json.dumps(
                            birth["wifes_list"], ensure_ascii=False
                        )
                    birth["birth_year"] = _extract_year(birth.get("date_of_birth"))
                db.execute(
                    text("""
                        INSERT INTO births (name, surname, date_of_birth, birth_year, place_of_birth,
                        father_name, father_surname, mother_name, mother_surname, husbands_list, wifes_list, contributor, links)
                        VALUES (:name, :surname, :date_of_birth, :birth_year, :place_of_birth,
                        :father_name, :father_surname, :mother_name, :mother_surname, :husbands_list, :wifes_list, :contributor, :links)
                    """),
                    births_data,
                )
        else:
            visible = [
                f
                for f in os.listdir(DATA_DIR)
                if contributor_id.casefold() in f.casefold()
            ]
            print(
                f"  -> WARNING: Could not find births file at {births_file}\n     (Docker sync issue? Container only sees: {visible})"
            )

    # Load Families
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
                for family in families_data:
                    family["contributor"] = contributor_id
                    if isinstance(family.get("links"), list):
                        family["links"] = json.dumps(
                            family["links"], ensure_ascii=False
                        )
                    family.setdefault("links", None)
                    family.setdefault("children_list", None)
                    family.setdefault("husband_parents", None)
                    family.setdefault("wife_parents", None)
                    if isinstance(family.get("children_list"), list):
                        family["children_list"] = json.dumps(
                            family["children_list"], ensure_ascii=False
                        )
                    if isinstance(family.get("husband_parents"), list):
                        family["husband_parents"] = json.dumps(
                            family["husband_parents"], ensure_ascii=False
                        )
                    if isinstance(family.get("wife_parents"), list):
                        family["wife_parents"] = json.dumps(
                            family["wife_parents"], ensure_ascii=False
                        )
                    family["marriage_year"] = _extract_year(
                        family.get("date_of_marriage")
                    )
                db.execute(
                    text("""
                        INSERT INTO families (husband_name, husband_surname, wife_name, wife_surname,
                        children_list, husband_parents, wife_parents, date_of_marriage, marriage_year, place_of_marriage, contributor, links)
                        VALUES (:husband_name, :husband_surname, :wife_name, :wife_surname,
                        :children_list, :husband_parents, :wife_parents, :date_of_marriage, :marriage_year, :place_of_marriage, :contributor, :links)
                    """),
                    families_data,
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

    # Load Deaths
    if imp_deaths:
        db.execute(
            text("DELETE FROM deaths WHERE contributor = :name"),
            {"name": contributor_id},
        )
        deaths_file = find_data_file(DATA_DIR, f"{contributor_id}-deaths.json")
        if os.path.exists(deaths_file):
            with open(deaths_file, "r", encoding="utf-8") as f:
                deaths_data = json.load(f)
            if deaths_data:
                print(f"  -> Inserting {len(deaths_data)} death records...")
                for death in deaths_data:
                    death["contributor"] = contributor_id
                    if isinstance(death.get("links"), list):
                        death["links"] = json.dumps(death["links"], ensure_ascii=False)
                    death.setdefault("links", None)
                    death.setdefault("father_name", None)
                    death.setdefault("father_surname", None)
                    death.setdefault("mother_name", None)
                    death.setdefault("mother_surname", None)
                    death.setdefault("husbands_list", None)
                    death.setdefault("wifes_list", None)
                    if isinstance(death.get("husbands_list"), list):
                        death["husbands_list"] = json.dumps(
                            death["husbands_list"], ensure_ascii=False
                        )
                    if isinstance(death.get("wifes_list"), list):
                        death["wifes_list"] = json.dumps(
                            death["wifes_list"], ensure_ascii=False
                        )
                    death["death_year"] = _extract_year(death.get("date_of_death"))
                db.execute(
                    text("""
                        INSERT INTO deaths (name, surname, date_of_death, death_year, place_of_death,
                        father_name, father_surname, mother_name, mother_surname, husbands_list, wifes_list, contributor, links)
                        VALUES (:name, :surname, :date_of_death, :death_year, :place_of_death,
                        :father_name, :father_surname, :mother_name, :mother_surname, :husbands_list, :wifes_list, :contributor, :links)
                    """),
                    deaths_data,
                )
        else:
            visible = [
                f
                for f in os.listdir(DATA_DIR)
                if contributor_id.casefold() in f.casefold()
            ]
            print(
                f"  -> WARNING: Could not find deaths file at {deaths_file}\n     (Docker sync issue? Container only sees: {visible})"
            )

    db.commit()


def main():
    """
    Main function to import extracted JSON data into the database.
    """
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
        "--force-families",
        action="store_true",
        help="Force re-import of family records for all contributors.",
    )
    parser.add_argument(
        "--force-births",
        action="store_true",
        help="Force re-import of birth records for all contributors.",
    )
    parser.add_argument(
        "--force-deaths",
        action="store_true",
        help="Force re-import of death records for all contributors.",
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

    # --- Setup ---
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

    # --- Remove contributors no longer in metadata (e.g. deleted GED files) ---
    if not args.drop_tables:
        known = {m["contributor"] for m in metadata}
        stale = db.execute(text("SELECT name FROM contributors")).fetchall()
        for (name,) in stale:
            if name not in known:
                print(f"\nRemoving stale contributor: {name}")
                db.execute(
                    text("DELETE FROM births WHERE contributor = :name"), {"name": name}
                )
                db.execute(
                    text("DELETE FROM families WHERE contributor = :name"),
                    {"name": name},
                )
                db.execute(
                    text("DELETE FROM deaths WHERE contributor = :name"), {"name": name}
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
        meta_births_count = meta.get("births_count", 0)
        meta_families_count = meta.get("families_count", 0)
        meta_deaths_count = meta.get("deaths_count", 0)
        meta_links_count = meta.get("links_count", 0)

        do_import = False
        imp_births = imp_families = imp_deaths = False

        if full_mode:
            do_import = True
            imp_births = imp_families = imp_deaths = True
            print(
                f"\nProcessing contributor {index}/{total_contributors}: {contributor_id}"
            )
        else:  # update mode
            (
                db_last_modified,
                db_births_count,
                db_families_count,
                db_deaths_count,
                db_links_count,
            ) = get_db_state(db, contributor_id)

            is_up_to_date = (
                db_last_modified == last_modified
                and db_births_count == meta_births_count
                and db_families_count == meta_families_count
                and db_deaths_count == meta_deaths_count
                and db_links_count == meta_links_count
            )

            if is_up_to_date:
                if args.force_births or args.force_families or args.force_deaths:
                    do_import = True
                    if args.force_births:
                        imp_births = True
                    if args.force_families:
                        imp_families = True
                    if args.force_deaths:
                        imp_deaths = True
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
                    imp_births = imp_families = imp_deaths = True
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
                    if db_births_count != meta_births_count or args.force_births:
                        imp_births = True
                        if db_births_count != meta_births_count:
                            print(
                                f"  -> Mismatch in births_count: DB={db_births_count} vs Meta={meta_births_count}"
                            )
                        else:
                            print("  -> Forcing births update")
                    if db_families_count != meta_families_count or args.force_families:
                        imp_families = True
                        if db_families_count != meta_families_count:
                            print(
                                f"  -> Mismatch in families_count: DB={db_families_count} vs Meta={meta_families_count}"
                            )
                        else:
                            print("  -> Forcing families update")
                    if db_deaths_count != meta_deaths_count or args.force_deaths:
                        imp_deaths = True
                        if db_deaths_count != meta_deaths_count:
                            print(
                                f"  -> Mismatch in deaths_count: DB={db_deaths_count} vs Meta={meta_deaths_count}"
                            )
                        else:
                            print("  -> Forcing deaths update")

        if do_import:
            import_contributor(
                db,
                contributor_id,
                last_modified,
                meta_births_count,
                meta_families_count,
                meta_deaths_count,
                meta_links_count,
                imp_births,
                imp_families,
                imp_deaths,
            )
            updated_contributors.append(contributor_id)

    print("\nData import finished successfully.")
    if updated_contributors:
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

            # Close DB connection before yielding to compute_matches workers
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
