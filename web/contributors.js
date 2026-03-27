import { t } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL } from './config.js';

const contributorColumns = ['contributor_ID', 'total_births', 'total_families', 'total', 'last_modified'];
let cachedData = null;

export async function renderContributors() {
  const container = document.getElementById('table-contributors');
  container.innerHTML = `<p>${t('loading_contributors')}</p>`;

  try {
    if (!cachedData) {
      const response = await fetch(`${API_BASE_URL}/api/contributors/`);
      const metadata = await response.json();
      cachedData = metadata.map(m => ({
        contributor_ID: m.name,
        total_births: m.births_count,
        total_families: m.families_count,
        total: m.births_count + m.families_count,
        last_modified: new Date(m.last_modified).toLocaleString(),
      }));
    }
    renderTable(cachedData, 'table-contributors', contributorColumns, 'total', false);
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
