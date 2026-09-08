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

const BASE_SUMMARY_COLS = ['contributor_ID', 'total_persons', 'total_families', 'total', 'confidence'];

/** Renders the "Matches" section — every genealogist whose records overlap
 *  `displayName`'s, with per-partner counts — into `sectionEl`.
 *
 *  `primary` is the record source the matches are fetched by; the API folds
 *  every suffix variant of the base name in, so this covers the tree together
 *  with any Geneanet / military records the same genealogist contributed.
 *  `cached` is the aggregate contributors list (to flag matricula-only
 *  partners); `overlay` is the global spinner shown while a surname scope
 *  is re-fetched. */
export async function renderMatchesSummary({ sectionEl, primary, displayName, cached, overlay }) {
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
      <div id="matches-summary" class="table-responsive"></div>
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
  let currentTableData = [];
  let currentSummaryCols = BASE_SUMMARY_COLS;

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
    return new Map(rows.map(r => [r.contributor, r]));
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
    const summaryEl = document.getElementById('matches-summary');
    if (summaryEl) summaryEl._sortState = null;
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

    let filteredPartners = query ? partners.filter(p => p.contributor.toLowerCase().includes(query)) : partners;
    if (scopeCounts) filteredPartners = filteredPartners.filter(p => scopeCounts.has(p.contributor));

    const isScoped = !!scopeCounts;
    currentSummaryCols = isScoped ? [...BASE_SUMMARY_COLS, 'surname_matches'] : BASE_SUMMARY_COLS;
    // Carry the surname into the pair view's own per-section filters, so
    // clicking a partner lands on those records instead of on all several
    // hundred matches with them.
    const detailFilter = isScoped
      ? { mqp: scopeSurnames.join(','), mqf: scopeSurnames.join(',') }
      : {};

    currentTableData = filteredPartners.map(p => {
      const partnerData = cached.find(d => d.contributor_ID === baseContributorName(p.contributor));
      const isMatOnly = partnerData ? (!partnerData._tree && !!partnerData._matricula) : false;
      const row = {
        contributor_ID: p.contributor,
        _match_href: toUnicodeHref({ t: 'contributors', c: displayName, w: p.contributor, ...detailFilter }),
        total_persons:  p.persons_count  || 0,
        total_families: p.families_count || 0,
        total:          p.total_count,
        confidence:     Math.round((p.max_confidence || 0) * 100),
        _is_matricula_only: isMatOnly,
      };
      if (isScoped) row.surname_matches = scopeCounts.get(p.contributor)?.total_count || 0;
      return row;
    });

    renderTable(currentTableData, 'matches-summary', currentSummaryCols,
      isScoped ? 'surname_matches' : 'total', false);
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
  if (summaryHeaderEl) observeStickyHeader(summaryHeaderEl, document.getElementById('matches-summary'));

  const summaryBtn = sectionEl.querySelector('.export-matches-summary-btn');
  if (summaryBtn) {
    summaryBtn.addEventListener('click', () => {
      exportToCSV(currentTableData, currentSummaryCols, formatExportFilename(`matches-${displayName}`, 'csv'));
    });
  }
}
