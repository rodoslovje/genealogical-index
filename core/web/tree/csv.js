import { t } from '../i18n.js';
import { formatExportFilename } from '../lib/utils.js';
import { csvCell, csvRow, csvFooter, downloadCsv } from '../lib/csv.js';

// Flat CSV export for both trees (one row per person). Re-exported via
// tree/shared.js. d3 is loaded globally from the CDN.

// CSV columns shared by both trees, in output order. Row objects produced by
// the per-tree row builders use these same keys; headers come from `col_<key>`.
// One row per person, carrying the full set of person fields the API now
// returns (birth, baptism, death, notes, links) plus that person's partner and
// marriage for the union represented by the row.
const CSV_COLUMNS = [
  'generation',
  'name',
  'surname',
  'alt_surname',
  'date_of_birth',
  'place_of_birth',
  'date_of_baptism',
  'place_of_baptism',
  'date_of_death',
  'place_of_death',
  'notes',
  'links',
  'partner',
  'date_of_marriage',
  'place_of_marriage',
];

// Source links arrive as a JSON array of URLs; flatten to a space-separated
// string for the single CSV cell (URLs never contain spaces).
function formatLinksCell(links) {
  if (Array.isArray(links)) return links.join(' ');
  return links || '';
}

// Builds one CSV row for a single person, with their partner (name + surname)
// and the marriage date/place for the union this row represents. `partner` and
// `marriage` may be null (a person shown without a recorded marriage).
export function personRow(person, generation, partner, marriage) {
  return {
    generation,
    name: person?.name || '',
    surname: person?.surname || '',
    alt_surname: person?.alt_surname || '',
    date_of_birth: person?.date_of_birth || '',
    place_of_birth: person?.place_of_birth || '',
    date_of_baptism: person?.date_of_baptism || '',
    place_of_baptism: person?.place_of_baptism || '',
    date_of_death: person?.date_of_death || '',
    place_of_death: person?.place_of_death || '',
    notes: person?.notes || '',
    links: formatLinksCell(person?.links),
    partner: partner ? [partner.name, partner.surname].filter(Boolean).join(' ') : '',
    date_of_marriage: marriage?.date || '',
    place_of_marriage: marriage?.place || '',
  };
}

// Wires the CSV-download button. `buildRows()` is supplied by each tree and
// returns one row object per person (with an extra row per marriage), keyed by
// CSV_COLUMNS. The flat list keeps a `generation` column so the tree structure
// survives the export, and marriage rows carry partner + date/place of marriage.
// The footer mirrors the search/table CSV exports: site + timestamp, then an
// "Iskanje" block listing the subject criteria and the page URL.
export function attachCsvExport({ downloadBtnId, buildRows, personName, contributorName, criteria, filePrefix }) {
  const btn = document.getElementById(downloadBtnId);
  if (!btn) return;
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    // Ascending by generation (0, 1, 2, …); the stable sort preserves each
    // tree's natural within-generation traversal order.
    const rows = (buildRows() || []).slice().sort((a, b) => a.generation - b.generation);

    const header = CSV_COLUMNS.map(col => csvCell(t('col_' + col))).join(',');
    const body = rows.map(row => CSV_COLUMNS.map(col => csvCell(row[col])).join(','));

    // Subject criteria block — the person the tree was built for, plus source.
    const criteriaRows = [];
    if (criteria?.name)    criteriaRows.push(csvRow([t('col_name'), criteria.name]));
    if (criteria?.surname) criteriaRows.push(csvRow([t('col_surname'), criteria.surname]));
    if (criteria?.dob)     criteriaRows.push(csvRow([t('label_birth'), criteria.dob]));
    if (contributorName)   criteriaRows.push(csvRow([t('tree_source'), contributorName]));
    // The page URL is emitted once by csvFooter(), so it's not repeated here.
    const extraRows = criteriaRows.length
      ? [csvCell(t('tab_search')), ...criteriaRows]
      : [];

    const filename = formatExportFilename(`${filePrefix}-${personName || filePrefix}`, 'csv');
    downloadCsv([header, ...body, '', ...csvFooter(extraRows)], filename);
  });
}
