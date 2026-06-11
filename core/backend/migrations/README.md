# DB migrations

Schema changes that aren't safe via `import_to_db.py`'s usual additive
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` path live here.

Each file is a standalone `psql` script that's idempotent — running it
twice should be a no-op.

## Runbook

### 001 — `text_to_jsonb`

Converts the seven JSON-bearing list/object columns from `TEXT` to
`JSONB`. Pairs with the matching code changes that landed alongside this
file (`models.py`, `crud.py`, `import_to_db.py`, `compute_matches.py`).

- Holds `AccessExclusiveLock` on `persons` and `families` for the
  duration of each ALTER. Reads and writes are blocked.
- For ~4M rows on a typical SSD: 5–15 min total. Take a recent
  `pg_dump` first.
- Run during a maintenance window with the API stopped (so it can't
  see a half-migrated state).

```bash
# 0. Back up
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB \
  > backup-pre-jsonb-$(date +%F).sql

# 1. Stop the API so it can't try to talk to half-migrated tables
docker compose stop api

# 2. Run the migration
docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB \
  < core/backend/migrations/001_text_to_jsonb.sql

# 3. Deploy the new API image (which expects JSONB) and start it
docker compose up -d --build api
docker compose logs api --tail 50
```

Re-running the script after success prints `Skipping … (already jsonb)`
for every column and exits clean.

### 002 — `alt_surname_trgm`

Adds partial GIST trigram indexes on `persons.alt_surname`,
`families.husband_alt_surname`, and `families.wife_alt_surname`. Without
them, surname search (`surname OR alt_surname`) seq-scans the table.

- Uses `CREATE INDEX CONCURRENTLY` — no table lock, safe to run online.
- The script must run **outside** a transaction block; pipe it through
  psql directly (no `-c` wrapping that opens a tx).
- Re-runnable (`IF NOT EXISTS`).

```bash
docker compose exec -T db psql -U $POSTGRES_USER -d $POSTGRES_DB \
  < core/backend/migrations/002_alt_surname_trgm.sql
```

### 003 — `trgm_gist_to_gin`

Replaces all `gist_trgm_ops` indexes with `gin_trgm_ops` and drops the
partial WHERE on the alt_surname variants. On a ~1.9M-row `persons` table
the production GIST index scan for a surname search was taking ~8 s by
itself; GIN brings that into the tens-of-ms range for the same query.

- Uses `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` — no
  table lock. Builds new GIN indexes alongside the existing GIST ones,
  then drops the GIST ones, so there's never a window without a trgm
  index.
- Must run **outside** a transaction block (psql `-f` or piped stdin
  works; `-c` wrapping a tx does not).
- Re-runnable: every step is `IF NOT EXISTS` / `IF EXISTS`.
- Disk impact: GIN trgm ≈ 1.5–2× the GIST size while both coexist
  during the build; the GIST indexes get reclaimed when dropped.

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/003_trgm_gist_to_gin.sql
```

### 004 — `place_trgm_gin`

Adds GIN trigram indexes for the three place columns that the search
endpoints actually filter on:

- `persons.place_of_birth`
- `persons.place_of_death`
- `families.place_of_marriage`

Without these, every place search seq-scanned the table.
`place_of_baptism` is intentionally not indexed (no endpoint filters
on it).

- `CREATE INDEX CONCURRENTLY` — no table lock; safe online.
- Must run **outside** a transaction block.
- Re-runnable.

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/004_place_trgm_gin.sql
```

### 005 — `misc_trgm_gin`

Adds GIN trigram indexes for the last batch of columns that `_text_filter`
operates on but that had only btree indexes (or none):

- `persons.contributor`
- `families.contributor`
- `families.husband_name`
- `families.wife_name`

Audited from crud.py — these complete the trgm coverage for every column
the search endpoints filter via ILIKE / `%>`.

- `CREATE INDEX CONCURRENTLY` — online.
- Must run outside a transaction block.
- Re-runnable.

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/005_misc_trgm_gin.sql
```

### 006 — `ext_id_btree`

Adds partial composite btree indexes on `(contributor, ext_id)` for the
three columns the ancestors / descendants endpoints probe by ext_id:

- `persons (contributor, ext_id)`
- `families (contributor, husband_ext_id)`
- `families (contributor, wife_ext_id)`

After the ext_id pivot in commit `8fed381`, every tree-traversal hop ran
`WHERE contributor=? AND ext_id=?`, but only the single-column
`(contributor)` btree existed. The planner therefore fetched all rows for
the contributor and filtered ext_id in memory — for the largest
contributors that was tens of thousands of rows per probe. The new
indexes turn each probe into a direct B-tree lookup.

Indexes are partial (`WHERE ext_id IS NOT NULL AND ext_id <> ''`) so
legacy / matricula rows with empty ext_id don't bloat them; those rows
still resolve via the name/year fallback path in `_batch_resolve_persons`.

- `CREATE INDEX CONCURRENTLY` — online; no table lock.
- Must run **outside** a transaction block.
- Re-runnable (`IF NOT EXISTS`).

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/006_ext_id_btree.sql
```

### 008 — `matches_pair_lookup`

Adds a composite btree index on
`matches (contributor_a, contributor_b, record_type, record_a_id)` for the
tree-comparison endpoint (`/api/compare/ancestors`), which loads the
precomputed person matches between two genealogists to annotate aligned
ancestor pairs with their confidence. The single-column contributor btrees
already serve the query; this composite index lets the planner satisfy the
whole predicate from the index as the matches table grows.

- `CREATE INDEX CONCURRENTLY` — online; no table lock.
- Must run **outside** a transaction block.
- Re-runnable (`IF NOT EXISTS`).

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/008_matches_pair_lookup.sql
```

### 009 — `burial_and_geneanet`

Supports the Geneanet cemeteries data source.

- Adds `date_of_burial`, `burial_year`, `place_of_burial` to `persons`
  (parity with birth/death; populated from each record's `burial {date, place}`
  block) plus a GIN trgm index on `place_of_burial` and a btree on
  `burial_year` so burial search is index-fast.
- Creates the `geneanet_cemeteries` table that backs the standalone
  `?t=geneanet` index page (flat cemetery list with lat/lon for the map).

`ADD COLUMN` (nullable) is a fast metadata-only change; `CREATE INDEX
CONCURRENTLY` runs online. Both `import_to_db.py` paths (`setup_full` /
`setup_update`) already create these for fresh DBs — this file is only for
upgrading an existing production DB in place.

- Must run **outside** a transaction block.
- Re-runnable (`IF NOT EXISTS`).

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/009_burial_and_geneanet.sql
```

### 010 — `family_spouse_birth_year`

Lets general search match a family on either spouse's birth date, not just the
marriage date.

- Adds `husband_birth_year` / `wife_birth_year` SMALLINT to `families` (parity
  with the persons birth/death/burial year columns), back-fills them from the
  existing `husband_birth` / `wife_birth` TEXT columns, and adds a btree on each
  so `search_all`'s OR'd birth conditions stay index-backed instead of
  seq-scanning.

`ADD COLUMN` (nullable) is a fast metadata-only change; the back-fill `UPDATE`
runs once over the table; `CREATE INDEX CONCURRENTLY` runs online. Both
`import_to_db.py` paths (`setup_full` / `setup_update`) already create these for
fresh DBs and populate them on re-import — this file is only for upgrading an
existing production DB in place (and back-filling rows for contributors that
aren't being re-imported).

- Must run **outside** a transaction block.
- Re-runnable (`IF NOT EXISTS`; the back-fill is gated on `IS NULL`).

```bash
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < core/backend/migrations/010_family_spouse_birth_year.sql
```

### Rollback

If the migration fails partway, the `BEGIN/COMMIT` block aborts the
whole thing — the table is untouched. If it commits but the API turns
out to misbehave, rolling back means restoring from the `pg_dump`
above and re-deploying the previous API image. There is no easy
in-place JSONB → TEXT downgrade because the new code wouldn't run
against a TEXT schema.
