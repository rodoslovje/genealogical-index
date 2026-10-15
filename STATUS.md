# STATUS — genealogical-index
_Updated 2026-10-15_

Monorepo for indeks.rodoslovje.si (SRD) and indeks.rodoslovlje.hr. Rules: `CLAUDE.md`.
Last work: matches split into sections (trees / Matricula by parish / cemeteries
by place / military), counting the tree only (15. 10.); `source_unit` on every
special-source record (15. 10.); baptism icon `~` (27. 9.).

**Next**
- [ ] Deploy migration 016 + `import_to_db.py --source-units-only` on slo and cro
- [ ] Usability backlog from the 27. 9. review of the live site: `IDEAS.md`
      (first up: silent 999-row search cap, search panel closing after every search)

**Decided**
- Matches are for trees: only tree contributors get a Matches section, and it
  counts the tree's own matches only (not those of the genealogist's indexes)
- Matricula / cemetery matches: one row per parish / place across all transcribers
- Geneanet groups by cemetery *place* (from the cemetery index, postcode dropped), not cemetery
- `srd-tokens.css` / `srd.css` shared verbatim with genetic-atlas
- Per-site config under `sites/<slo|cro|test>/`
