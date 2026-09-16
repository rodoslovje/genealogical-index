// User-facing changelog: new features and functionality changes only — never
// individual bug fixes, refactors, infrastructure work, or per-site
// configuration, which concerns whoever runs an installation rather than
// anyone reading one. Newest first, grouped by the date the change shipped
// (the footer's "Version" is that same build date, so a reader can tell what
// their build already has).
//
// One file per language under this directory, lazy-loaded by ../page-lang.js
// (and read at build time by the changelog plugin in vite.config.shared.js) so
// none of it weighs on the app's initial load. English is the fallback for any
// locale that hasn't caught up: a missing file falls back whole, and a date
// this file has but a translation lacks falls back entry by entry, so a new
// release always shows even before it has been translated.
//
// `title` is the headline, `text` the 1-3 sentence explanation. Both may carry
// simple inline HTML (<em>, <strong>, <a>) — the content is ours, so it is
// inserted as written rather than escaped.

export default [
  {
    date: '2026-09-16',
    items: [
      {
        title: 'The tree comparison draws the same charts as the tree page',
        text: 'Comparing two genealogists now opens as a bowtie — the ancestors and the descendants of the matched person at once — and can be drawn as a <em>fan</em> or as a classic <em>tree</em>, with the same generation limit. Every person keeps its comparison colour in all of them.',
      },
    ],
  },
  {
    date: '2026-09-15',
    items: [
      {
        title: 'One family tree page for every direction and chart',
        text: 'The separate ancestors and descendants views have become a single <em>Tree</em> page that opens as a bowtie, showing both at once. You can narrow it to one direction, limit it to a chosen number of generations, and download exactly what you see as SVG, CSV or GEDCOM.',
      },
      {
        title: 'A new fan chart',
        text: 'The fan draws each generation as a ring of wedges around the focus person, with the marriage dates on the bands between them — many more people on screen than a classic tree fits. Showing ancestors or descendants alone, it can be closed into a full circle.',
      },
      {
        title: 'Fewer false matches between sources',
        text: 'The rules that decide whether two records are the same person were re-tuned against hand-checked samples. Contradicting years, differing full dates, mismatched parents, placeholder names and generation slips now rule a pair out, and cemetery and parish-register sources are judged by rules of their own.',
      },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      {
        title: "A genealogist's page is organised by source",
        text: 'Genealogists who contribute from more than one place — their own family tree, the Matricula index, Geneanet cemeteries, military records — now get a tab for each, and every tab carries its own figures and surname cloud.',
      },
      {
        title: 'Geneanet cemetery figures per genealogist',
        text: 'Where a genealogist has contributed grave records, their page now shows how many there are and maps the cemeteries they come from.',
      },
      {
        title: 'Counts read naturally in every language',
        text: 'Numbers in the interface now take the grammatical form the language actually calls for, including the Slovenian dual and the Croatian paucal.',
      },
    ],
  },
  {
    date: '2026-08-28',
    items: [
      {
        title: 'In memoriam',
        text: 'Genealogists who have passed away are marked with a candle next to their name wherever it appears, and their page carries a memorial panel with their name and years. Their work stays fully available in the index.',
      },
    ],
  },
  {
    date: '2026-08-20',
    items: [
      {
        title: 'Matching between sources overhauled',
        text: "The comparison that finds the same person in two genealogists' trees was rebuilt for precision, recall and speed: it finds more genuine overlaps, proposes far fewer wrong ones, and recomputes the whole index far faster.",
      },
      {
        title: 'Table filters can ask for either of two things',
        text: 'In any filter field a space still means "all of these words", but a comma now means "any of these": <em>Ramuta, Simonič</em> finds records carrying either surname, where before it looked for both at once and found nothing.',
      },
    ],
  },
  {
    date: '2026-08-19',
    items: [
      {
        title: "Narrow a genealogist's matches to one surname",
        text: 'The list of genealogists you overlap with can be scoped to a single surname. The counts re-scope with it and genealogists with no match on that surname drop out, so "who else has this surname?" is one field away.',
      },
    ],
  },
  {
    date: '2026-08-09',
    items: [
      {
        title: 'The Sources page opens instantly',
        text: 'The statistics, contribution figures and match counts behind the <em>Sources</em> tab are now kept warm on the server instead of being rebuilt on every visit.',
      },
    ],
  },
  {
    date: '2026-06-25',
    items: [
      {
        title: 'A User Guide',
        text: 'A full guide to searching and reading the index is a click away from the question mark in the top bar, or from the link in the footer — and is a page of its own, so it can be bookmarked and shared.',
      },
    ],
  },
];
