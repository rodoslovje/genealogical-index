# Slovenian Genealogical Index

This project provides a scalable, searchable web application for genealogical data. It features a PostgreSQL database, a Python FastAPI backend, and a vanilla JavaScript frontend.

## Architecture

- **Database:** PostgreSQL (with `pg_trgm` extension for fuzzy searching)
- **Backend:** Python / FastAPI
- **Frontend:** Vanilla JS / HTML / CSS
- **Deployment:** Docker & Docker Compose (backend/db), Caddy (frontend)

## Prerequisites

- **Docker** and **Docker Compose**
- **Python 3**

## 1. Data Extraction (Local Prep)

Before importing data into the database, extract the JSON records from your raw GEDCOM (`.ged`) files.

1. Place your raw `.ged` files into the `input/` directory. (Create it if it doesn't exist).
2. Setup a Python virtual environment and install the required dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r scripts/requirements.txt
   ```
3. Run the extraction script:
   ```bash
   python scripts/gedcom-to-json.py
   ```
   _This will parse the GEDCOM files and output JSON datasets alongside a `metadata.json` file in the `data/` directory._

## 2. Deploying the Backend & Database

The database and API backend are containerized and run together on a custom Docker network (`caddy_net`).

1. Ensure you have created your `.env` file in the project root with the PostgreSQL credentials.
2. Ensure the external Docker network exists (create it if your Caddy proxy hasn't already):
   ```bash
   docker network create caddy_net
   ```
3. Build and start the backend containers in the background:
   ```bash
   docker-compose up -d --build
   ```

## 3. Importing Data into PostgreSQL

Once the API and DB containers are running, populate the database with the extracted JSON files. Execute the import script _inside_ the running API container:

```bash
docker-compose exec api python scripts/import_to_db.py
```

You can preview the built application locally with:

```bash
yarn preview
```
