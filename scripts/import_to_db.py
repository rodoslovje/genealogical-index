import os
import json
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

DATA_DIR = "data"

# --- Database Setup ---
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    # Fallback to local .env file if running outside of Docker Compose
    load_dotenv("../.env")
    DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@localhost:5432/{os.getenv('POSTGRES_DB')}"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def main():
    """
    Main function to import extracted JSON data into the database.
    """
    db = SessionLocal()
    print("Connecting to the database...")

    # Create extensions and tables
    print("Setting up database tables and extensions...")
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
            id SERIAL PRIMARY KEY, name TEXT, surname TEXT, date_of_birth TEXT, place_of_birth TEXT, contributor TEXT
        );
        CREATE TABLE families (
            id SERIAL PRIMARY KEY, husband_name TEXT, husband_surname TEXT, wife_name TEXT, wife_surname TEXT, date_of_marriage TEXT, place_of_marriage TEXT, contributor TEXT
        );

        CREATE INDEX idx_birth_name_trgm ON births USING gist (name gist_trgm_ops);
        CREATE INDEX idx_birth_surname_trgm ON births USING gist (surname gist_trgm_ops);
        CREATE INDEX idx_family_h_surname_trgm ON families USING gist (husband_surname gist_trgm_ops);
        CREATE INDEX idx_family_w_surname_trgm ON families USING gist (wife_surname gist_trgm_ops);
    """
        )
    )
    db.commit()

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

    for meta in metadata:
        contributor_id = meta["contributor"]
        last_modified = meta.get("last_modified", "")

        print(f"\nProcessing contributor: {contributor_id}")

        # Insert contributor metadata
        db.execute(
            text(
                "INSERT INTO contributors (name, last_modified) VALUES (:name, :last_modified) ON CONFLICT (name) DO UPDATE SET last_modified = :last_modified;"
            ),
            {"name": contributor_id, "last_modified": last_modified},
        )

        # Load Births
        births_file = os.path.join(DATA_DIR, f"{contributor_id}-births.json")
        if os.path.exists(births_file):
            with open(births_file, "r", encoding="utf-8") as f:
                births_data = json.load(f)

            print(f"  -> Inserting {len(births_data)} birth records...")
            for birth in births_data:
                birth["contributor"] = contributor_id
                db.execute(
                    text(
                        "INSERT INTO births (name, surname, date_of_birth, place_of_birth, contributor) VALUES (:name, :surname, :date_of_birth, :place_of_birth, :contributor)"
                    ),
                    birth,
                )

        # Load Families
        families_file = os.path.join(DATA_DIR, f"{contributor_id}-families.json")
        if os.path.exists(families_file):
            with open(families_file, "r", encoding="utf-8") as f:
                families_data = json.load(f)

            print(f"  -> Inserting {len(families_data)} family records...")
            for family in families_data:
                family["contributor"] = contributor_id
                db.execute(
                    text(
                        "INSERT INTO families (husband_name, husband_surname, wife_name, wife_surname, date_of_marriage, place_of_marriage, contributor) VALUES (:husband_name, :husband_surname, :wife_name, :wife_surname, :date_of_marriage, :place_of_marriage, :contributor)"
                    ),
                    family,
                )

        db.commit()

    print("\nData import finished successfully.")
    db.close()


if __name__ == "__main__":
    main()
