# STATUS — genealogical-index
_Updated 2026-10-15_

Monorepo for indeks.rodoslovje.si (SRD) and indeks.rodoslovlje.hr. Rules: `CLAUDE.md`.
Last work: `source_unit` (Matricula parish / Geneanet cemetery place) on every
special-source record + Matches section only on tree panels (15. 10.); baptism
icon `~` (27. 9.), login field improvements (27. 9.).

**Next**
- [ ] Deploy migration 016 + `import_to_db.py --source-units-only` on slo and cro
- [ ] UI: group matches against Matricula / Geneanet per parish / place (design to discuss)
- [ ] Decide: should a tree owner's match list keep matches found via their own
      Matricula / Geneanet / military data (API folds all own sources today)?
- [ ] Usability backlog from the 27. 9. review of the live site: `IDEAS.md`
      (first up: silent 999-row search cap, search panel closing after every search)

**Decided**
- Matches are for trees: only tree contributors get a Matches section
- Geneanet groups by cemetery *place* (from the cemetery index, postcode dropped), not cemetery
- `srd-tokens.css` / `srd.css` shared verbatim with genetic-atlas
- Per-site config under `sites/<slo|cro|test>/`
