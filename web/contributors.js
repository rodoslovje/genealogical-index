import { t } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL } from './config.js';

const contributorColumns = ['contributor_ID', 'total_births', 'total_families', 'total_deaths', 'total', 'total_links', 'last_modified'];
let cachedData = null;
let fetchPromise = null;

function ensureData() {
  if (cachedData) return Promise.resolve(cachedData);
  if (!fetchPromise) {
    fetchPromise = fetch(`${API_BASE_URL}/api/contributors/`)
      .then(r => r.json())
      .then(metadata => {
        cachedData = metadata.map(m => ({
          contributor_ID: m.name,
          total_births: m.births_count,
          total_families: m.families_count,
          total_deaths: m.deaths_count || 0,
          total: m.births_count + m.families_count + (m.deaths_count || 0),
          total_links: m.links_count || 0,
          last_modified: m.last_modified ? m.last_modified.slice(0, 10) : '',
        }));
        return cachedData;
      });
  }
  return fetchPromise;
}

export function prefetchContributors() {
  ensureData().catch(() => {});
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export async function renderTotalsBar() {
  try {
    const data = await ensureData();
    const births = data.reduce((s, r) => s + r.total_births, 0);
    const families = data.reduce((s, r) => s + r.total_families, 0);
    const deaths = data.reduce((s, r) => s + r.total_deaths, 0);
    const links = data.reduce((s, r) => s + r.total_links, 0);
    const lastUpdate = data.reduce((max, r) => r.last_modified > max ? r.last_modified : max, '');
    setEl('total-contributors', data.length.toLocaleString());
    setEl('total-births', births.toLocaleString());
    setEl('total-families', families.toLocaleString());
    setEl('total-deaths', deaths.toLocaleString());
    setEl('total-all', (births + families + deaths).toLocaleString());
    setEl('total-links', links.toLocaleString());
    setEl('total-last-update', lastUpdate);
    document.getElementById('totals-bar').style.display = '';
  } catch { /* silently skip if API unavailable */ }
}

export async function renderContributors() {
  const container = document.getElementById('table-contributors');
  container.innerHTML = `<p>${t('loading_contributors')}</p>`;

  try {
    const data = await ensureData();
    renderTable(data, 'table-contributors', contributorColumns, 'total', false);
  } catch {
    container.innerHTML = `<p>${t('contributors_failed')}</p>`;
  }
}

/** Re-renders the contributors table if it is currently visible (re-translates column headers). */
export function refreshContributorsIfVisible() {
  if (cachedData && document.getElementById('tab-contributors').classList.contains('active')) {
    renderTable(cachedData, 'table-contributors', contributorColumns, 'total', false);
  }
}
