# Slovenian Genealogical Index

This project extracts genealogical data (Births and Families/Marriages) from GEDCOM files and serves them via a fast, lightweight Single Page Application (SPA) built with Vite and vanilla JavaScript.

## Prerequisites

- **Python 3**
- **Node.js**
- **Yarn** (Package manager)

## 1. Data Extraction (Python Backend)

Before running the web application, you must extract the data from your GEDCOM (`.ged`) files.

1. Place your raw `.ged` files into the `input/` directory. (Create it if it doesn't exist).
2. Setup a Python virtual environment and install the required dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
   pip install python-gedcom
   ```
3. Run the extraction script:
   ```bash
   python scripts/gedcom-to-json.py
   ```
   _This will parse the GEDCOM files and output JSON datasets alongside a `metadata.json` file in the `data/` directory._

## 2. Running the Web Application (Yarn & Vite Frontend)

Once the `data/` directory is populated with the JSON files, you can start the frontend.

1. Install dependencies using Yarn:
   ```bash
   yarn install
   ```
2. Start the Vite development server:
   ```bash
   yarn dev
   ```
3. Open your browser to the local URL provided by Vite (usually `http://localhost:1995`).

### Building for Production

To compile the application for production deployment, run:

```bash
yarn build
```

You can preview the built application locally with:

```bash
yarn preview
```
