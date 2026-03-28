import { t } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL } from './config.js';

const contributorColumns = ['contributor_ID', 'total_births', 'total_families', 'total', 'last_modified'];
let cachedData = null;

async function ensureData() {
  if (!cachedData) {
    const response = await fetch(`${API_BASE_URL}/api/contributors/`);
    const metadata = await response.json();
    cachedData = metadata.map(m => ({
      contributor_ID: m.name,
      total_births: m.births_count,
      total_families: m.families_count,
      total: m.births_count + m.families_count,
      last_modified: m.last_modified ? m.last_modified.slice(0, 10) : '',
    }));
  }
  return cachedData;
}

export async function renderTotalsBar() {
  try {
    const data = await ensureData();
    const births = data.reduce((s, r) => s + r.total_births, 0);
    const families = data.reduce((s, r) => s + r.total_families, 0);
    document.getElementById('total-births').textContent = births.toLocaleString();
    document.getElementById('total-families').textContent = families.toLocaleString();
    document.getElementById('total-all').textContent = (births + families).toLocaleString();
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
