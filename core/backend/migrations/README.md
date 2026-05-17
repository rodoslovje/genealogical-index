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

### Rollback

If the migration fails partway, the `BEGIN/COMMIT` block aborts the
whole thing — the table is untouched. If it commits but the API turns
out to misbehave, rolling back means restoring from the `pg_dump`
above and re-deploying the previous API image. There is no easy
in-place JSONB → TEXT downgrade because the new code wouldn't run
against a TEXT schema.
