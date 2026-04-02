import argparse
import os
import json
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
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@localhost:5432/{os.getenv('POSTGRES_DB')}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def setup_full(db):
    """Drop and recreate all tables (full mode)."""
    print("Setting up database tables and extensions (full rebuild)...")
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(
        text(
            """
        DROP TABLE IF EXISTS births, families, contributors CASCADE;

        CREATE TABLE contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255)
        );
        CREATE TABLE births (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_birth TEXT, place_of_birth TEXT, contributor TEXT, link TEXT
        );
        CREATE TABLE families (
            id SERIAL PRIMARY KEY, husband_name TEXT, husband_surname TEXT, wife_name TEXT, wife_surname TEXT, children TEXT, date_of_marriage TEXT, place_of_marriage TEXT, contributor TEXT, link TEXT
        );
        CREATE TABLE deaths (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_death TEXT, place_of_death TEXT, contributor TEXT, link TEXT
        );

        CREATE INDEX idx_birth_name_trgm ON births USING gist (name gist_trgm_ops);
        CREATE INDEX idx_birth_surname_trgm ON births USING gist (surname gist_trgm_ops);
        CREATE INDEX idx_family_h_surname_trgm ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX idx_family_w_surname_trgm ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX idx_family_children_trgm ON families USING gist (children gist_trgm_ops);
        CREATE INDEX idx_death_name_trgm ON deaths USING gist (name gist_trgm_ops);
        CREATE INDEX idx_death_surname_trgm ON deaths USING gist (surname gist_trgm_ops);
    """
        )
    )
    db.commit()


def setup_update(db):
    """Create tables if they don't exist yet (update mode)."""
    print("Setting up database tables and extensions (update mode)...")
    db.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm;"))
    db.execute(
        text(
            """
        CREATE TABLE IF NOT EXISTS contributors (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            last_modified VARCHAR(255)
        );
        CREATE TABLE IF NOT EXISTS births (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_birth TEXT, place_of_birth TEXT, contributor TEXT, link TEXT
        );
        CREATE TABLE IF NOT EXISTS families (
            id SERIAL PRIMARY KEY, husband_name TEXT, husband_surname TEXT, wife_name TEXT, wife_surname TEXT, children TEXT, date_of_marriage TEXT, place_of_marriage TEXT, contributor TEXT, link TEXT
        );
        CREATE TABLE IF NOT EXISTS deaths (
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_death TEXT, place_of_death TEXT, contributor TEXT, link TEXT
        );
        ALTER TABLE births ADD COLUMN IF NOT EXISTS link TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS link TEXT;
        ALTER TABLE families ADD COLUMN IF NOT EXISTS children TEXT;

        CREATE INDEX IF NOT EXISTS idx_birth_name_trgm ON births USING gist (name gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_birth_surname_trgm ON births USING gist (surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_h_surname_trgm ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_w_surname_trgm ON families USING gist (wife_surname gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_family_children_trgm ON families USING gist (children gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_death_name_trgm ON deaths USING gist (name gist_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_death_surname_trgm ON deaths USING gist (surname gist_trgm_ops);
    """
        )
    )
    db.commit()


def get_db_state(db, contributor_name):
    """Returns (last_modified, births_count, families_count, deaths_count, links_count) stored in DB, or (None, 0, 0, 0, 0)."""
    row = db.execute(
        text("SELECT last_modified FROM contributors WHERE name = :name"),
        {"name": contributor_name},
    ).fetchone()
    if not row:
        return None, 0, 0, 0, 0
    lm = row[0]
    births_count = db.execute(
        text("SELECT COUNT(*) FROM births WHERE contributor = :name"),
        {"name": contributor_name},
    ).scalar()
    families_count = db.execute(
        text("SELECT COUNT(*) FROM families WHERE contributor = :name"),
        {"name": contributor_name},
    ).scalar()
    birth_links = db.execute(
        text(
            "SELECT COUNT(*) FROM births WHERE contributor = :name AND link IS NOT NULL AND link != ''"
        ),
        {"name": contributor_name},
    ).scalar()
    family_links = db.execute(
        text(
            "SELECT COUNT(*) FROM families WHERE contributor = :name AND link IS NOT NULL AND link != ''"
        ),
        {"name": contributor_name},
    ).scalar()
    death_links = db.execute(
        text(
            "SELECT COUNT(*) FROM deaths WHERE contributor = :name AND link IS NOT NULL AND link != ''"
        ),
        {"name": contributor_name},
    ).scalar()
    deaths_count = db.execute(
        text("SELECT COUNT(*) FROM deaths WHERE contributor = :name"),
        {"name": contributor_name},
    ).scalar()
    return (
        lm,
        (births_count or 0),
        (families_count or 0),
        (deaths_count or 0),
        (birth_links or 0) + (family_links or 0) + (death_links or 0),
    )


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


def import_contributor(
    db,
    contributor_id,
    last_modified,
    imp_births=True,
    imp_families=True,
    imp_deaths=True,
):
    """Delete existing records for contributor and reinsert from JSON files."""
    # Update contributor timestamp
    db.execute(
        text(
            "INSERT INTO contributors (name, last_modified) VALUES (:name, :last_modified) "
            "ON CONFLICT (name) DO UPDATE SET last_modified = :last_modified;"
        ),
        {"name": contributor_id, "last_modified": last_modified},
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
            print(f"  -> Inserting {len(births_data)} birth records...")
            for birth in births_data:
                birth["contributor"] = contributor_id
                birth.setdefault("link", None)
                db.execute(
                    text(
                        "INSERT INTO births (name, surname, date_of_birth, place_of_birth, contributor, link) "
                        "VALUES (:name, :surname, :date_of_birth, :place_of_birth, :contributor, :link)"
                    ),
                    birth,
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
            print(f"  -> Inserting {len(families_data)} family records...")
            for family in families_data:
                family["contributor"] = contributor_id
                family.setdefault("link", None)
                family.setdefault("children", None)
                db.execute(
                    text(
                        "INSERT INTO families (husband_name, husband_surname, wife_name, wife_surname, "
                        "children, date_of_marriage, place_of_marriage, contributor, link) "
                        "VALUES (:husband_name, :husband_surname, :wife_name, :wife_surname, "
                        ":children, :date_of_marriage, :place_of_marriage, :contributor, :link)"
                    ),
                    family,
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
            print(f"  -> Inserting {len(deaths_data)} death records...")
            for death in deaths_data:
                death["contributor"] = contributor_id
                death.setdefault("link", None)
                db.execute(
                    text(
                        "INSERT INTO deaths (name, surname, date_of_death, place_of_death, contributor, link) "
                        "VALUES (:name, :surname, :date_of_death, :place_of_death, :contributor, :link)"
                    ),
                    death,
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
    for index, meta in enumerate(metadata, start=1):
        contributor_id = meta["contributor"]
        last_modified = meta.get("last_modified", "")

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

            meta_births_count = meta.get("births_count", 0)
            meta_families_count = meta.get("families_count", 0)
            meta_deaths_count = meta.get("deaths_count", 0)
            meta_links_count = meta.get("links_count", 0)

            is_up_to_date = (
                db_last_modified == last_modified
                and db_births_count == meta_births_count
                and db_families_count == meta_families_count
                and db_deaths_count == meta_deaths_count
                and db_links_count == meta_links_count
            )

            if is_up_to_date:
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
                    if db_births_count != meta_births_count:
                        imp_births = True
                        print(
                            f"  -> Mismatch in births_count: DB={db_births_count} vs Meta={meta_births_count}"
                        )
                    if db_families_count != meta_families_count:
                        imp_families = True
                        print(
                            f"  -> Mismatch in families_count: DB={db_families_count} vs Meta={meta_families_count}"
                        )
                    if db_deaths_count != meta_deaths_count:
                        imp_deaths = True
                        print(
                            f"  -> Mismatch in deaths_count: DB={db_deaths_count} vs Meta={meta_deaths_count}"
                        )

        if do_import:
            import_contributor(
                db, contributor_id, last_modified, imp_births, imp_families, imp_deaths
            )

    print("\nData import finished successfully.")
    db.close()


if __name__ == "__main__":
    main()
