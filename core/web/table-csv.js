import { t } from './i18n.js';
import { isPrivate, parseList } from './lib/utils.js';
import { PARAM_MAP_REVERSE } from './lib/url.js';
import { csvCell, csvRow, csvFooter, downloadCsv } from './lib/csv.js';

// Plain-text "Name Surname | date_of_birth" rendering used by CSV export.
// The " | " before the date gives downstream parsers an unambiguous split
// point, since names/surnames may themselves contain spaces.
function personInlineText(p, hideSurnameIfEquals) {
  if (isPrivate(p.name) || isPrivate(p.surname)) return p.name || p.surname || '';
  let text = p.name || '';
  if (p.surname && p.surname !== hideSurnameIfEquals) text += ` ${p.surname}`;
  const dob = p.date_of_birth || p.year || '';
  if (dob) text += ` | ${dob}`;
  return text;
}

// Columns that a 'parents' column expands into, for person rows vs. family rows.
const PERSON_PARENT_COLUMNS = ['father', 'mother'];
const FAMILY_PARENT_COLUMNS = ['husband_father', 'husband_mother', 'wife_father', 'wife_mother'];

// Expands the 'parents' column into separate father/mother columns so each
// parent gets its own CSV field instead of being combined into one cell.
function expandColumns(columns) {
  const isFamilyTable = columns.includes('husband_name') || columns.includes('husband_surname');
  return columns.flatMap(col => col === 'parents'
    ? (isFamilyTable ? FAMILY_PARENT_COLUMNS : PERSON_PARENT_COLUMNS)
    : [col]);
}

// Picks the father or mother from a parents list, preferring an explicit
// sex field and falling back to the conventional [father, mother] order.
function parentByRole(jsonOrArr, sex, fallbackIndex) {
  const arr = parseList(jsonOrArr);
  if (!arr.length) return '';
  let p = arr.find(x => x && x.sex === sex);
  if (!p && arr.every(x => !x || !x.sex)) p = arr[fallbackIndex];
  return p ? personInlineText(p, '') : '';
}

// Maps one data row to its CSV cell value for a given column, flattening the
// nested parents/children/partners lists and appending the same optional
// fields (alt surname, baptism, notes) the HTML table shows inline.
function cellValue(col, row) {
  if (col === 'father')         return parentByRole(row.parents_list, 'm', 0);
  if (col === 'mother')         return parentByRole(row.parents_list, 'f', 1);
  if (col === 'husband_father') return parentByRole(row.husband_parents, 'm', 0);
  if (col === 'husband_mother') return parentByRole(row.husband_parents, 'f', 1);
  if (col === 'wife_father')    return parentByRole(row.wife_parents, 'm', 0);
  if (col === 'wife_mother')    return parentByRole(row.wife_parents, 'f', 1);
  if (col === 'children' && row.children_list) {
    return parseList(row.children_list)
      .map(c => personInlineText(c, ''))
      .join('; ');
  }
  if (col === 'partners' && row.partners_list) {
    return parseList(row.partners_list)
      .map(p => personInlineText(p, '').trim())
      .join('; ');
  }
  if (col === 'matches') {
    const n = row.matches_count || '';
    return Number(n) === 0 ? '' : n;
  }

  let cellVal = row[col] != null ? row[col] : '';
  if (col === 'total_links' && Number(cellVal) === 0) cellVal = '';

  // Append optional fields to match HTML table display.
  if (col === 'surname' && row.alt_surname) {
    cellVal = `${cellVal} (${row.alt_surname})`.trim();
  } else if (col === 'husband_surname' && row.husband_alt_surname) {
    cellVal = `${cellVal} (${row.husband_alt_surname})`.trim();
  } else if (col === 'wife_surname' && row.wife_alt_surname) {
    cellVal = `${cellVal} (${row.wife_alt_surname})`.trim();
  } else if (col === 'date_of_birth' && (row.date_of_baptism || row.place_of_baptism)) {
    const b = [row.date_of_baptism, row.place_of_baptism].filter(Boolean).join(', ');
    cellVal = `${cellVal} (✝ ${b})`.trim();
  } else if ((col === 'place_of_birth' || col === 'place_of_marriage') && row.notes) {
    cellVal = `${cellVal} (🗒 ${row.notes})`.trim();
  }
  return cellVal;
}

// Builds the contributors-totals footer block (one summary row per metric).
function contributorsSummaryRows(data) {
  const persons = data.reduce((s, r) => s + (r.total_persons || 0), 0);
  const families = data.reduce((s, r) => s + (r.total_families || 0), 0);
  const links = data.reduce((s, r) => s + (r.total_links || 0), 0);
  const lastUpdate = data.reduce((max, r) => (r.last_modified && r.last_modified > max) ? r.last_modified : max, '');
  return [
    csvRow([t('tab_contributors'), data.length]),
    csvRow([t('col_total_persons'), persons]),
    csvRow([t('col_total_families'), families]),
    csvRow([t('col_total'), persons + families]),
    csvRow([t('col_total_links'), links]),
    csvRow([t('col_last_modified'), lastUpdate]),
  ];
}

// Builds the active-search-criteria footer block from the current URL params,
// mirroring the on-screen filters (boolean toggles shown as a checkmark).
function searchCriteriaRows() {
  const params = new URLSearchParams(window.location.search);
  const rows = [];
  for (const [k, v] of params.entries()) {
    if (k === 't' || k === 'mfp' || k === 'mff') continue; // Skip the tab indicator and matches add/diff/link toggles (shown separately)

    const field = PARAM_MAP_REVERSE[k] || k;
    let label;
    if (field === 'q' || field === 'filter') {
      label = t('general_search_label');
    } else if (field === 'ex') {
      label = t('exact_search');
    } else if (field === 'hl' || field === 'has_link') {
      label = t('has_link');
    } else if (field === 'with') {
      label = t('filter_with');
    } else if (field.endsWith('_to')) {
      const baseField = field.replace('_to', '');
      const baseLabel = t('col_' + baseField) !== 'col_' + baseField ? t('col_' + baseField) : baseField;
      label = `${baseLabel} - ${t('date_to')}`;
    } else {
      label = t('col_' + field) !== 'col_' + field ? t('col_' + field) : field;
    }

    let val = v;
    if ((field === 'ex' || field === 'hl' || field === 'has_link') && v === '1') {
      val = '✓'; // Output a nice checkmark for boolean toggles
    }
    rows.push(csvRow([label, val]));
  }
  if (!rows.length) return [];
  // The page URL is emitted once by csvFooter(), so it's not repeated here.
  return [csvCell(t('tab_search')), ...rows];
}

export function exportToCSV(data, columns, filename, extraFooterRows = []) {
  if (!data || !data.length) return;

  const csvColumns = expandColumns(columns);
  const header = csvColumns.map(col => csvCell(t('col_' + col))).join(',');
  const body = data.map(row => csvColumns.map(col => csvCell(cellValue(col, row))).join(','));

  // The footer's optional block depends on which table this is: the
  // contributors table appends totals, every other table appends the active
  // search criteria. `extraFooterRows` (e.g. the matches add/diff/link
  // toggles, which aren't reflected in the URL) are appended after that.
  const extraRows = filename.includes('contributors')
    ? contributorsSummaryRows(data)
    : searchCriteriaRows();

  downloadCsv([header, ...body, '', ...csvFooter([...extraRows, ...extraFooterRows])], filename);
}
