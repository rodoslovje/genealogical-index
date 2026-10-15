import { t } from '../i18n.js';
import { renderTable, exportToCSV } from '../table.js';
import { baseContributorName, formatExportFilename } from '../lib/utils.js';
import { API_BASE_URL } from '../config.js';
import { toUnicodeHref } from '../lib/url.js';
import { DOWNLOAD_ICON } from '../lib/icons.js';
import { mountTableFilter, observeStickyHeader } from '../lib/table-filter.js';

import { setCurrentMatches } from './filter.js';
import { mountSurnameScope, readMatchSurnames } from './match-surname.js';
import { fetchErrorKey } from '../auth.js';

const COUNT_COLS = ['total_persons', 'total_families', 'total', 'confidence'];

/** One table per kind of match partner, in this order. Trees and military
 *  sources list one row per contributor; Matricula and cemetery indexes list
 *  one row per parish / cemetery place (the API's `unit`), whichever
 *  transcribers indexed it — that's how a genealogist reviews them, since a
 *  family's records sit in one parish. */
const SECTIONS = [
  { source: 'tree',      titleKey: 'section_matches_trees', nameCol: 'contributor_ID' },
  { source: 'matricula', titleKey: 'icon_matricula_index',  nameCol: 'parish' },
  { source: 'geneanet',  titleKey: 'icon_geneanet_index',   nameCol: 'cemetery_place' },
  { source: 'military',  titleKey: 'icon_military_index',   nameCol: 'contributor_ID' },
];

const isUnitSection = (section) => section.nameCol !== 'contributor_ID';
const sectionColumns = (section) => isUnitSection(section)
  ? [section.nameCol, 'contributors', ...COUNT_COLS]
  : ['contributor_ID', ...COUNT_COLS];

// Stable identity of a partner row, shared by the overall and the
// surname-scoped responses.
const partnerKey = (p) => `${p.source}|${p.unit ?? ''}|${p.contributor ?? ''}`;

// URL value for "records without a parish / place" — an empty `u=` would be
// dropped from the URL.
export const NO_UNIT_PARAM = '-';

/** Renders the "Matches" section — every source whose records overlap
 *  `displayName`'s tree, with counts — into `sectionEl`, as one table per
 *  kind of source (see SECTIONS).
 *
 *  `primary` is the tree the matches are fetched for. `overlay` is the global
 *  spinner shown while a surname scope is re-fetched. */
export async function renderMatchesSummary({ sectionEl, primary, displayName, overlay }) {
  const plainHeading = `<h3 class="section-heading" style="margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px;">${t('col_matches')}</h3>`;

  let partners;
  let status = 0;
  try {
    const res = await fetch(`${API_BASE_URL}/api/contributors/${encodeURIComponent(primary.contributor_ID)}/matches`);
    status = res.status;
    if (!res.ok) throw new Error('API failed');
    partners = await res.json();
    setCurrentMatches(partners, displayName);
  } catch {
    sectionEl.innerHTML = plainHeading + `<p>${t(fetchErrorKey(status))}</p>`;
    return;
  }

  if (!partners.length) {
    sectionEl.innerHTML = plainHeading + `<p>${t('matches_none')}</p>`;
    return;
  }

  sectionEl.innerHTML = `<div class="matches-summary-header section-bar section-bar--top">
      <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('col_matches')}</h3>
      <button class="export-btn export-matches-summary-btn" title="${t('download_csv')}">${DOWNLOAD_ICON}CSV</button>
    </div>
    <div class="matches-summary-content">
      <p>${t('matches_found_intro')} <strong>${displayName}</strong>.<br>${t('matches_found_outro')}</p>
      <div id="matches-surname-scope"></div>
      <p id="matches-surname-error" class="match-surname-error" style="display: none;"></p>
      ${SECTIONS.map(s => `<div class="matches-summary-group" data-source="${s.source}">
        <h4 class="matches-summary-group-title">${t(s.titleKey)}</h4>
        <div id="matches-summary-${s.source}" class="table-responsive"></div>
      </div>`).join('')}
      <p class="matches-summary-empty" style="display: none;">${t('no_results')}</p>
    </div>`;

  const summaryHeaderEl = sectionEl.querySelector('.matches-summary-header');
  const summaryHeader = summaryHeaderEl?.querySelector('h3');
  const summaryContent = sectionEl.querySelector('.matches-summary-content');
  if (summaryHeader && summaryContent) {
    summaryHeader.classList.add('collapsible-header');
    summaryHeader.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      const isCollapsed = summaryHeader.classList.contains('collapsed');
      summaryContent.style.display = isCollapsed ? '' : 'none';
      summaryHeader.classList.toggle('collapsed', !isCollapsed);
    });
  }

  // Map to renderTable row format, applying the inline filter. The filter
  // input lives in `.matches-summary-header`, which (unlike the table body)
  // is only built once above — so re-running this on a filter keystroke
  // just re-derives `tableData` and re-renders the table, never touching
  // (or stealing focus from) the filter input itself.
  // Rows of every visible section, for the CSV export.
  let currentExportRows = [];

  // Active surname scope. `scopeCounts` is a partner → row map of the counts
  // restricted to those surnames; null means no scope, and the table shows
  // every partner with its overall counts as before. The overall counts stay
  // in their own columns either way — the scoped figure gets an added column
  // rather than quietly redefining `Total`, so it's visible that the
  // genealogist filter hides rows while this one changes what's counted.
  let scopeSurnames = readMatchSurnames();
  let scopeCounts = null;
  let scopeError = '';

  const fetchScopeCounts = async (surnames) => {
    if (!surnames.length) return null;
    const res = await fetch(
      `${API_BASE_URL}/api/contributors/${encodeURIComponent(primary.contributor_ID)}` +
      `/matches?surname=${encodeURIComponent(surnames.join(','))}`
    );
    if (!res.ok) throw new Error('API failed');
    const rows = await res.json();
    return new Map(rows.map(r => [partnerKey(r), r]));
  };

  const applyScope = async (surnames) => {
    scopeSurnames = surnames;
    if (overlay) overlay.style.display = 'flex';
    try {
      scopeCounts = await fetchScopeCounts(surnames);
      scopeError = '';
    } catch {
      // Don't fall back to an unscoped table silently — that would read as
      // "this surname matches everyone" rather than "the lookup failed".
      scopeCounts = new Map();
      scopeError = t('search_failed');
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
    // The column set changes with the scope, and renderTable keeps its sort
    // state on the container — drop it so the new column can be the default
    // sort instead of inheriting one keyed to the old columns.
    for (const s of SECTIONS) {
      const el = document.getElementById(`matches-summary-${s.source}`);
      if (el) el._sortState = null;
    }
    renderSummaryTable();
  };

  const renderSummaryTable = () => {
    const query = mountTableFilter({
      headerEl: summaryHeaderEl,
      paramKey: 'matches-summary',
      placeholder: t('table_filter_placeholder'),
      title: t('tip_table_filter'),
      onChange: renderSummaryTable,
    });
    mountSurnameScope({
      mountEl: document.getElementById('matches-surname-scope'),
      sourceName: primary.contributor_ID,
      onChange: applyScope,
    });

    const errorEl = document.getElementById('matches-surname-error');
    if (errorEl) {
      errorEl.textContent = scopeError;
      errorEl.style.display = scopeError ? '' : 'none';
    }

    const isScoped = !!scopeCounts;
    // Carry the surname into the pair view's own per-section filters, so
    // clicking a partner lands on those records instead of on all several
    // hundred matches with them.
    const detailFilter = isScoped
      ? { mqp: scopeSurnames.join(','), mqf: scopeSurnames.join(',') }
      : {};

    const toRow = (p) => {
      const names = p.contributors?.length ? p.contributors : [p.contributor];
      const row = {
        // The detail view takes one partner; for a parish / place row that
        // is any of its transcribers (it fixes the source type) plus `u`.
        _match_href: toUnicodeHref({
          t: 'contributors', c: displayName, w: p.contributor || names[0],
          ...(p.contributor ? {} : { u: p.unit ?? NO_UNIT_PARAM }),
          ...detailFilter,
        }),
        total_persons:  p.persons_count  || 0,
        total_families: p.families_count || 0,
        total:          p.total_count,
        confidence:     Math.round((p.max_confidence || 0) * 100),
      };
      if (p.contributor) {
        row.contributor_ID = p.contributor;
      } else {
        row._unit_label = p.unit ?? t('match_unit_unknown');
        row._contributors = names;
        row.contributors = names.map(baseContributorName).join(', ');
      }
      if (isScoped) row.surname_matches = scopeCounts.get(partnerKey(p))?.total_count || 0;
      return row;
    };
    const matchesQuery = (row) => !query ||
      [row.contributor_ID, row._unit_label, row.contributors]
        .some(v => v && v.toLowerCase().includes(query));

    currentExportRows = [];
    let shown = 0;
    for (const section of SECTIONS) {
      const groupEl = sectionEl.querySelector(`.matches-summary-group[data-source="${section.source}"]`);
      const rows = partners
        .filter(p => (p.source || 'tree') === section.source)
        .filter(p => !scopeCounts || scopeCounts.has(partnerKey(p)))
        .map(toRow)
        .map(row => isUnitSection(section) ? { ...row, [section.nameCol]: row._unit_label } : row)
        .filter(matchesQuery);
      groupEl.style.display = rows.length ? '' : 'none';
      if (!rows.length) continue;
      shown += rows.length;
      const cols = isScoped ? [...sectionColumns(section), 'surname_matches'] : sectionColumns(section);
      renderTable(rows, `matches-summary-${section.source}`, cols,
        isScoped ? 'surname_matches' : 'total', false);
      for (const row of rows) {
        currentExportRows.push({
          ...row,
          match_source: t(section.titleKey),
          match_name: row.contributor_ID ? baseContributorName(row.contributor_ID) : row._unit_label,
        });
      }
    }
    const emptyEl = sectionEl.querySelector('.matches-summary-empty');
    if (emptyEl) emptyEl.style.display = shown ? 'none' : '';
  };

  // A shared link can arrive with `ms=` already set — resolve it before the
  // first render so the table never flashes the unscoped list.
  if (scopeSurnames.length) {
    try {
      scopeCounts = await fetchScopeCounts(scopeSurnames);
    } catch {
      scopeCounts = new Map();
      scopeError = t('search_failed');
    }
  }
  renderSummaryTable();
  if (summaryHeaderEl) observeStickyHeader(summaryHeaderEl, summaryContent);

  const summaryBtn = sectionEl.querySelector('.export-matches-summary-btn');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      const cols = ['match_source', 'match_name', 'contributors', ...COUNT_COLS,
        ...(scopeCounts ? ['surname_matches'] : [])];
      exportToCSV(currentExportRows, cols, formatExportFilename(`matches-${displayName}`, 'csv'));
    });
  }
}
