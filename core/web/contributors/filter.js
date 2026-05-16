import { t } from '../i18n.js';
import { renderTable } from '../table.js';
import { toUnicodeHref, toUnicodeSearch, currentParams, getParam } from '../url.js';
import { baseContributorName } from '../utils.js';
import {
  getCachedData,
  enrichWithMatchCounts,
  expandContributorNames,
} from './data.js';
import { loadSurnameCloud } from './cloud.js';

// --- View state owned by this module -----------------------------------------
// These are shared between renderMatchesPage (writer) and the sidebar input
// (reader), so they live here as the single owning seam.

let currentMatchesData = null;
let currentMatchesContributor = null;
let currentDetailRefilter = null;

export const contributorColumns = ['contributor_ID', 'total_persons', 'total_families', 'total', 'total_links', 'last_modified', 'matches'];

/** Read the active-contributor / partner URL params. Use the shared getParam
 *  so short `c=` / `w=` and legacy `contributor=` / `with=` forms both work. */
export const readContributorParam = (p) => getParam(p, 'contributor');
export const readWithParam        = (p) => getParam(p, 'with');

/** Called by matches.js after a successful matches-summary fetch so the
 *  sidebar input can filter the cached partner list without re-fetching. */
export function setCurrentMatches(data, contributor) {
  currentMatchesData = data;
  currentMatchesContributor = contributor;
}

/** Called by matches.js after renderTables() so the sidebar input can
 *  filter the per-record matches detail. Pass null on view-change. */
export function setDetailRefilter(fn) {
  currentDetailRefilter = fn;
}

/** Resets the per-view state. Called when entering a new contributors view. */
export function resetViewState() {
  currentDetailRefilter = null;
}

/** Current value of the sidebar filter input (trim + lowercase). */
export function getContributorFilter() {
  return (document.getElementById('contributors-query')?.value || '').trim().toLowerCase();
}

/** Filter the cached contributors list by the current input. */
export function filterContributorData(data) {
  const q = getContributorFilter();
  if (!q) return data;
  return data.filter(d =>
    d.contributor_ID.toLowerCase().includes(q) ||
    d.last_modified.includes(q)
  );
}

// --- URL sync ---------------------------------------------------------------

/** Mirrors the current filter value into the URL (`f=…`) using replaceState. */
export function syncFilterToUrl(value) {
  const u = new URL(window.location.href);
  if (value) u.searchParams.set('f', value);
  else u.searchParams.delete('f');
  const search = toUnicodeSearch(u.searchParams);
  history.replaceState(null, '', u.pathname + (search ? '?' + search : ''));
}

/** Restores the filter input value from `?f=…` on (re-)render of a view. */
export function restoreFilterFromUrl() {
  const input = document.getElementById('contributors-query');
  if (!input) return;
  const f = currentParams().get('f') || '';
  if (input.value !== f) input.value = f;
}

/** Updates the placeholder for the current view (list / summary / detail). */
export function updateFilterPlaceholder() {
  const input = document.getElementById('contributors-query');
  if (!input) return;
  const withPartner = readWithParam(currentParams());
  const key = withPartner ? 'matches_filter_placeholder' : 'contributors_filter_placeholder';
  input.placeholder = t(key);
  input.dataset.i18nPlaceholder = key;
}

// --- Sidebar input listener -------------------------------------------------

/**
 * Binds the sidebar filter input once. The handler dispatches based on URL
 * params at event time, so it works regardless of which contributors view is
 * currently rendering — including direct loads of the matches detail URL
 * where the top-level renderContributors returns early.
 */
export function bindFilterInput() {
  const input = document.getElementById('contributors-query');
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  input.addEventListener('input', () => {
    const q = getContributorFilter();
    syncFilterToUrl(q);
    const urlParams = currentParams();
    const activeContributor = readContributorParam(urlParams);
    const withPartner = readWithParam(urlParams);
    const activeBase = activeContributor ? baseContributorName(activeContributor) : null;

    if (activeContributor && !withPartner && currentMatchesData && currentMatchesContributor === activeBase) {
      // Single-contributor view: re-filter the partner list table.
      const filtered = q ? currentMatchesData.filter(p => p.contributor.toLowerCase().includes(q)) : currentMatchesData;
      const tableData = filtered.map(p => ({
        contributor_ID: p.contributor,
        _match_href: toUnicodeHref({ t: 'contributors', c: activeBase, w: p.contributor }),
        total_persons:  p.persons_count  || 0,
        total_families: p.families_count || 0,
        total:          p.total_count,
        confidence:     Math.round((p.max_confidence || 0) * 100),
      }));
      renderTable(tableData, 'matches-summary', ['contributor_ID', 'total_persons', 'total_families', 'total', 'confidence'], 'total', false);
    } else if (activeContributor && withPartner && currentDetailRefilter) {
      // Matches detail view: delegate to renderTables closure from matches.js.
      currentDetailRefilter(q);
    } else if (!activeContributor && getCachedData()) {
      // Contributors list view: re-render the table + surname cloud.
      const filtered = enrichWithMatchCounts(filterContributorData(getCachedData()));
      const filteredTableData = filtered.map(d => ({
        ...d,
        _contributor_href: toUnicodeHref({ t: 'contributors', c: d.contributor_ID }),
      }));
      renderTable(filteredTableData, 'table-contributors', contributorColumns, 'total', false);
      loadSurnameCloud(expandContributorNames(filtered), 'surname-cloud');
    }
  });
}
