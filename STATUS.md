# STATUS — genealogical-index
_Updated 2026-10-31_

Monorepo for indeks.rodoslovje.si (SRD) and indeks.rodoslovlje.hr. Rules: `CLAUDE.md`.
Last work: matches split into sections (trees / Matricula by parish / cemeteries
by place / military), counting the tree only (15. 10.); `source_unit` on every
special-source record, now written by ged-tools'
converters instead of an import-time SQL pass (24. 10.); public MCP server at
`/mcp` (README §8), SQLAlchemy 2.1 + psycopg 3, Vite 8.3 (31. 10.).

**Next**
- [ ] Deploy MCP + driver upgrade: `docker compose up -d --build api` on each
      site (requirements changed). Then decide whether it gets a guide /
      changelog entry and an announcement
- [ ] MCP tools for trees / compare / match detail, once they check the JWT
- [ ] Deploy: migration 016 on cro if not yet run; re-convert Matricula + Geneanet
      with ged-tools `--mode full` so every JSON carries `source_unit` (no re-import
      needed — labels already in the DB from the last SQL pass are identical)
- [ ] Usability backlog from the 27. 9. review of the live site: `IDEAS.md`
      (first up: silent 999-row search cap, search panel closing after every search)

**Decided**
- MCP is public and exposes only what logged-out visitors see; no premium data
- DB driver psycopg 3 with `ClientCursor` (client-side binding, as psycopg2)
- Matches are for trees: only tree contributors get a Matches section, and it
  counts the tree's own matches only (not those of the genealogist's indexes)
- Matricula / cemetery matches: one row per parish / place across all transcribers
- Geneanet groups by cemetery *place* (postcode dropped), not cemetery
- `source_unit` is set in the record JSON by ged-tools, never derived at import
- `srd-tokens.css` / `srd.css` shared verbatim with genetic-atlas
- Per-site config under `sites/<slo|cro|test>/`
