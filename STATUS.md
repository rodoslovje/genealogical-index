# STATUS — genealogical-index
_Updated 2026-11-23_

Monorepo for indeks.rodoslovje.si (SRD) and indeks.rodoslovlje.hr. Rules: `CLAUDE.md`.
Last work: matches split into sections (trees / Matricula by parish / cemeteries
by place / military), counting the tree only (15. 10.); `source_unit` on every
special-source record, now written by ged-tools'
converters instead of an import-time SQL pass (24. 10.); public MCP server at
`/mcp` (README §8), SQLAlchemy 2.1 + psycopg 3, Vite 8.3; GEDCOM date qualifiers
shown short (~ < > x–y) with tap tooltips, row icons tappable (31. 10.);
search ranked best hit first + `X-Total-Count`, `skip`, `exclude_contributor`
on the advanced searches, `same_as=true` on person search (also MCP, with `total`, `url`, new `get_person`), for GED Merge's
index hints (17. 11.); `include_undated` on the advanced searches (18. 11.).
cro upgraded to current main 19. 11. (migrations 002–008 + 015–017, API
rebuild, web) — both sites now run the same code.

**Next**
- [ ] SIstory WW1 + WW2 victims (`SIstory-WW1-military` 33 501 persons,
      `SIstory-WW2-military` 101 611, no families) converted 22.–23. 11.: sync +
      `import_to_db --mode update` on slo, `trigger_matches`, then
      `audit_matches` (first sources in `DATED_MILITARY`)
- [ ] Watch ranked-search speed: fuzzy `surname=Novak` on slo 3.5 s cold,
      0.5 s warm (17. 11.); EXPLAIN ANALYZE if it grows
- [ ] MCP is deployed on both sites: decide on an announcement
- [ ] MCP tools for trees / compare / match detail, once they check the JWT
- [ ] MCP ideas not done: Matricula / cemetery catalogue tool, batch search
- [ ] Re-convert slo Matricula + Geneanet with ged-tools `--mode full` so every
      JSON carries `source_unit` (no re-import needed; cro has no special sources)
- [ ] Usability backlog from the 27. 9. review of the live site: `IDEAS.md`
      (first up: silent 999-row search cap, search panel closing after every search)

**Decided**
- SIstory WW1 / WW2 victims are `-military` sources for display, but gated as
  a GEDCOM (`DATED_MILITARY`): their dates are recorded, not age-derived
- MCP is public and exposes only what logged-out visitors see; no premium data
- DB driver psycopg 3 with `ClientCursor` (client-side binding, as psycopg2)
- Matches are for trees: only tree contributors get a Matches section, and it
  counts the tree's own matches only (not those of the genealogist's indexes)
- Matricula / cemetery matches: one row per parish / place across all transcribers
- Geneanet groups by cemetery *place* (postcode dropped), not cemetery
- `source_unit` is set in the record JSON by ged-tools, never derived at import
- Dates: short form for display only; sort, search, exports keep the raw GEDCOM
- `srd-tokens.css` / `srd.css` shared verbatim with genetic-atlas
- Person search may show *which* records are matched (`same_as`: contributor
  + ext_id) publicly; confidence and field detail stay behind the login
- Search results are ordered by relevance (exact field, trigram similarity,
  year distance, id), not left to the planner
- CORS: per-site allow-list (site + gedmerge.com) plus dev origins
  (localhost / LAN / Tailscale); unset = any origin
- Per-site config under `sites/<slo|cro|test>/`
- cro server: `root@indeks.rodoslovlje.hr`, repo `/var/cgi/genealogical-index`,
  web root `/var/caddy/sites/cgi/` (README's `/var/www/sites/cgi` is wrong for
  it), DB backups in `/var/cgi/backups/`
