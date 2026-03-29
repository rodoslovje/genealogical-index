import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL, birthColumns, familyColumns } from './config.js';
import { updateURL, PARAM_MAP } from './url.js';
import { hideIntro } from './main.js';

let lastGeneralResults = null;
const lastAdvResults = { birth: null, family: null };

// --- General search ---

export function setupGeneralSearch() {
  document.getElementById('btn-general-search').addEventListener('click', performGeneralSearch);

  onLanguageChange(() => {
    if (lastGeneralResults) {
      renderTable(lastGeneralResults.births, 'table-general-births', birthColumns, 'surname', true, 'name');
      renderTable(lastGeneralResults.families, 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name');
    }
  });
}

async function performGeneralSearch() {
  const query = document.getElementById('general-query').value.trim();
  if (!query) return;

  const exact = document.getElementById('general-exact')?.checked || false;
  updateURL({ q: query, ...(exact ? { ex: '1' } : {}) });
  hideIntro('intro-general');
  document.getElementById('general-results').style.display = 'block';
  document.getElementById('table-general-births').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-families').innerHTML = `<p>${t('searching')}</p>`;

  try {
    const params = new URLSearchParams({ q: query, limit: '500', ...(exact ? { exact: 'true' } : {}) });
    const response = await fetch(`${API_BASE_URL}/api/search/general?${params}`);
    const results = await response.json();
    lastGeneralResults = results;

    document.getElementById('count-general-births').textContent = results.births.length;
    document.getElementById('count-general-families').textContent = results.families.length;
    renderTable(results.births, 'table-general-births', birthColumns, 'surname', true, 'name');
    renderTable(results.families, 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name');
  } catch (error) {
    console.error('Search failed:', error);
    document.getElementById('general-results').innerHTML = `<p>${t('search_failed')}</p>`;
  }
}

// --- Birth / Family advanced search (shared setup) ---

function setupSearchForm({ controlsId, columns, endpoint, resultsId, countId, tableId, introId, defaultSort, defaultSecondarySort = null, urlType }) {
  const container = document.getElementById(controlsId);
  const prefix = `adv-${urlType}-`;

  const exactId = `${prefix}exact`;

  function renderFields() {
    const exactChecked = document.getElementById(exactId)?.checked || false;
    let html = '';
    columns.forEach(col => {
      const inputId = `${prefix}${col}`;
      const label = t(`col_${col}`);
      const val = document.getElementById(inputId)?.value || '';
      html += `<div class="input-wrapper">
                 <input type="text" id="${inputId}" placeholder="${label}" value="${val}" />
                 <button type="button" class="clear-btn" style="display:${val ? 'block' : 'none'}">&times;</button>
               </div>`;
    });
    html += `<label class="exact-toggle">
               <input type="checkbox" id="${exactId}"${exactChecked ? ' checked' : ''} />
               <span>${t('exact_search')}</span>
             </label>`;
    html += `<button id="btn-adv-search-${urlType}">${t('search_btn')}</button>`;
    container.innerHTML = html;
  }

  async function performSearch() {
    const fieldParams = {};
    columns.forEach(c => {
      const val = document.getElementById(`${prefix}${c}`)?.value.trim();
      if (val) fieldParams[c] = val;
    });

    hideIntro(introId);
    document.getElementById(resultsId).style.display = 'block';

    if (!Object.keys(fieldParams).length) {
      document.getElementById(tableId).innerHTML = `<p>${t('enter_criterion')}</p>`;
      document.getElementById(countId).textContent = '0';
      return;
    }

    const exact = document.getElementById(exactId)?.checked || false;
    const shortParams = { t: urlType, ...(exact ? { ex: '1' } : {}) };
    for (const [field, val] of Object.entries(fieldParams)) {
      shortParams[PARAM_MAP[field] || field] = val;
    }
    updateURL(shortParams);

    document.getElementById(tableId).innerHTML = `<p>${t('searching')}</p>`;
    const apiParams = new URLSearchParams({ ...fieldParams, limit: '500', ...(exact ? { exact: 'true' } : {}) });

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/advanced/${endpoint}?${apiParams}`);
      const results = await response.json();
      lastAdvResults[urlType] = { data: results, cols: columns, defaultSort, defaultSecondarySort };
      document.getElementById(countId).textContent = results.length;
      renderTable(results, tableId, columns, defaultSort, true, defaultSecondarySort);
    } catch (error) {
      console.error('Search failed:', error);
      document.getElementById(tableId).innerHTML = `<p>${t('search_failed')}</p>`;
    }
  }

  container.addEventListener('click', (event) => {
    if (event.target.matches(`#btn-adv-search-${urlType}`)) performSearch();
    if (event.target.matches('.clear-btn')) {
      const input = event.target.previousElementSibling;
      if (input) { input.value = ''; event.target.style.display = 'none'; input.focus(); }
    }
  });

  container.addEventListener('input', (event) => {
    if (event.target.matches('input[type="text"]')) {
      const clearBtn = event.target.nextElementSibling;
      if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = event.target.value ? 'block' : 'none';
    }
  });

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input[type="text"]')) performSearch();
  });

  renderFields();

  onLanguageChange(() => {
    renderFields();
    const last = lastAdvResults[urlType];
    if (last) renderTable(last.data, tableId, last.cols, last.defaultSort, true, last.defaultSecondarySort);
  });
}

export function setupBirthSearchForm() {
  setupSearchForm({
    controlsId: 'birth-search-controls',
    columns: birthColumns,
    endpoint: 'births',
    resultsId: 'birth-results',
    countId: 'count-birth-results',
    tableId: 'table-birth-results',
    introId: 'intro-birth',
    defaultSort: 'surname',
    defaultSecondarySort: 'name',
    urlType: 'birth',
  });
}

export function setupFamilySearchForm() {
  setupSearchForm({
    controlsId: 'family-search-controls',
    columns: familyColumns,
    endpoint: 'families',
    resultsId: 'family-results',
    countId: 'count-family-results',
    tableId: 'table-family-results',
    introId: 'intro-family',
    defaultSort: 'husband_surname',
    defaultSecondarySort: 'husband_name',
    urlType: 'family',
  });
}

export function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const tParam = params.get('t');

  if (q) {
    document.getElementById('general-query').value = q;
    if (params.get('ex') === '1') {
      const cb = document.getElementById('general-exact');
      if (cb) cb.checked = true;
    }
    document.getElementById('btn-general-search').click();
  } else if (tParam === 'birth' || tParam === 'family') {
    const columns = tParam === 'birth' ? birthColumns : familyColumns;
    const prefix = `adv-${tParam}-`;
    let hasCriteria = false;
    columns.forEach(col => {
      const val = params.get(PARAM_MAP[col] || col);
      if (val) {
        const input = document.getElementById(`${prefix}${col}`);
        if (input) {
          input.value = val;
          const clearBtn = input.nextElementSibling;
          if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = 'block';
          hasCriteria = true;
        }
      }
    });
    if (params.get('ex') === '1') {
      const cb = document.getElementById(`${prefix}exact`);
      if (cb) cb.checked = true;
    }
    if (hasCriteria) document.getElementById(`btn-adv-search-${tParam}`)?.click();
  }
}
