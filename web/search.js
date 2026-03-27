import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL, birthColumns, familyColumns } from './config.js';
import { updateURL, PARAM_MAP, PARAM_MAP_REVERSE } from './url.js';

// Last search results kept so they can be re-rendered on language change
let lastGeneralResults = null;
let lastAdvResults = null;
let lastAdvCols = null;
let lastAdvDefaultSort = null;

export function setupGeneralSearch() {
  document.getElementById('btn-general-search').addEventListener('click', performGeneralSearch);
}

async function performGeneralSearch() {
  const query = document.getElementById('general-query').value.trim();
  if (!query) return;

  updateURL({ q: query });

  document.getElementById('general-results').style.display = 'block';
  document.getElementById('table-general-births').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-families').innerHTML = `<p>${t('searching')}</p>`;

  try {
    const response = await fetch(`${API_BASE_URL}/api/search/general?q=${encodeURIComponent(query)}&limit=500`);
    const results = await response.json();
    lastGeneralResults = results;

    document.getElementById('count-general-births').textContent = results.births.length;
    document.getElementById('count-general-families').textContent = results.families.length;
    renderTable(results.births, 'table-general-births', birthColumns, 'surname', true);
    renderTable(results.families, 'table-general-families', familyColumns, 'husband_surname', true);
  } catch (error) {
    console.error('Search failed:', error);
    document.getElementById('general-results').innerHTML = `<p>${t('search_failed')}</p>`;
  }
}

async function performAdvancedSearch() {
  const type = document.getElementById('adv-search-type').value;
  const isBirth = type === 'births';
  const cols = isBirth ? birthColumns : familyColumns;

  document.getElementById('advanced-results').style.display = 'block';
  document.getElementById('table-adv-results').innerHTML = `<p>${t('searching')}</p>`;

  const fieldParams = {};
  cols.filter(c => c !== 'contributor').forEach(c => {
    const val = document.getElementById(`adv-${c}`)?.value.trim();
    if (val) fieldParams[c] = val;
  });

  if (!Object.keys(fieldParams).length) {
    document.getElementById('table-adv-results').innerHTML = `<p>${t('enter_criterion')}</p>`;
    document.getElementById('count-adv-results').textContent = '0';
    return;
  }

  // Build compact URL: t=birth/family + short field names
  const shortParams = { t: isBirth ? 'birth' : 'family' };
  for (const [field, val] of Object.entries(fieldParams)) {
    shortParams[PARAM_MAP[field] || field] = val;
  }
  updateURL(shortParams);

  const apiParams = new URLSearchParams({ ...fieldParams, limit: '500' });
  const defaultSort = isBirth ? 'surname' : 'husband_surname';

  try {
    const response = await fetch(`${API_BASE_URL}/api/search/advanced/${type}?${apiParams.toString()}`);
    const results = await response.json();

    lastAdvResults = results;
    lastAdvCols = cols;
    lastAdvDefaultSort = defaultSort;

    document.getElementById('count-adv-results').textContent = results.length;
    renderTable(results, 'table-adv-results', cols, defaultSort, true);
  } catch (error) {
    console.error('Advanced search failed:', error);
    document.getElementById('table-adv-results').innerHTML = `<p>${t('search_failed')}</p>`;
  }
}

/** Rebuilds the advanced search form HTML (preserving current values and type selection). */
function renderAdvFields() {
  const container = document.getElementById('adv-search-controls');

  // Preserve current input values and selected type before rebuilding
  const savedValues = {};
  container.querySelectorAll('input[type="text"]').forEach(input => {
    if (input.id) savedValues[input.id] = input.value;
  });
  const savedType = document.getElementById('adv-search-type')?.value || 'births';
  const isBirth = savedType !== 'families';
  const cols = isBirth ? birthColumns : familyColumns;

  let html = `<select id="adv-search-type">
    <option value="births" ${isBirth ? 'selected' : ''}>${t('adv_type_births')}</option>
    <option value="families" ${!isBirth ? 'selected' : ''}>${t('adv_type_families')}</option>
  </select>`;

  cols.filter(c => c !== 'contributor').forEach(col => {
    const label = t(`col_${col}`);
    const val = savedValues[`adv-${col}`] || '';
    html += `<div class="input-wrapper">
               <input type="text" id="adv-${col}" placeholder="${label}" value="${val}" />
               <button type="button" class="clear-btn" style="display:${val ? 'block' : 'none'}">&times;</button>
             </div>`;
  });
  html += `<button id="btn-adv-search">${t('search_btn')}</button>`;
  container.innerHTML = html;
}

/**
 * Sets up the advanced search form. Call once during init.
 * Registers event listeners via delegation and handles language changes internally.
 */
export function setupAdvancedSearchForm() {
  const container = document.getElementById('adv-search-controls');

  container.addEventListener('click', (event) => {
    if (event.target.matches('#btn-adv-search')) performAdvancedSearch();
    if (event.target.matches('.clear-btn')) {
      const input = event.target.previousElementSibling;
      if (input) {
        input.value = '';
        event.target.style.display = 'none';
        input.focus();
      }
    }
  });

  container.addEventListener('change', (event) => {
    if (event.target.matches('#adv-search-type')) renderAdvFields();
  });

  container.addEventListener('input', (event) => {
    if (event.target.matches('input[type="text"]')) {
      const clearBtn = event.target.nextElementSibling;
      if (clearBtn?.matches('.clear-btn')) {
        clearBtn.style.display = event.target.value ? 'block' : 'none';
      }
    }
  });

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input[type="text"]')) {
      performAdvancedSearch();
    }
  });

  renderAdvFields();

  // Re-render form and active results when language changes
  onLanguageChange(() => {
    renderAdvFields();
    if (lastGeneralResults) {
      renderTable(lastGeneralResults.births, 'table-general-births', birthColumns, 'surname', true);
      renderTable(lastGeneralResults.families, 'table-general-families', familyColumns, 'husband_surname', true);
    }
    if (lastAdvResults) {
      renderTable(lastAdvResults, 'table-adv-results', lastAdvCols, lastAdvDefaultSort, true);
    }
  });
}

/**
 * Reads URL params and restores the search form + triggers the search.
 * Call after setupGeneralSearch and setupAdvancedSearchForm.
 */
export function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const t = params.get('t');

  if (q) {
    document.getElementById('general-query').value = q;
    document.getElementById('btn-general-search').click();
  } else if (t === 'birth' || t === 'family') {
    const apiType = t === 'birth' ? 'births' : 'families';
    const typeSelect = document.getElementById('adv-search-type');
    if (typeSelect && typeSelect.value !== apiType) {
      typeSelect.value = apiType;
      renderAdvFields();
    }
    // Map short URL params back to API field names and fill inputs
    const cols = apiType === 'families' ? familyColumns : birthColumns;
    let hasCriteria = false;
    cols.filter(c => c !== 'contributor').forEach(col => {
      const val = params.get(PARAM_MAP[col] || col);
      if (val) {
        const input = document.getElementById(`adv-${col}`);
        if (input) {
          input.value = val;
          const clearBtn = input.nextElementSibling;
          if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = 'block';
          hasCriteria = true;
        }
      }
    });
    if (hasCriteria) document.getElementById('btn-adv-search')?.click();
  }
}
