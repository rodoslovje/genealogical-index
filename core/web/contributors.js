// Thin entry point for the contributors view. The actual implementation lives
// under ./contributors/ — this file orchestrates the top-level routing between
// the list, single-contributor, and per-record matches views, and re-exports
// the public surface that main.js and search.js depend on.

import { t } from './i18n.js';
import { renderTable } from './table.js';
import { toUnicodeHref, currentParams } from './url.js';

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
  const withPartner = readWithParam(urlParams);

  const chartsContainer = document.getElementById('charts-container');
  const surnameCloudSection = document.getElementById('surname-cloud-section');
  let tableHeader = document.getElementById('table-contributors-header');

  if (contributor) {
    if (chartsContainer) chartsContainer.style.display = 'none';
    if (surnameCloudSection) surnameCloudSection.style.display = 'none';
    if (tableHeader) tableHeader.style.display = 'none';
    await renderMatchesPage(contributor, withPartner);
    return;
  }

  document.title = t('site_title');

  if (chartsContainer) chartsContainer.style.display = 'grid';
  if (surnameCloudSection) surnameCloudSection.style.display = '';
  if (tableHeader) tableHeader.style.display = '';

  const container = document.getElementById('table-contributors');

  if (!tableHeader) {
    tableHeader = document.createElement('h2');
    tableHeader.id = 'table-contributors-header';
    tableHeader.className = 'section-heading';
    tableHeader.style.marginTop = '2rem';
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
