// Thin entry point for the contributors view. The actual implementation lives
// under ./contributors/ — this file orchestrates the top-level routing between
// the list, single-contributor, and per-record matches views, and re-exports
// the public surface that main.js and search.js depend on.

import { t } from './i18n.js';
import siteConfig from '@site-config';
import { renderTable } from './table.js';
import { toUnicodeHref, toUnicodeSearch, currentParams } from './lib/url.js';
import { isPremiumLocked, requireLogin } from './auth.js';

import {
  ensureData, ensureTimelineData, ensureMatchCounts,
  enrichWithMatchCounts, expandContributorNames,
  getContributorUrlMap, prefetchContributors,
} from './contributors/data.js';
import { renderChart, renderTimelineChart } from './contributors/charts.js';
import { ensureChartJs } from './lib/utils.js';
import { loadSurnameCloud } from './contributors/cloud.js';
import {
  contributorColumns,
  readContributorParam, readWithParam,
  setCurrentMatches, getCurrentMatches,
} from './contributors/filter.js';
import { renderMatchesPage } from './contributors/matches.js';
import { tryRestoreView, markCurrentView } from './lib/view-cache.js';

// Public re-exports (consumed by main.js and search.js):
export { prefetchContributors, getContributorUrlMap };

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export async function renderTotalsBar() {
  try {
    const data = await ensureData();
    const persons = data.reduce((s, r) => s + r.total_persons, 0);
    const families = data.reduce((s, r) => s + r.total_families, 0);
    const links = data.reduce((s, r) => s + r.total_links, 0);
    const lastUpdate = data.reduce((max, r) => r.last_modified > max ? r.last_modified : max, '');
    setEl('total-contributors', data.length.toLocaleString());
    setEl('total-persons',  persons.toLocaleString());
    setEl('total-families', families.toLocaleString());
    setEl('total-all',     (persons + families).toLocaleString());
    setEl('total-links',    links.toLocaleString());
    setEl('total-last-update', lastUpdate);
    setEl('data-updated', lastUpdate);
    const totalsBar = document.getElementById('totals-bar');
    if (totalsBar) totalsBar.style.display = readContributorParam(currentParams()) ? 'none' : '';
  } catch { /* silently skip if API unavailable */ }
}

/** Populate the footer's "Data update" date from the API so it tracks the
 *  server's latest contributor import rather than the static build time.
 *  Uses the same cached /api/contributors/ payload as the Genealogists page. */
export async function updateFooterDataDate() {
  try {
    const data = await ensureData();
    const lastUpdate = data.reduce((max, r) => r.last_modified > max ? r.last_modified : max, '');
    setEl('data-updated', lastUpdate);
  } catch { /* silently skip if API unavailable */ }
}

export async function renderContributors() {
  const urlParams = currentParams();
  const contributor = readContributorParam(urlParams);
  let withPartner = readWithParam(urlParams);

  if (withPartner && isPremiumLocked()) {
    requireLogin('premium_gated_desc');
    withPartner = null;
    urlParams.delete('w');
    urlParams.delete('with');
    const newSearch = toUnicodeSearch(urlParams);
    history.replaceState(null, '', window.location.pathname + (newSearch ? '?' + newSearch : ''));
  }

  const chartsContainer = document.getElementById('charts-container');
  const surnameCloudSection = document.getElementById('surname-cloud-section');
  let tableHeader = document.getElementById('table-contributors-header');
  const statsHeading = document.getElementById('contributors-stats-heading');

  // Caching is scoped to `#table-contributors`'s own children, never the
  // element itself or its fixed-ID siblings (charts/totals/cloud/heading) —
  // the rest of this module finds those via getElementById on every render,
  // so detaching any of them (as a whole-panel cache would) leaves later
  // lookups returning null and the page rendering blank.
  const tableContainer = document.getElementById('table-contributors');

  const matriculaLink = document.getElementById('matricula-stats-link');

  const viewKey = window.location.pathname + window.location.search;

  if (contributor) {
    if (statsHeading) statsHeading.style.display = 'none';
    if (chartsContainer) chartsContainer.style.display = 'none';
    if (matriculaLink) matriculaLink.style.display = 'none';
    if (surnameCloudSection) surnameCloudSection.style.display = 'none';
    if (tableHeader) tableHeader.style.display = 'none';
    // Detail view fills the container with multiple sections (heading, stats,
    // clouds, matches table). Drop the .table-responsive card chrome so the
    // page styling matches the main contributors list, where only the inner
    // tables wear that chrome.
    if (tableContainer) tableContainer.classList.add('contributor-detail');

    // Browser back/forward into a contributor or matches-detail URL already
    // rendered earlier this session: restore its cached DOM (and the small
    // bit of sidebar-filter state tied to it) instead of re-fetching and
    // rebuilding the whole table from scratch, so the page doesn't appear to
    // reload and the user stays at their previous scroll position.
    const restored = tableContainer && tryRestoreView(viewKey, tableContainer, {
      restoreExtra: (extra) => {
        if (!extra) return;
        setCurrentMatches(extra.matches.data, extra.matches.contributor);
      },
    });
    if (restored) return;

    window.scrollTo(0, 0);
    await renderMatchesPage(contributor, withPartner);
    if (tableContainer) {
      markCurrentView(viewKey, tableContainer, () => ({
        matches: getCurrentMatches(),
      }));
    }
    return;
  }

  if (tableContainer) tableContainer.classList.remove('contributor-detail');

  document.title = t('site_title');

  const totalsBar = document.getElementById('totals-bar');
  const statsCollapsed = statsHeading?.classList.contains('collapsed');

  if (statsHeading) statsHeading.style.display = '';
  if (chartsContainer) chartsContainer.style.display = statsCollapsed ? 'none' : 'grid';
  if (totalsBar && !readContributorParam(urlParams)) totalsBar.style.display = statsCollapsed ? 'none' : '';
  if (matriculaLink) {
    const matriculaHtml = `<a href="${toUnicodeHref({ t: 'matricula' })}" data-spa-nav>${t('matricula_page_title')}</a>`;
    const geneanetHtml = `<a href="${toUnicodeHref({ t: 'geneanet' })}" data-spa-nav>${t('geneanet_page_title')}</a>`;
    matriculaLink.innerHTML = t('contributors_index_links_intro')
      .replace('{0}', matriculaHtml)
      .replace('{1}', geneanetHtml);
    matriculaLink.style.display = statsCollapsed ? 'none' : '';
  }
  if (surnameCloudSection) surnameCloudSection.style.display = '';
  if (tableHeader) tableHeader.style.display = '';

  // Wire the Statistika heading to collapse the totals bar + charts (its two
  // visual children). One-time attach guarded via the .collapsible-header class.
  if (statsHeading && !statsHeading.classList.contains('collapsible-header')) {
    statsHeading.classList.add('collapsible-header');
    statsHeading.addEventListener('click', () => {
      const willCollapse = !statsHeading.classList.contains('collapsed');
      statsHeading.classList.toggle('collapsed', willCollapse);
      const tb = document.getElementById('totals-bar');
      const cc = document.getElementById('charts-container');
      const ml = document.getElementById('matricula-stats-link');
      if (tb) tb.style.display = willCollapse ? 'none' : '';
      if (cc) cc.style.display = willCollapse ? 'none' : 'grid';
      if (ml) ml.style.display = willCollapse ? 'none' : '';
    });
  }

  if (!tableHeader) {
    tableHeader = document.createElement('h2');
    tableHeader.id = 'table-contributors-header';
    tableHeader.className = 'section-heading';
    tableHeader.style.marginTop = '1rem';
    tableHeader.style.borderBottom = '1px solid var(--border)';
    tableHeader.style.paddingBottom = '5px';
    tableHeader.style.marginBottom = '10px';
    tableHeader.appendChild(document.createElement('span'));
    tableContainer.parentNode.insertBefore(tableHeader, tableContainer);
  }
  // The translatable label lives in its own child <span>, not directly on the
  // <h2> — renderTable()/mountTableFilter() append the CSV/expand-all buttons
  // and the filter input as siblings of that span, inside this same <h2>.
  // Resetting the whole element's textContent here (as on every call to this
  // function) would otherwise wipe those out; on a tryRestoreView() cache hit
  // renderTable() never re-runs afterwards to re-add them, permanently losing
  // the filter until a full re-fetch of this view.
  const labelEl = tableHeader.querySelector('span');
  labelEl.dataset.i18n = 'tab_contributors';
  labelEl.textContent = t('tab_contributors');

  // Browser back/forward into the contributors list URL already rendered
  // earlier this session: restore its cached table instead of re-fetching and
  // rebuilding from scratch, so the page doesn't appear to reload and the
  // user stays at their previous scroll position. The siblings above
  // (charts/totals/cloud/heading) were never torn down — only shown/hidden —
  // so nothing needs restoring for them.
  if (tableContainer && tryRestoreView(viewKey, tableContainer)) return;

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10)); // Yield to allow browser to paint the overlay
  }

  try {
    // Kick off Chart.js load alongside the API calls so the charts can paint
    // as soon as both arrive instead of waiting serially.
    const [data, timeline] = await Promise.all([
      ensureData(), ensureTimelineData(), ensureMatchCounts(),
      ensureChartJs().catch(() => {}),
    ]);

    renderChart(data);
    renderTimelineChart(timeline);
    const enriched = enrichWithMatchCounts(data);
    const tableData = enriched.map(d => ({
      ...d,
      _contributor_href: toUnicodeHref({ t: 'contributors', c: d.contributor_ID }),
    }));
    renderTable(tableData, 'table-contributors', contributorColumns, 'total', false);
    loadSurnameCloud(expandContributorNames(enriched), 'surname-cloud');
  } catch {
    tableContainer.innerHTML = `<p>${t('contributors_failed')}</p>`;
  } finally {
    if (overlay) overlay.style.display = 'none';
  }

  if (tableContainer) markCurrentView(viewKey, tableContainer);
}

/** Re-renders the contributors view if it is currently active (e.g. after language change). */
export function refreshContributorsIfVisible() {
  if (document.getElementById('tab-contributors').classList.contains('active')) {
    renderContributors();
  }
}
