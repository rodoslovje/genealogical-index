# Genealogical Index

A searchable web application for genealogical data with a PostgreSQL database, Python FastAPI backend, and a vanilla JavaScript frontend. Designed as a monorepo that supports multiple country installations sharing the same core code but with per-site branding, translations, and configuration.

## List of Genealogical Index sites

- [indeks.rodoslovje.si](https://indeks.rodoslovje.si) - run by [Slovensko rodoslovno društvo](https://rodoslovje.si/)
- [indeks.rodoslovlje.hr](https://indeks.rodoslovlje.hr) - run by [Hrvatsko rodoslovno društvo "Pavao Ritter Vitezović"](https://rodoslovlje.hr/)

## Architecture

| Layer            | Technology                                      |
| ---------------- | ----------------------------------------------- |
| Database         | PostgreSQL 16 (with `pg_trgm` for fuzzy search) |
| Backend API      | Python 3.11 / FastAPI / Uvicorn                 |
| Frontend         | Vanilla JS / HTML / CSS (Vite build)            |
| Reverse proxy    | Caddy 2                                         |
| Containerisation | Docker & Docker Compose                         |

```
Internet → Caddy → /          → static files (site dist/)
                 → api.domain → Docker: sgi_api (FastAPI :8000)
                                        ↕
                                Docker: sgi_postgres (:5432)
```

---

## Repository Layout

```
packages/
  core/
    web/          # Shared frontend (JS / HTML / CSS) — imports @site-config
    backend/      # Shared FastAPI application
    tools/        # Shared JSON import scripts
  sites/
    slo/          # Slovenia installation
      web/
        site.config.js   # Branding, languages, intro texts, API host
        public/          # Logo, favicons
      vite.config.js     # Sets root=core/web, resolves @site-config alias
      package.json       # name: "slo-index"
      docker-compose.yml
      .env.example
      caddy/
data/             # Gitignored — raw GEDCOM files and extracted JSON
```

### Adding a new country installation

1. Copy `packages/sites/slo/` to e.g. `packages/sites/cro/`.
2. Edit `packages/sites/cro/web/site.config.js` — set logo, links, languages, intro texts, API host.
3. Replace assets in `packages/sites/cro/web/public/`.
4. Edit `packages/sites/cro/package.json` — set a unique `name` (e.g. `"cro-index"`).
5. Add workspace scripts to the root `package.json`:
   ```json
   "dev:cro": "npm run dev --workspace=packages/sites/cro",
   "build:cro": "npm run build --workspace=packages/sites/cro"
   ```
6. Set up a `docker-compose.yml` and `.env` in `packages/sites/cro/` pointing to the new server's data directory and API host.

---

## Prerequisites

### Local development machine

**Windows**

| Tool              | Install                                                                                                | Notes                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git               | [GitHub Desktop](https://desktop.github.com) _(recommended)_ or [Git for Windows](https://git-scm.com) | GitHub Desktop bundles Git and makes `git` available system-wide in PowerShell/Command Prompt; **Git for Windows also installs Git Bash**, which supports `python3`, `mkdir -p`, and most bash commands used in this guide |
| Node.js LTS + npm | [nodejs.org](https://nodejs.org)                                                                       | Use the Windows installer; npm is included                                                                                                                                                                                 |
| Python 3.11+      | [python.org/downloads](https://www.python.org/downloads/)                                              | Required for data processing (sections 1.1–1.2); tick **"Add Python to PATH"** during install; after install `python` and `pip` are available in PowerShell                                                                |
| Docker Desktop    | [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop)                       | Enable the WSL2 backend during setup; required only to run the backend stack locally                                                                                                                                       |
| Text editor       | [VS Code](https://code.visualstudio.com) _(recommended)_                                               |                                                                                                                                                                                                                            |

**macOS**

| Tool              | Install                                                                          | Notes                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Git               | Pre-installed                                                                    | Xcode Command Line Tools are prompted automatically on first `git` use; GitHub Desktop is an optional GUI |
| Node.js LTS + npm | [nodejs.org](https://nodejs.org) or `brew install node`                          | npm is included                                                                                           |
| Docker Desktop    | [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop) | Required only to run the backend stack locally                                                            |

**Linux (local dev)**

| Tool                    | Install                                                                                                 | Notes                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Git                     | `sudo apt install git`                                                                                  |                                                |
| Node.js LTS + npm       | [NodeSource instructions](https://github.com/nodesource/distributions) or `sudo apt install nodejs npm` |                                                |
| Docker Engine + Compose | [docs.docker.com/engine/install](https://docs.docker.com/engine/install/ubuntu/)                        | Required only to run the backend stack locally |

---

### Server (Ubuntu Linux)

| Tool                                 | Notes                                                  |
| ------------------------------------ | ------------------------------------------------------ |
| Docker Engine + Docker Compose v2    | Runs the PostgreSQL and FastAPI containers             |
| Caddy 2                              | Reverse proxy and TLS termination                      |
| _(Node.js not needed on the server)_ | Frontend is built locally and deployed as static files |

---

### GEDCOM data tools (optional, local)

[ged-tools](https://github.com/rodoslovje/ged-tools) is a Python 3 project used for GEDCOM cleanup and JSON extraction. It can run on any OS where Python 3.11+ is available, or directly on the server.

**Windows users:** run all commands in **Git Bash** (installed with Git for Windows) — it supports `python3`, `source`, `mkdir -p`, and the other bash syntax used below. PowerShell alternatives are noted where they differ.

---

## 1. Data Extraction (Run Locally)

### 1.1 GEDCOM Cleanup (Recommended)

Before importing, GEDCOM files should be stripped of living persons and persons who died within the last 20 years to protect privacy.

Use [ged-tools](https://github.com/rodoslovje/ged-tools), which includes a `srd_index_cleanup` preset with SGI-specific rules.

```bash
# Clone and set up ged-tools (one-time)
git clone https://github.com/rodoslovje/ged-tools.git
cd ged-tools
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

> **Windows (Git Bash):** the commands above work as-is in Git Bash.
> **Windows (PowerShell):** use `python` instead of `python3`, and activate the venv with `.venv\Scripts\Activate.ps1`. If script execution is blocked, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once first.
>
> ```powershell
> git clone https://github.com/rodoslovje/ged-tools.git
> cd ged-tools
> python -m venv .venv
> .venv\Scripts\Activate.ps1
> pip install -r requirements.txt
> ```

The `data/` directory is gitignored. Create it manually with the following layout:

```
data/
├── input/       # Raw .ged files as received from contributors
├── filtered/    # Cleaned .ged files after privacy filtering (see step 1.1)
└── output/      # JSON files extracted for DB import + metadata.json
```

```bash
mkdir -p data/input data/filtered data/output
```

> **Windows (PowerShell):** `mkdir data\input, data\filtered, data\output`

Run the cleanup for all files in the input folder:

```bash
# From inside the ged-tools directory (venv must be active)
python tools/gedcom-cleaner.py --input-dir data/input --output-dir data/filtered --preset index_cleanup_sgi
```

> **Windows (Git Bash):** use the same command; paths like `C:\Users\you\...` are written as `/c/Users/you/...` in Git Bash.
> **Windows (PowerShell):** replace `python3` with `python` and use backslash paths:
>
> ```powershell
> python tools\gedcom-cleaner.py --input-dir data\input --output-dir data\filtered --preset index_cleanup_sgi
> ```

The script runs in update mode by default — it skips files that are already up-to-date. The cleaned files in `data/filtered/` are then ready for JSON extraction.

> The `index_cleanup_sgi` preset: standardises dates and places, removes records with no valid names, and anonymises persons likely still living (within 100 years of birth) or who died within the last 20 years.

### 1.2 JSON Extraction

Extract JSON records from the cleaned GEDCOM files into the format required for DB import.

The extraction script has moved to [ged-tools](https://github.com/rodoslovje/ged-tools) — the same repo used for cleanup in step 1.1. If you have already cloned and set up ged-tools, no additional setup is needed.

1. Place cleaned `.ged` files in `data/filtered/` (either copied manually or produced by step 1.1).
2. Run the extraction script from inside the ged-tools directory:

   ```bash
   # From inside the ged-tools directory (venv already active from step 1.1)
   python tools/gedcom-to-json.py --mode update
   ```

   > **Windows (PowerShell):** use the full Windows path, e.g. `--data-dir C:\path\to\genealogical-index\data`

   Output JSON files and `metadata.json` are written to `data/output/`.

   **Arguments:**
   - `--mode update` _(default)_ — skips files already up-to-date
   - `--mode full` — reprocesses all files

### 1.3 Sync to server

```bash
rsync -avz --delete data/output/ user@server.com:/var/sgi/genealogical-index/data/
```

> **Windows:** `rsync` is not built into Windows. Choose one of:
>
> | Option                                | How                                                                                                                                                           |
> | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **Git Bash** _(recommended)_          | Git Bash does not ship `rsync` by default. Install it via [MSYS2](https://www.msys2.org): `pacman -S rsync`, then run the command above in the MSYS2 terminal |
> | **WSL (Windows Subsystem for Linux)** | Install WSL (`wsl --install` in PowerShell), then run the rsync command inside WSL using Linux-style paths                                                    |
> | **WinSCP** _(GUI alternative)_        | Use the [WinSCP](https://winscp.net) "Keep remote directory up to date" feature to mirror `data\output\` to the server                                        |

---

## 2. Server Setup

### 2.1 Create the shared Docker network

Caddy (running on the host or in its own container) and the app containers communicate over a shared Docker network called `caddy_net`.

```bash
docker network create caddy_net
```

> If you already have a Caddy container on `caddy_net`, skip this step.

### 2.2 Configure environment variables

Copy the example file and fill in your values (from the site directory, e.g. `packages/sites/slo/`):

```bash
cp packages/sites/slo/.env.example packages/sites/slo/.env
```

Edit `.env`:

```env
# PostgreSQL credentials
POSTGRES_DB=sgi_db
POSTGRES_USER=sgi_user
POSTGRES_PASSWORD=a_strong_password_here

# API hostname (without https://) — must match your Caddy config
API_HOST=api.yourdomain.com
```

### 2.3 Build and start the backend containers

```bash
cd packages/sites/slo
docker compose up -d --build
```

This starts two containers:

- `sgi_postgres` — PostgreSQL database (data persisted in `postgres_data` Docker volume)
- `sgi_api` — FastAPI application on internal port 8000

Verify they are running:

```bash
docker compose ps
```

### 2.4 Import data into PostgreSQL

With the containers running, load the extracted JSON data:

```bash
docker compose exec api python tools/import_to_db.py --mode update
```

**Arguments:**

- `--mode update` _(default)_ — only reimports contributors whose data has changed
- `--mode full` — reimports all contributors
- `--drop-tables` — drops and recreates all tables first (full reimport)
- `--force-births` / `--force-families` / `--force-deaths` — force reimport of specific record types

---

## 3. Caddy Setup (Docker)

Caddy runs as a Docker container on the same `caddy_net` network as the app. It handles TLS automatically and resolves backend containers by name. A `conf.d/` folder pattern lets each service ship its own `.caddyfile` snippet that Caddy imports on startup.

### 3.1 Server directory layout

This repository ships ready-made Caddy config files in `packages/sites/slo/caddy/`:

```
caddy/
├── docker-compose.yml   # Caddy container definition
├── Caddyfile            # Root config — imports conf.d/
├── conf.d/              # Per-service snippets — one .caddyfile per project
│   └── sgi.caddyfile    # This project's site block
```

Copy the `caddy/` directory and subfolders to your server once (shared by all services):

```bash
scp -r packages/sites/slo/caddy/ user@yourserver:/var/caddy
```

### 3.2 Root Caddyfile

`caddy/Caddyfile` imports all snippets from `conf.d/` automatically. No edits needed when adding new services — just drop a file in `conf.d/` and reload.

### 3.3 Caddy docker-compose.yml

`caddy/docker-compose.yml` defines the Caddy container. Key points:

- Ports 80/443 exposed to the internet
- `conf.d/` bind-mounted read-only — edit files on the host, reload Caddy to apply
- TLS certificate data stored in a named Docker volume (`caddy_data`) so certs survive container restarts
- `/var/www` bind-mounted read-only for static sites

Start Caddy:

```bash
cd /var/caddy
docker compose up -d
```

### 3.4 Per-service snippet (this project)

This repository ships a ready-made snippet at `caddy/sgi.caddyfile`. Copy it to the server and customise the domain names:

```bash
scp packages/sites/slo/caddy/sgi.caddyfile user@yourserver:/srv/caddy/conf.d/sgi.caddyfile
```

Edit the copy on the server — replace `yourdomain.com` and `api.yourdomain.com`:

```caddyfile
# Frontend — serves the built Vite app
yourdomain.com {
    root * /var/www/sgi
    file_server
    try_files {path} /index.html
    encode gzip
}

# Backend API — reverse proxy to the Docker container
api.yourdomain.com {
    reverse_proxy sgi_api:8000
    encode gzip
}
```

> Caddy resolves `sgi_api` by container name because both the Caddy container and the app containers are on `caddy_net`.

> TLS certificates are obtained from Let's Encrypt automatically — no extra configuration needed.

### 3.5 Reload Caddy after config changes

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# Validate before reloading:
docker exec caddy caddy validate --config /etc/caddy/Caddyfile && \
  docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### 3.6 Adding another service later

1. Drop a new `myservice.caddyfile` into `/var/caddy/conf.d/`.
2. Reload Caddy (step 3.5). No changes to the root `Caddyfile` or Caddy container needed.

---

## 4. Frontend Build and Deployment

### 4.1 Configure the API host

The frontend reads the API host from the `apiHost` field in `packages/sites/slo/web/site.config.js`. Edit that field directly before building.

### 4.2 Install dependencies

```bash
npm install
```

### 4.3 Build

```bash
# Slovenia
npm run build:slo
```

The production-ready files are written to `packages/sites/slo/dist/`.

### 4.4 Deploy to the server

Copy the built files to the directory Caddy serves:

```bash
ssh user@yourserver "mkdir -p /var/www/sites/sgi"
rsync -avz --delete packages/sites/slo/dist/ user@yourserver:/var/www/sites/sgi/
```

No Caddy reload is needed — Caddy serves files directly from disk.

---

## 5. Updating

### Backend code change

```bash
cd packages/sites/slo
docker compose up -d --build api
```

### Data update (new GEDCOM files)

```bash
# 1. locally — clean raw GEDCOM files (remove living persons / recent deaths)
#    see Section 1.1 for ged-tools setup; run from inside the ged-tools directory
python tools/gedcom-cleaner.py \
  --input-dir /path/to/srd-slo-index/data/input \
  --output-dir /path/to/srd-slo-index/data/filtered \
  --preset index_cleanup_sgi

# 2. locally — re-extract JSON from cleaned files (run from inside ged-tools directory)
python tools/gedcom-to-json.py --mode update

# 3. copy data/output/ to server (Windows: see Section 1.3 for rsync alternatives)
rsync -avz --delete data/output user@yourserver:/var/sgi/genealogical-index/data/

# 4. on server — reimport changed contributors
cd packages/sites/slo
docker compose exec api python tools/import_to_db.py --mode update
```

### Frontend change

```bash
npm run build:slo
rsync -avz --delete packages/sites/slo/dist/ user@yourserver:/var/www/sites/sgi/
```

---

## 6. Local Development

Start the Vite dev server (accessible on the local network):

```bash
npm run dev:slo
```

The dev server runs on port 1995 and hot-reloads on file changes in both `packages/core/web/` and `packages/sites/slo/web/`.

Preview the production build locally:

```bash
npm run build:slo && npm run preview:slo
```
