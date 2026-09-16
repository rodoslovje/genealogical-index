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

# Audit stored matches (read-only): per-rule removal counts + labelling sample
docker compose exec api python tools/audit_matches.py
docker compose exec api python tools/audit_matches.py --score data/output/match_audit_sample.csv
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

Genealogists who have passed away are marked with a `deceased` value (`"1948-2024"`, `"2024"`, or `true`), an optional `memorial_url`, and their `full_name`. These come from `metadata.json` and are copied into the `contributors` table by `sync_contributor_metadata()` on every import (DB wins at read time, same as `intro`). `full_name` is deliberately returned by the API **only** for contributors marked deceased, so living genealogists' real names stay out of public responses. The UI shows a 🕯 next to the name wherever it appears and an "In memoriam" panel on their contributor page; their data stays fully available.

Contributors with `-matricula`, `-geneanet`, or `-military` suffixes are "special" non-tree sources. They are folded into their base name for display and excluded from the `tree` source filter. This logic lives in `crud.py` (`SPECIAL_SUFFIXES`).

### Authentication (Optional)

Protected API endpoints (`/api/ancestors`, `/api/descendants`, `/api/contributors/{name}/matches/{other}`) are gated by JWT when `JWT_SECRET` env var is set. The token comes from a WordPress site running the JWT Authentication for WP REST API plugin. When `JWT_SECRET` is unset, these endpoints are public. Frontend reads `authUrl` from `site.config.js`—when set, a login button appears in the navbar.

### Data Pipeline

GEDCOM files are processed externally by the [ged-tools](https://github.com/rodoslovje/ged-tools) repo, which produces JSON files in `data/output/`. The `metadata.json` file (also written by ged-tools) provides contributor URLs loaded by the backend at runtime.

Import flow: `data/input/*.ged` → ged-tools cleanup → `data/filtered/*.ged` → ged-tools extraction → `data/output/*.json + metadata.json` → `import_to_db.py` → PostgreSQL → `trigger_matches.py` (cross-contributor matching via pg_trgm).

### Match Computation

Cross-contributor matching uses PostgreSQL trigram similarity (`pg_trgm`). Confidence scoring weights: surname 35%, name 30%, year 20%, place 15%. Configurable thresholds in `compute_matches.py`: `CONFIDENCE_MIN=0.80`, `TRGM_THRESHOLD=0.72`, `YEAR_TOLERANCE=5`.

Person pairs that clear the confidence threshold then pass a set of **precision gates** (the `flagged`/`gated`/`ranked` CTEs in `_PERSON_INSERT`, constants in the "precision gates" block): year contradictions, differing full dates, sex, parents, placeholder names, generation slips, child-death-vs-married, source-aware cemetery/register rules, an "evidence must agree" gate, and one-to-one pruning. The gates are source-aware: `source_type()` classifies a contributor from its suffix (`-geneanet` cemetery, `-matricula` parish register, `-military`, else GEDCOM). Family pairs get no gates. Every gate was validated on hand-labelled samples with `tools/audit_matches.py`, which re-evaluates them against the stored table and is the regression check after a recompute.

### Frontend SPA Routing

The app is a single-page application. Tabs map to `?t=` URL parameters (general, person, family, contributors, tree). `router.js` handles tab switching, history management, and three "side routes" that bypass the tab system: `?t=matricula`, `?t=geneanet`, and `?t=compare`. Premium views (tree, compare) require a valid JWT when auth is configured. Legacy `?t=ancestors` / `?t=descendants` links are rewritten to `?t=tree&dir=anc|desc` by `normalizeLegacyURL()`.

### Tree page

`?t=tree` (`core/web/tree/`) is one page for every direction and chart, driven by URL params: `dir=both|anc|desc` (default `both`, the bowtie: ancestors left / descendants right in the tree, top / bottom halves in the fan), `chart=fan|tree|circle` (default `fan`; `circle` is not offered for a bowtie) and `gens=N` (generation limit, 0 = all; per-chart defaults in `toolbar.js` — the fan starts at 6, the tree unlimited). The generations select offers "All" plus 3 up to the depth the fetched data actually has (`treeDepth()` in `data.js`), so it is rebuilt once the trees land; a limit deeper than the data prunes nothing and shows as "All". `index.js` fetches each side from the existing `/api/ancestors` and `/api/descendants` endpoints, caches the data in module state so toolbar switches and language changes re-render without a refetch, and builds exports from what's shown. `data.js` builds the d3 hierarchies (Ahnentafel slots for ancestors, generation pruning); `layout-tree.js` and `layout-fan.js` each turn `{anc, desc}` hierarchies into a view (nodes, bounds, anchor, `draw()`), writing screen coordinates into `d.x` (vertical) / `d.y` (horizontal) so the zoom, minimap and SVG export in `svg.js` are layout-agnostic. `ancestors.js` / `descendants.js` hold the direction-specific CSV/GEDCOM walkers and marriage/family decorations.

`toolbar.js` owns the `dir` / `chart` / `gens` URL parsing and renders the toolbar; it is shared with the compare page, which is why a page passes in its own `hrefFor` / `navigate`.

### Compare page

`?t=compare` (`core/web/tree/compare.js`) superimposes two genealogists' trees, rooted at a matched person pair identified by two stable `(contributor, ext_id)` pairs (`ca`/`a`, `cb`/`b`), and colours every node by its comparison status. It takes the same `dir` / `chart` / `gens` params as the tree page and the same defaults — `dir` additionally accepts the long forms `ancestors` / `descendants` that the page originally shipped with. Each side is a separate `/api/compare/{ancestors,descendants}` call, cached per person pair in module state, so toolbar switches never refetch.

Layout and geometry come from the tree page's layouts: `fan`/`circle` pass a `decor` (fill / name colour / no hrefs) into `layoutFan`, while `chart=tree` uses `layoutTree`'s positions but draws its own status-coloured nodes. Clicking any node opens the side-by-side field detail instead of navigating away. The legend counts what is actually drawn (recomputed client side after generation pruning, with the focus person counted once in a bowtie), and the CSV/GEDCOM/SVG exports follow the same pruned trees, with a bowtie numbering ancestors negatively.

### i18n

English strings are bundled at build time; other locales are lazy-loaded on first selection. Site-specific strings (title, society name, intros) in `site.config.js` override the shared locale strings. Language preference is persisted in `localStorage`.

Strings with counts go through `tf(key, ...args)` in `i18n.js`, which fills `{N}` placeholders and resolves plural blocks of the form `{N|form one|form two|…}` (with `#` standing for the number inside a form). Forms are listed in the locale's CLDR category order: `one|two|few|other` for Slovenian (singular/dual/paucal/plural), `one|few|other` for Croatian, `one|other` for the rest. Pass a number, or `{ n, html }` when the number must be wrapped in markup.
