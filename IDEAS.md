# IDEAS — usability backlog

Findings from a usability review of the live **indeks.rodoslovje.si** on 2026-09-27
(data update 2026-09-27, build 2026-09-16). Reviewed by driving the production site
in Chromium at 1440 / 1024 / 820 / 768 / 390 px, exercising search, contributors,
matricula, geneanet, tree gating and the guide, and cross-checking against
`indeks-api.rodoslovje.si` and the source.

No JS errors, no failed requests, searches returned in ~0.5–1 s over 3.1 M persons.
Everything below is about what the interface *tells the user*, not about stability.

Working well and deliberately left alone: deep-linkable URLs for every view, the
per-table filter and CSV export, contributor pages with surname clouds and match
tables, the Geneanet map, the standalone user guide, the i18n flash-prevention and
the progressive/virtualised table rendering.

---

## High impact

- [ ] **Search silently truncates at 999 rows.**
  `limit: int = 999` in [`api.py:230`](core/backend/src/api.py#L230), and the frontend
  never sends a `limit` ([`search.js:76-82`](core/web/search.js#L76-L82)).
  `surname=Novak` returns exactly 999; so does `surname=Novak&contributor=Hawlina`,
  so a single genealogist has ≥999 Novaks the user can never reach. The heading reads
  "Osebe (999)" as if that were the answer — no total, no paging, no warning. A
  researcher who narrows by parish and *still* sees 999 has no way to know they are
  looking at an arbitrary alphabetical slice.
  → Minimum: return a total alongside the page and show "999 od 4.812 — zožite iskanje".
  → Better: offset paging or "load more".

- [ ] **The search panel vanishes after every search (desktop).**
  [`search.js:180-184`](core/web/search.js#L180-L184) closes the sidebar on submit.
  The user gets a results table with no visible record of what they searched and must
  find the hamburger to change one field. Iterative narrowing is the core genealogy
  loop, so this costs a click every iteration.
  → Keep the panel open on desktop, or render a clickable query-summary chip row above
  the results ("Priimek: Novak · Točno ✕").

- [ ] **The table filter does not update the count.**
  Filtering `?sn=Kranjc` to "Ljubljana" leaves the heading at "Osebe (999)" while
  showing ~50 rows — [`table.js:721`](core/web/table.js#L721) filters locally, but the
  count is set once in [`search.js:275`](core/web/search.js#L275).
  → Show "57 od 999".

- [ ] **Row icons are hover-only, and are often *why* the row matched.**
  `altSurnameIconHtml` / `baptismIconHtml` / `notesIconHtml` render
  `<span title=… aria-label=…>` with no role and no tabindex
  ([`lib/utils.js:584-605`](core/web/lib/utils.js#L584-L605)). On touch there is no
  hover, so the content is unreachable. Concretely: an exact search for
  `surname=Kranjc` returns 87 rows that matched on `alt_surname`, plus one row whose
  surname column is entirely blank — the user sees "Katarina" with an empty surname
  and a small 🏷, with no way to learn it matched via "Kranjc".
  → Render the alternate surname as visible text (`Levar (Kranjc)`), or make these
  icons focusable buttons that open a popover on tap.

- [ ] **Zero results is a dead end, and "Točno" is the default.**
  A miss shows only "Ni rezultatov." twice. Approximate search works well —
  `Kranjec` approx returns Kranjc / Kranjec / Kranjčevič / Krančan / Krajec. Given how
  much spelling varies across parish registers, exact-by-default strands people.
  → Offer a one-click "Poišči približno" retry on zero results; ideally auto-run it
  and label the results as approximate.

- [ ] **Mobile results are a 12-column table panned sideways.**
  At 390 px the user sees ~4 columns and horizontally scrolls each row; at 768 px the
  table clips with no scroll affordance at all.
  → A stacked card per person (name, dates, place, source, expandable detail) fits the
  reading task far better than a spreadsheet.

- [ ] **Gated features dead-end non-members.**
  The "Samo za člane" modal names the society but does not link it, offers no
  "become a member" path and no password reset.
  [`auth.js:196`](core/web/auth.js#L196) also collapses every failure into one
  `login_error` string, so a wrong password and a down auth server read identically.
  → A membership link here is probably the cheapest conversion win on the site.

---

## Medium

- [ ] **No way to contact a genealogist.** The intro says the contributor's name "lets
  the researcher make further contact", but nothing in the app supports that step.
  A "Contact this genealogist" button on the contributor page (a relay form to the
  society, or a mailto to the admin prefilled with contributor + record) would close
  the loop the whole index exists to open.

- [ ] **All three search tabs show the same long intro.** Person and Family repeat the
  full homepage text verbatim, so neither explains what it does differently or shows
  an example. Two lines of tab-specific lead-in plus one worked example would do more
  than the current wall of text.

- [ ] **Date fields have no format hint.** `normalizeSearchDate` accepts several forms,
  but the inputs carry no `title` while the name/place fields do. Also "Datum" paired
  with "do leta" is inconsistent → "od leta"/"do leta" or "Datum od"/"Datum do".

- [ ] **The contributor input's placeholder is "Vir", inside a group labelled "VIR".**
  It reads as unlabelled → "Priimek rodoslovca".

- [ ] **Twelve fixed columns, several usually empty.** "Datum pokopa", "Kraj pokopa" and
  "Povezave" are blank for most rows, eating the width place names need.
  → Column picker, or auto-hide all-empty columns.

- [ ] **Clicking a person re-runs a search rather than opening a record.** Names link to
  `?t=person&n=…&id=…` ([`table.js:186-195`](core/web/table.js#L186-L195)), so you land
  on a one-row table and still read a person across 12 columns.
  → A proper person page (identity, events, parents/partners/children, sources, tree
  button) is a large readability gain and the natural thing to share.

- [ ] **Link previews are bare.** Only `og:title` is emitted; no `meta description`,
  `og:description` or `og:image` in [`index.html`](core/web/index.html). Genealogy
  links get passed around in Facebook groups and WhatsApp constantly.

- [ ] **🌳 means two things** — the FamilySearch link icon in
  [`lib/links.js:42`](core/web/lib/links.js#L42) and the open-tree button in
  [`table.js:146`](core/web/table.js#L146). Both can appear in the same row.

- [ ] **Surname-cloud words are non-focusable `<span class="cloud-word">`** with
  `cursor:pointer` and a `title` set to just the bare count.
  → Make them links (they navigate anyway) and put the surname in the tooltip.

- [ ] **No print stylesheet, no dark mode, no reduced-motion** anywhere in
  [`style/`](core/web/style/). Printing a results table or a fan chart is a normal
  genealogist workflow.

- [ ] **Data-quality leaks into the UI:** a literal `?` rendered as a surname, and rows
  with empty surnames. Filter at import, or render as an explicit "(neznano)".

- [ ] **Small touch targets.** The tree button measures 29×26 px and sits immediately
  beside the 🏷 icon in the same cell — mis-taps on phones are likely.

---

## Feature ideas, roughly by value

- [ ] **Saved searches / research log** — a logged-in member's standing list of
  surname+parish queries, with "new since last visit". Turns a lookup tool into
  something people come back to.
- [ ] **Watch a surname** — email when a new GEDCOM import adds matches. The data
  already updates on a schedule.
- [ ] **Server-side paging + sort** — the real fix for the 999 cap, and what makes
  "sort by birth date across all 4.812 Novaks" meaningful rather than sorting an
  arbitrary 999.
- [ ] **Place autocomplete** on the place fields, driven by distinct places in the DB.
  Place spelling is at least as variable as surnames.
- [ ] **Results map / timeline** — Leaflet and Chart.js are already loaded for other
  views; plotting a surname's birth places or birth-year distribution answers
  "where did my family come from".
- [ ] **Compare two persons** — the compare engine exists for contributors; the same
  view rooted at two arbitrary people would help users resolve duplicates.
- [ ] **Copy-link button** on results and tree views. URLs are already shareable, but
  nothing says so outside the guide.

---

## Suggested order

1. Result-count honesty (999 cap) and keeping the search panel open. Small, and
   together they fix the main way the app currently misleads about what it is showing.
2. Filter count, alt-surname visibility, zero-result recovery.
3. Membership link in the login modal.
4. Mobile card layout.
