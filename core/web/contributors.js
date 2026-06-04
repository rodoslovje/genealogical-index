// Thin entry point for the contributors view. The actual implementation lives
// under ./contributors/ — this file orchestrates the top-level routing between
// the list, single-contributor, and per-record matches views, and re-exports
// the public surface that main.js and search.js depend on.

import { t } from './i18n.js';
import siteConfig from '@site-config';
import { renderTable } from './table.js';
import { toUnicodeHref, toUnicodeSearch, currentParams } from './url.js';
import { isPremiumLocked, requireLogin } from './auth.js';

import {
  ensureData, ensureTimelineData, ensureMatchCounts,
  enrichWithMatchCounts, expandContributorNames,
  getContributorUrlMap, prefetchContributors,
} from './contributors/data.js';
import { renderChart, renderTimelineChart } from './contributors/charts.js';
import { ensureChartJs } from './utils.js';
import { loadSurnameCloud } from './contributors/cloud.js';
import {
  contributorColumns,
  readContributorParam, readWithParam,
  bindFilterInput, restoreFilterFromUrl, updateFilterPlaceholder,
  filterContributorData, resetViewState,
} from './contributors/filter.js';
import { renderMatchesPage } from './contributors/matches.js';

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
  // Reset per-view state; matches.js will reinstall the detail refilter.
  resetViewState();
  // Bind input handler once (works for any sub-view because the handler
  // dispatches off live URL params) and refresh placeholder for this view.
  bindFilterInput();
  updateFilterPlaceholder();
  restoreFilterFromUrl();
  // Auto-open the sidebar on desktop so the filter input is discoverable on
  // every contributors view. On mobile the sidebar covers content — leave
  // that to the hamburger so we don't trap the user.
  const sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth > 768) sidebar.classList.add('open');

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

  const tableContainer = document.getElementById('table-contributors');

  const matriculaLink = document.getElementById('matricula-stats-link');

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
    await renderMatchesPage(contributor, withPartner);
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
    const linkHtml = `<a href="${toUnicodeHref({ t: 'matricula' })}" data-spa-nav>${t('matricula_page_title')}</a>`;
    matriculaLink.innerHTML = t('contributors_matricula_link_intro').replace('{0}', linkHtml);
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

  const container = document.getElementById('table-contributors');

  if (!tableHeader) {
    tableHeader = document.createElement('h2');
    tableHeader.id = 'table-contributors-header';
    tableHeader.className = 'section-heading';
    tableHeader.style.marginTop = '1rem';
    tableHeader.style.borderBottom = '1px solid var(--border)';
    tableHeader.style.paddingBottom = '5px';
    tableHeader.style.marginBottom = '10px';
    container.parentNode.insertBefore(tableHeader, container);
  }
  tableHeader.dataset.i18n = 'tab_contributors';
  tableHeader.textContent = t('tab_contributors');

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
    const initialFiltered = enrichWithMatchCounts(filterContributorData(data));
    const tableData = initialFiltered.map(d => ({
      ...d,
      _contributor_href: toUnicodeHref({ t: 'contributors', c: d.contributor_ID }),
    }));
    renderTable(tableData, 'table-contributors', contributorColumns, 'total', false);
    loadSurnameCloud(expandContributorNames(initialFiltered), 'surname-cloud');
  } catch {
    container.innerHTML = `<p>${t('contributors_failed')}</p>`;
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

/** Re-renders the contributors view if it is currently active (e.g. after language change). */
export function refreshContributorsIfVisible() {
  if (document.getElementById('tab-contributors').classList.contains('active')) {
    renderContributors();
  }
}
