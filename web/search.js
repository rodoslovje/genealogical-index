import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL, birthColumns, familyColumns, deathColumns, DATE_RANGE_COLUMNS, DISPLAY_ONLY_COLUMNS } from './config.js';
import { updateURL, PARAM_MAP } from './url.js';
import { hideIntro } from './main.js';

let lastGeneralResults = null;
const lastAdvResults = { birth: null, family: null, death: null };

// --- General search ---

export function setupGeneralSearch() {
  const queryInput = document.getElementById('general-query');
  const container = document.getElementById('general-search-controls') || (queryInput ? queryInput.closest('.search-box') : null);

  function renderFields() {
    if (!container) return;
    const queryVal = document.getElementById('general-query')?.value || '';
    const nameVal = document.getElementById('general-name')?.value || '';
    const surnameVal = document.getElementById('general-surname')?.value || '';
    const dateFromVal = document.getElementById('general-date_from')?.value || '';
    const dateToVal = document.getElementById('general-date_to')?.value || '';
    const placeVal = document.getElementById('general-place')?.value || '';
    const contributorVal = document.getElementById('general-contributor')?.value || '';
    const exactChecked = document.getElementById('general-exact')?.checked || false;
    const hasLinkChecked = document.getElementById('general-has_link')?.checked || false;

    let html = `
      <div class="input-wrapper">
        <input type="text" id="general-query" placeholder="${t('search_placeholder')}" value="${queryVal}" />
        <button type="button" class="clear-btn" style="display:${queryVal ? 'block' : 'none'}">&times;</button>
      </div>
      <div class="input-wrapper">
        <input type="text" id="general-name" placeholder="${t('col_name')}" value="${nameVal}" />
        <button type="button" class="clear-btn" style="display:${nameVal ? 'block' : 'none'}">&times;</button>
      </div>
      <div class="input-wrapper">
        <input type="text" id="general-surname" placeholder="${t('col_surname')}" value="${surnameVal}" />
        <button type="button" class="clear-btn" style="display:${surnameVal ? 'block' : 'none'}">&times;</button>
      </div>
      <div class="date-range">
        <div class="input-wrapper">
          <input type="text" id="general-date_from" placeholder="${t('col_date')}" value="${dateFromVal}" />
          <button type="button" class="clear-btn" style="display:${dateFromVal ? 'block' : 'none'}">&times;</button>
        </div>
        <div class="input-wrapper">
          <input type="text" id="general-date_to" placeholder="${t('date_to')}" value="${dateToVal}" />
          <button type="button" class="clear-btn" style="display:${dateToVal ? 'block' : 'none'}">&times;</button>
        </div>
      </div>
      <div class="input-wrapper">
        <input type="text" id="general-place" placeholder="${t('col_place')}" value="${placeVal}" />
        <button type="button" class="clear-btn" style="display:${placeVal ? 'block' : 'none'}">&times;</button>
      </div>
      <div class="input-wrapper">
        <input type="text" id="general-contributor" placeholder="${t('col_contributor')}" value="${contributorVal}" />
        <button type="button" class="clear-btn" style="display:${contributorVal ? 'block' : 'none'}">&times;</button>
      </div>
      <label class="exact-toggle">
        <input type="checkbox" id="general-has_link"${hasLinkChecked ? ' checked' : ''} />
        <span>${t('has_link')}</span>
      </label>
      <label class="exact-toggle">
        <input type="checkbox" id="general-exact"${exactChecked ? ' checked' : ''} />
        <span>${t('exact_search')}</span>
      </label>
      <button id="btn-general-search">${t('search_btn')}</button>
    `;
    container.innerHTML = html;
  }

  if (container) {
    renderFields();
    container.addEventListener('click', (event) => {
      if (event.target.matches('#btn-general-search')) performGeneralSearch();
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
      if (event.key === 'Enter' && event.target.matches('input[type="text"]')) performGeneralSearch();
    });
  } else {
    document.getElementById('btn-general-search')?.addEventListener('click', performGeneralSearch);
  }

  onLanguageChange(() => {
    if (container) renderFields();
    if (lastGeneralResults) {
      renderTable(lastGeneralResults.births || [], 'table-general-births', birthColumns, 'surname', true, 'name');
      renderTable(lastGeneralResults.families || [], 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name');
      renderTable(lastGeneralResults.deaths || [], 'table-general-deaths', deathColumns, 'surname', true, 'name');
    }
  });
}

async function performGeneralSearch() {
  const params = {};
  const fields = ['query', 'name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
  fields.forEach(f => {
    const val = document.getElementById(`general-${f}`)?.value.trim();
    if (val) params[f === 'query' ? 'q' : f] = val;
  });

  const hasTextParam = ['q', 'name', 'surname', 'date_from', 'date_to', 'place', 'contributor'].some(k => params[k]);
  if (!hasTextParam) return;

  const exact = document.getElementById('general-exact')?.checked || false;
  if (exact) params.exact = 'true';

  const hasLink = document.getElementById('general-has_link')?.checked || false;
  if (hasLink) params.has_link = 'true';

  const shortParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'exact' || key === 'has_link') continue;
    const shortKey = PARAM_MAP[key] || key;
    shortParams[shortKey] = value;
  }
  if (exact) shortParams.ex = '1';
  if (hasLink) shortParams.hl = '1';

  updateURL(shortParams);
  hideIntro('intro-general');
  document.getElementById('general-results').style.display = 'block';
  document.getElementById('count-general-births').textContent = '0';
  document.getElementById('count-general-families').textContent = '0';
  document.getElementById('count-general-deaths').textContent = '0';
  document.getElementById('table-general-births').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-families').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-deaths').innerHTML = `<p>${t('searching')}</p>`;

  const overlay = document.getElementById('search-overlay');
  if (overlay) overlay.style.display = 'flex';

  try {
    const apiParams = new URLSearchParams({ ...params, limit: '500' });
    const response = await fetch(`${API_BASE_URL}/api/search/general?${apiParams}`);
    const results = await response.json();
    lastGeneralResults = results;

    document.getElementById('count-general-births').textContent = results.births?.length || 0;
    document.getElementById('count-general-families').textContent = results.families?.length || 0;
    document.getElementById('count-general-deaths').textContent = results.deaths?.length || 0;

    renderTable(results.births || [], 'table-general-births', birthColumns, 'surname', true, 'name');
    renderTable(results.families || [], 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name');
    renderTable(results.deaths || [], 'table-general-deaths', deathColumns, 'surname', true, 'name');
  } catch (error) {
    console.error('Search failed:', error);
    document.getElementById('table-general-births').innerHTML = `<p>${t('search_failed')}</p>`;
    document.getElementById('table-general-families').innerHTML = `<p>${t('search_failed')}</p>`;
    document.getElementById('table-general-deaths').innerHTML = `<p>${t('search_failed')}</p>`;
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

// --- Birth / Family advanced search (shared setup) ---

function setupSearchForm({ controlsId, columns, endpoint, resultsId, countId, tableId, introId, defaultSort, defaultSecondarySort = null, urlType }) {
  const container = document.getElementById(controlsId);
  const prefix = `adv-${urlType}-`;

  const exactId = `${prefix}exact`;
  const hasLinkId = `${prefix}has_link`;

  function renderFields() {
    const exactChecked = document.getElementById(exactId)?.checked || false;
    const hasLinkChecked = document.getElementById(hasLinkId)?.checked || false;
    let html = '';
    columns.filter(col => !DISPLAY_ONLY_COLUMNS.has(col)).forEach(col => {
      const inputId = `${prefix}${col}`;
      const label = t(`col_${col}`);
      const val = document.getElementById(inputId)?.value || '';
      if (DATE_RANGE_COLUMNS.has(col)) {
        const toId = `${prefix}${col}_to`;
        const toVal = document.getElementById(toId)?.value || '';
        html += `<div class="date-range">
                   <div class="input-wrapper">
                     <input type="text" id="${inputId}" placeholder="${label}" value="${val}" />
                     <button type="button" class="clear-btn" style="display:${val ? 'block' : 'none'}">&times;</button>
                   </div>
                   <div class="input-wrapper">
                     <input type="text" id="${toId}" placeholder="${t('date_to')}" value="${toVal}" />
                     <button type="button" class="clear-btn" style="display:${toVal ? 'block' : 'none'}">&times;</button>
                   </div>
                 </div>`;
      } else {
        html += `<div class="input-wrapper">
                   <input type="text" id="${inputId}" placeholder="${label}" value="${val}" />
                   <button type="button" class="clear-btn" style="display:${val ? 'block' : 'none'}">&times;</button>
                 </div>`;
      }
    });
    html += `<label class="exact-toggle">
               <input type="checkbox" id="${hasLinkId}"${hasLinkChecked ? ' checked' : ''} />
               <span>${t('has_link')}</span>
             </label>`;
    html += `<label class="exact-toggle">
               <input type="checkbox" id="${exactId}"${exactChecked ? ' checked' : ''} />
               <span>${t('exact_search')}</span>
             </label>`;
    html += `<button id="btn-adv-search-${urlType}">${t('search_btn')}</button>`;
    container.innerHTML = html;
  }

  async function performSearch() {
    const fieldParams = {};
    columns.filter(c => !DISPLAY_ONLY_COLUMNS.has(c)).forEach(c => {
      const val = document.getElementById(`${prefix}${c}`)?.value.trim();
      if (val) fieldParams[c] = val;
      if (DATE_RANGE_COLUMNS.has(c)) {
        const toVal = document.getElementById(`${prefix}${c}_to`)?.value.trim();
        if (toVal) fieldParams[`${c}_to`] = toVal;
      }
    });

    hideIntro(introId);
    document.getElementById(resultsId).style.display = 'block';

    if (!Object.keys(fieldParams).length) {
      document.getElementById(tableId).innerHTML = `<p>${t('enter_criterion')}</p>`;
      document.getElementById(countId).textContent = '0';
      return;
    }

    const exact = document.getElementById(exactId)?.checked || false;
    const hasLink = document.getElementById(hasLinkId)?.checked || false;
    const shortParams = { t: urlType, ...(exact ? { ex: '1' } : {}), ...(hasLink ? { hl: '1' } : {}) };
    for (const [field, val] of Object.entries(fieldParams)) {
      shortParams[PARAM_MAP[field] || field] = val;
    }
    updateURL(shortParams);

    document.getElementById(countId).textContent = '0';
    document.getElementById(tableId).innerHTML = `<p>${t('searching')}</p>`;
    const apiParams = new URLSearchParams({ ...fieldParams, limit: '500', ...(exact ? { exact: 'true' } : {}), ...(hasLink ? { has_link: 'true' } : {}) });

    const overlay = document.getElementById('search-overlay');
    if (overlay) overlay.style.display = 'flex';

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/advanced/${endpoint}?${apiParams}`);
      const results = await response.json();
      lastAdvResults[urlType] = { data: results, cols: columns, defaultSort, defaultSecondarySort };
      document.getElementById(countId).textContent = results.length;
      renderTable(results, tableId, columns, defaultSort, true, defaultSecondarySort);
    } catch (error) {
      console.error('Search failed:', error);
      document.getElementById(tableId).innerHTML = `<p>${t('search_failed')}</p>`;
    } finally {
      if (overlay) overlay.style.display = 'none';
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

export function setupDeathSearchForm() {
  setupSearchForm({
    controlsId: 'death-search-controls',
    columns: deathColumns,
    endpoint: 'deaths',
    resultsId: 'death-results',
    countId: 'count-death-results',
    tableId: 'table-death-results',
    introId: 'intro-death',
    defaultSort: 'surname',
    defaultSecondarySort: 'name',
    urlType: 'death',
  });
}

export function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  const tParam = params.get('t');

  const hasGenParam = ['q', 'name', 'surname', 'date_from', 'date_to', 'place', 'contributor'].some(k => params.has(k) || params.has(PARAM_MAP[k] || k));
  if (!tParam && hasGenParam) {
    const fields = ['query', 'name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
    fields.forEach(f => {
      const paramKey = f === 'query' ? 'q' : f;
      const shortKey = PARAM_MAP[paramKey] || paramKey;
      const val = params.get(shortKey) || params.get(paramKey);
      if (val) {
        const input = document.getElementById(`general-${f}`);
        if (input) {
          input.value = val;
          const clearBtn = input.nextElementSibling;
          if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = 'block';
        }
      }
    });
    if (params.get('ex') === '1') {
      const cb = document.getElementById('general-exact');
      if (cb) cb.checked = true;
    }
    if (params.get('hl') === '1') {
      const cb = document.getElementById('general-has_link');
      if (cb) cb.checked = true;
    }
    document.getElementById('btn-general-search')?.click();
  } else if (tParam === 'birth' || tParam === 'family' || tParam === 'death') {
    const columns = tParam === 'birth' ? birthColumns : tParam === 'family' ? familyColumns : deathColumns;
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
      if (DATE_RANGE_COLUMNS.has(col)) {
        const toKey = `${col}_to`;
        const toVal = params.get(PARAM_MAP[toKey] || toKey);
        if (toVal) {
          const toInput = document.getElementById(`${prefix}${toKey}`);
          if (toInput) {
            toInput.value = toVal;
            const clearBtn = toInput.nextElementSibling;
            if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = 'block';
            hasCriteria = true;
          }
        }
      }
    });
    if (params.get('ex') === '1') {
      const cb = document.getElementById(`${prefix}exact`);
      if (cb) cb.checked = true;
    }
    if (params.get('hl') === '1') {
      const cb = document.getElementById(`${prefix}has_link`);
      if (cb) { cb.checked = true; hasCriteria = true; }
    }
    if (hasCriteria) document.getElementById(`btn-adv-search-${tParam}`)?.click();
  }
}
