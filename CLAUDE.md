# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Genealogical Index is a monorepo for a searchable web application for genealogical data. It supports multiple country installations (Slovenia `slo`, Croatia `cro`, test `test`) that share the same core code but have per-site branding, translations, and configuration.

**Stack:** PostgreSQL 16 (pg_trgm) → FastAPI/Python → Vanilla JS/Vite frontend → Caddy reverse proxy, all containerized with Docker Compose.

## Development Commands

### Frontend

```bash
# Install dependencies (run once from repo root)
npm install

# Dev server with hot reload (port 1995, accessible on local network)
npm run dev:slo        # Slovenia
npm run dev:cro        # Croatia
npm run dev:test       # Test site

# Production build
npm run build:slo      # Output: sites/slo/dist/
npm run build:cro
npm run build:test

# Preview production build locally
npm run build:slo && npm run preview:slo
```

### Backend (Docker)

```bash
# From a site directory (e.g. sites/slo/)
cd sites/slo
docker compose up -d --build    # Start/rebuild all containers
docker compose up -d --build api  # Rebuild only the API container
docker compose ps               # Check status

# Import data
docker compose exec api python tools/import_to_db.py --mode update
docker compose exec api python tools/import_to_db.py --mode full --drop-tables

# Compute cross-contributor matches
docker compose exec api python tools/trigger_matches.py          # Show progress
docker compose exec api python tools/trigger_matches.py --all    # Full recompute
docker compose exec api python tools/trigger_matches.py --resume # Resume stopped run
docker compose exec api python tools/trigger_matches.py --stop   # Stop running computation
```

## Architecture

### Repository Layout

```
core/
  backend/         # FastAPI application
    src/           # api.py, crud.py, models.py, schemas.py, database.py
    Dockerfile
    requirements.txt
  web/             # Shared vanilla JS frontend (Vite root)
    main.js        # App entry point — boots i18n, auth, router, search forms
    router.js      # SPA tab routing + URL parameter management
    search.js      # Search form rendering and API calls
    table.js        # Results table rendering
    i18n.js        # Locale detection, lazy-loading, t() helper
    i18n/          # Translation modules (en.js bundled, others lazy-loaded)
    contributors/  # Contributors tab, match views, special source stats
    tree/          # Ancestor/descendant tree views, compare, GEDCOM export
    lib/           # Shared utilities (url, dates, utils, view-cache, etc.)
    style/         # CSS files
  tools/           # Data import and match-computation scripts
    import_to_db.py
    compute_matches.py
    trigger_matches.py
  vite.config.shared.js  # Shared Vite config factory used by all sites
sites/
  slo/             # Slovenia installation
  cro/             # Croatia installation
  test/            # Test installation
    web/
      site.config.js   # Per-site: apiHost, languages, defaultLang, authUrl, i18n overrides
      public/          # Site-specific logo and favicons
    vite.config.js     # Thin wrapper: calls createSiteConfig() from core
    package.json
    docker-compose.yml
    .env.example
data/              # Gitignored — raw GEDCOM files and extracted JSON
```

### How Multi-Site Sharing Works

Each site's `vite.config.js` calls `createSiteConfig()` from `core/vite.config.shared.js`. This sets the Vite root to `core/web/` and resolves the `@site-config` alias to `sites/<name>/web/site.config.js`. All frontend code imports site-specific values through that alias—never hardcoded. The site's `public/` directory overrides core's, enabling per-site assets.

### Backend Structure

- `models.py` — SQLAlchemy ORM: `Person`, `Family`, `Contributor`, `Match`, `MatchJob`, `MatriculaBook`, `GeneanetCemetery`
- `database.py` — SQLAlchemy engine + `SessionLocal`
- `api.py` — FastAPI routes, CORS, optional JWT auth middleware
- `crud.py` — All DB query logic; in-memory caches with TTL for expensive queries (contributor lists, match counts, timelines)
- `schemas.py` — Pydantic response models

The Docker volume mounts `core/backend/src` directly into the container, so backend code changes take effect without rebuilding the image.

### Contributor Naming Conventions

Contributors with `-matricula`, `-geneanet`, or `-military` suffixes are "special" non-tree sources. They are folded into their base name for display and excluded from the `tree` source filter. This logic lives in `crud.py` (`SPECIAL_SUFFIXES`).

### Authentication (Optional)

Protected API endpoints (`/api/ancestors`, `/api/descendants`, `/api/contributors/{name}/matches/{other}`) are gated by JWT when `JWT_SECRET` env var is set. The token comes from a WordPress site running the JWT Authentication for WP REST API plugin. When `JWT_SECRET` is unset, these endpoints are public. Frontend reads `authUrl` from `site.config.js`—when set, a login button appears in the navbar.

### Data Pipeline

GEDCOM files are processed externally by the [ged-tools](https://github.com/rodoslovje/ged-tools) repo, which produces JSON files in `data/output/`. The `metadata.json` file (also written by ged-tools) provides contributor URLs loaded by the backend at runtime.

Import flow: `data/input/*.ged` → ged-tools cleanup → `data/filtered/*.ged` → ged-tools extraction → `data/output/*.json + metadata.json` → `import_to_db.py` → PostgreSQL → `trigger_matches.py` (cross-contributor matching via pg_trgm).

### Match Computation

Cross-contributor matching uses PostgreSQL trigram similarity (`pg_trgm`). Confidence scoring weights: surname 35%, name 30%, year 20%, place 15%. Configurable thresholds in `compute_matches.py`: `CONFIDENCE_MIN=0.80`, `TRGM_THRESHOLD=0.72`, `YEAR_TOLERANCE=5`.

### Frontend SPA Routing

The app is a single-page application. Tabs map to `?t=` URL parameters (general, person, family, contributors, ancestors, descendants). `router.js` handles tab switching, history management, and three "side routes" that bypass the tab system: `?t=matricula`, `?t=geneanet`, and `?t=compare`. Premium tabs (ancestors, descendants, compare) require a valid JWT when auth is configured.

### i18n

English strings are bundled at build time; other locales are lazy-loaded on first selection. Site-specific strings (title, society name, intros) in `site.config.js` override the shared locale strings. Language preference is persisted in `localStorage`.
