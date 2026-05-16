import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { normalizeSearchDate } from './dates.js';
import { API_BASE_URL, personColumns, familyColumns, DATE_RANGE_COLUMNS, DISPLAY_ONLY_COLUMNS } from './config.js';
import { updateURL, pushURL, PARAM_MAP, LEGACY_TAB_MAP, currentParams } from './url.js';
import { hideIntro, tabsWithResults } from './main.js';
import { getContributorUrlMap } from './contributors.js';
import { inputWithClear, wireClearableContainer } from './utils.js';

let lastGeneralResults = null;
const lastAdvResults = { person: null, family: null };

// Set to true during URL-driven restore so searches use replaceState, not pushState
let isRestoring = false;

function normalizeNameList(val) {
  if (!val) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean).join(',');
}

function pushOrReplaceURL(params) {
  const current = currentParams();
  current.delete('t');
  const hasExistingSearch = current.toString() !== '';
  if (!isRestoring && hasExistingSearch) pushURL(params); else updateURL(params);
}

function dismissKeyboardAndScrollToResults(resultsId) {
  if (window.innerWidth <= 768) {
    document.activeElement?.blur();
    const el = document.getElementById(resultsId);
    const target = el?.querySelector('h2') || el;
    if (target) setTimeout(() => {
      const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 0;
      const y = target.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }, 100);
  }
}

function collapseSidebarOnDesktop() {
  if (window.innerWidth > 768) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

// --- General search ---

export function setupGeneralSearch() {
  const queryInput = document.getElementById('general-query');
  const container = document.getElementById('general-search-controls') || (queryInput ? queryInput.closest('.search-box') : null);

  function renderFields() {
    if (!container) return;
    const valOf = (id) => document.getElementById(id)?.value || '';
    const approxExists = document.getElementById('general-exact-approx');
    const exactChecked = approxExists ? document.getElementById('general-exact')?.checked : true;
    const hasLinkChecked = document.getElementById('general-has_link')?.checked || false;

    container.innerHTML = `
      <div class="field-group">
        <div class="field-group-label">${t('label_person')}</div>
        ${inputWithClear({ id: 'general-name',    placeholder: t('col_name'),    value: valOf('general-name'),    title: t('tip_comma_separated_name')    })}
        ${inputWithClear({ id: 'general-surname', placeholder: t('col_surname'), value: valOf('general-surname'), title: t('tip_comma_separated_surname') })}
      </div>
      <div class="date-range">
        ${inputWithClear({ id: 'general-date_from', placeholder: t('col_date'), value: valOf('general-date_from') })}
        ${inputWithClear({ id: 'general-date_to',   placeholder: t('date_to'),  value: valOf('general-date_to') })}
      </div>
      ${inputWithClear({ id: 'general-place',       placeholder: t('col_place'),       value: valOf('general-place'),       title: t('tip_comma_separated_place')       })}
      ${inputWithClear({ id: 'general-contributor', placeholder: t('col_contributor'), value: valOf('general-contributor'), title: t('tip_comma_separated_contributor') })}
      <label class="exact-toggle">
        <input type="checkbox" id="general-has_link"${hasLinkChecked ? ' checked' : ''} />
        <span>${t('has_link')}</span>
      </label>
      <div class="exact-radio-group">
        <label class="exact-toggle">
          <input type="radio" name="general-exact-mode" id="general-exact-approx" value="approx"${!exactChecked ? ' checked' : ''} />
          <span>${t('approximate_search')}</span>
        </label>
        <label class="exact-toggle">
          <input type="radio" name="general-exact-mode" id="general-exact" value="exact"${exactChecked ? ' checked' : ''} />
          <span>${t('exact_search')}</span>
        </label>
      </div>
      <button id="btn-general-search">${t('search_btn')}</button>
    `;
  }

  if (container) {
    renderFields();
    container.addEventListener('click', (event) => {
      if (event.target.matches('#btn-general-search')) performGeneralSearch();
    });
    wireClearableContainer(container, performGeneralSearch);
  } else {
    document.getElementById('btn-general-search')?.addEventListener('click', performGeneralSearch);
  }

  onLanguageChange(() => {
    if (container) renderFields();
    if (lastGeneralResults) {
      renderTable(lastGeneralResults.persons || [], 'table-general-persons', personColumns, 'surname', true, 'name', getContributorUrlMap());
      renderTable(lastGeneralResults.families || [], 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name', getContributorUrlMap());
    }
  });
}

const DATE_FIELDS = new Set(['date_from', 'date_to', 'date_of_birth', 'date_of_birth_to', 'date_of_marriage', 'date_of_marriage_to', 'date_of_death', 'date_of_death_to', 'husband_birth', 'husband_birth_to', 'wife_birth', 'wife_birth_to']);

function performGeneralSearch() {
  const params = {};
  const fields = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
  fields.forEach(f => {
    let val = document.getElementById(`general-${f}`)?.value.trim();
    if (DATE_FIELDS.has(f)) val = normalizeSearchDate(val);
    if (f === 'name' || f === 'surname' || f === 'place' || f === 'contributor') val = normalizeNameList(val);
    if (val) params[f] = val;
  });

  const hasLink = document.getElementById('general-has_link')?.checked || false;
  if (!Object.keys(params).length && !hasLink) return;

  const exact = document.getElementById('general-exact')?.checked ?? true;
  if (exact) params.exact = 'true';
  if (hasLink) params.has_link = 'true';

  const shortParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'exact' || key === 'has_link') continue;
    shortParams[PARAM_MAP[key] || key] = value;
  }
  if (!exact) shortParams.ex = '0';
  if (hasLink) shortParams.hl = '1';

  pushOrReplaceURL(shortParams);
  hideIntro('intro-general');
  document.getElementById('general-results').style.display = 'block';
  document.getElementById('count-general-persons').textContent = '…';
  document.getElementById('count-general-families').textContent = '…';
  document.getElementById('table-general-persons').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-families').innerHTML = `<p>${t('searching')}</p>`;

  if (!lastGeneralResults) lastGeneralResults = { persons: [], families: [] };

  const baseParams = new URLSearchParams(params);

  const fetchType = (type, tableId, countId, columns, defaultSort, secondarySort) => {
    const p = new URLSearchParams(baseParams);
    p.set('type', type);
    fetch(`${API_BASE_URL}/api/search/general?${p}`)
      .then(r => r.json())
      .then(results => {
        const rows = results[type] || [];
        lastGeneralResults[type] = rows;
        tabsWithResults.add('tab-general');
        document.getElementById(countId).textContent = rows.length;
        renderTable(rows, tableId, columns, defaultSort, true, secondarySort, getContributorUrlMap());
        collapseSidebarOnDesktop();
        dismissKeyboardAndScrollToResults('general-results');
      })
      .catch(() => {
        document.getElementById(countId).textContent = '0';
        document.getElementById(tableId).innerHTML = `<p>${t('search_failed')}</p>`;
      });
  };

  fetchType('persons',  'table-general-persons',  'count-general-persons',  personColumns, 'surname',         'name');
  fetchType('families', 'table-general-families', 'count-general-families', familyColumns, 'husband_surname', 'husband_name');
}

// --- Person / Family advanced search (shared setup) ---

function setupSearchForm({ controlsId, columns, endpoint, resultsId, countId, tableId, introId, defaultSort, defaultSecondarySort = null, urlType }) {
  const container = document.getElementById(controlsId);
  const prefix = `adv-${urlType}-`;

  const exactId = `${prefix}exact`;
  const hasLinkId = `${prefix}has_link`;

  // Group related fields (date+place, name+surname) under a small section label
  // so they read as one block.  Other columns flow normally.
  const FIELD_GROUPS = {
    name:             { startLabelKey: 'label_person',   members: ['name', 'surname'] },
    husband_name:     { startLabelKey: 'label_husband',  members: ['husband_name', 'husband_surname', 'husband_birth'] },
    wife_name:        { startLabelKey: 'label_wife',     members: ['wife_name', 'wife_surname', 'wife_birth'] },
    date_of_birth:    { startLabelKey: 'label_birth',    members: ['date_of_birth', 'place_of_birth'] },
    date_of_death:    { startLabelKey: 'label_death',    members: ['date_of_death', 'place_of_death'] },
    date_of_marriage: { startLabelKey: 'label_marriage', members: ['date_of_marriage', 'place_of_marriage'] },
  };
  const GROUPED_FIELDS = new Set();
  Object.values(FIELD_GROUPS).forEach(g => g.members.forEach(m => GROUPED_FIELDS.add(m)));

  // When a column is rendered inside its group's box, the group label already
  // conveys the prefix ("Husband", "Birth", ...) — show just the short term.
  const GROUPED_PLACEHOLDER_KEYS = {
    husband_name: 'col_name',
    husband_surname: 'col_surname',
    husband_birth: 'col_date_of_birth',
    wife_name: 'col_name',
    wife_surname: 'col_surname',
    wife_birth: 'col_date_of_birth',
    date_of_birth: 'col_date',
    place_of_birth: 'col_place',
    date_of_death: 'col_date',
    place_of_death: 'col_place',
    date_of_marriage: 'col_date',
    place_of_marriage: 'col_place',
  };

  function tipFor(col) {
    if (col.includes('surname'))      return t('tip_comma_separated_surname');
    if (col.includes('name'))         return t('tip_comma_separated_name');
    if (col.includes('place'))        return t('tip_comma_separated_place');
    if (col === 'contributor')        return t('tip_comma_separated_contributor');
    return '';
  }

  function renderInput(col, { grouped = false } = {}) {
    const inputId = `${prefix}${col}`;
    const labelKey = grouped && GROUPED_PLACEHOLDER_KEYS[col] ? GROUPED_PLACEHOLDER_KEYS[col] : `col_${col}`;
    const placeholder = t(labelKey);
    const value = document.getElementById(inputId)?.value || '';
    const title = tipFor(col);

    if (DATE_RANGE_COLUMNS.has(col)) {
      const toId = `${prefix}${col}_to`;
      const toValue = document.getElementById(toId)?.value || '';
      return `<div class="date-range">
        ${inputWithClear({ id: inputId, placeholder, value })}
        ${inputWithClear({ id: toId,    placeholder: t('date_to'), value: toValue })}
      </div>`;
    }
    return inputWithClear({ id: inputId, placeholder, value, title });
  }

  function renderFields() {
    const approxExists = document.getElementById(`${prefix}exact-approx`);
    const exactChecked = approxExists ? document.getElementById(exactId)?.checked : true;
    const hasLinkChecked = document.getElementById(hasLinkId)?.checked || false;
    const visibleColumns = columns.filter(col => !DISPLAY_ONLY_COLUMNS.has(col));
    let html = '';
    let i = 0;
    while (i < visibleColumns.length) {
      const col = visibleColumns[i];
      const group = FIELD_GROUPS[col];
      if (group) {
        const memberSet = new Set(group.members);
        const inner = [];
        while (i < visibleColumns.length && memberSet.has(visibleColumns[i])) {
          inner.push(renderInput(visibleColumns[i], { grouped: true }));
          i++;
        }
        html += `<div class="field-group">
                   <div class="field-group-label">${t(group.startLabelKey)}</div>
                   ${inner.join('')}
                 </div>`;
      } else if (GROUPED_FIELDS.has(col)) {
        // Member of a group whose start column wasn't present — render standalone.
        html += renderInput(col);
        i++;
      } else {
        html += renderInput(col);
        i++;
      }
    }
    html += `<label class="exact-toggle">
               <input type="checkbox" id="${hasLinkId}"${hasLinkChecked ? ' checked' : ''} />
               <span>${t('has_link')}</span>
             </label>`;
    html += `<div class="exact-radio-group">
               <label class="exact-toggle">
                 <input type="radio" name="${prefix}exact-mode" id="${prefix}exact-approx" value="approx"${!exactChecked ? ' checked' : ''} />
                 <span>${t('approximate_search')}</span>
               </label>
               <label class="exact-toggle">
                 <input type="radio" name="${prefix}exact-mode" id="${exactId}" value="exact"${exactChecked ? ' checked' : ''} />
                 <span>${t('exact_search')}</span>
               </label>
             </div>`;
    html += `<button id="btn-adv-search-${urlType}">${t('search_btn')}</button>`;
    container.innerHTML = html;
  }

  async function performSearch() {
    const fieldParams = {};
    columns.filter(c => !DISPLAY_ONLY_COLUMNS.has(c)).forEach(c => {
      let val = document.getElementById(`${prefix}${c}`)?.value.trim();
      if (DATE_FIELDS.has(c)) val = normalizeSearchDate(val);
      if (c.includes('name') || c.includes('surname') || c.includes('place') || c === 'contributor') val = normalizeNameList(val);
      if (val) fieldParams[c] = val;
      if (DATE_RANGE_COLUMNS.has(c)) {
        let toVal = document.getElementById(`${prefix}${c}_to`)?.value.trim();
        toVal = normalizeSearchDate(toVal);
        if (toVal) fieldParams[`${c}_to`] = toVal;
      }
    });

    hideIntro(introId);
    document.getElementById(resultsId).style.display = 'block';

    const hasLink = document.getElementById(hasLinkId)?.checked || false;
    if (!Object.keys(fieldParams).length && !hasLink) {
      document.getElementById(tableId).innerHTML = `<p>${t('enter_criterion')}</p>`;
      document.getElementById(countId).textContent = '0';
      return;
    }

    const exact = document.getElementById(exactId)?.checked ?? true;
    const shortParams = { t: urlType, ...(!exact ? { ex: '0' } : {}), ...(hasLink ? { hl: '1' } : {}) };
    for (const [field, val] of Object.entries(fieldParams)) {
      shortParams[PARAM_MAP[field] || field] = val;
    }
    pushOrReplaceURL(shortParams);

    document.getElementById(countId).textContent = '0';
    document.getElementById(tableId).innerHTML = `<p>${t('searching')}</p>`;
    const apiParams = new URLSearchParams({ ...fieldParams, ...(exact ? { exact: 'true' } : {}), ...(hasLink ? { has_link: 'true' } : {}) });

    const overlay = document.getElementById('search-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      await new Promise(r => setTimeout(r, 10));
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/search/advanced/${endpoint}?${apiParams}`);
      const results = await response.json();
      lastAdvResults[urlType] = { data: results, cols: columns, defaultSort, defaultSecondarySort };
      tabsWithResults.add(`tab-${urlType}`);
      document.getElementById(countId).textContent = results.length;
      renderTable(results, tableId, columns, defaultSort, true, defaultSecondarySort, getContributorUrlMap());
      collapseSidebarOnDesktop();
      dismissKeyboardAndScrollToResults(resultsId);
    } catch (error) {
      console.error('Search failed:', error);
      document.getElementById(tableId).innerHTML = `<p>${t('search_failed')}</p>`;
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }

  container.addEventListener('click', (event) => {
    if (event.target.matches(`#btn-adv-search-${urlType}`)) performSearch();
  });
  wireClearableContainer(container, performSearch);

  renderFields();

  onLanguageChange(() => {
    renderFields();
    const last = lastAdvResults[urlType];
    if (last) renderTable(last.data, tableId, last.cols, last.defaultSort, true, last.defaultSecondarySort, getContributorUrlMap());
  });
}

export function setupPersonSearchForm() {
  setupSearchForm({
    controlsId: 'person-search-controls',
    columns: personColumns,
    endpoint: 'persons',
    resultsId: 'person-results',
    countId: 'count-person-results',
    tableId: 'table-person-results',
    introId: 'intro-person',
    defaultSort: 'surname',
    defaultSecondarySort: 'name',
    urlType: 'person',
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

function resolveTabType(rawT) {
  if (!rawT) return null;
  return LEGACY_TAB_MAP[rawT] || rawT;
}

export function getTabURLParams(tabType) {
  const out = { t: tabType };
  if (tabType === 'general') {
    const fields = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
    fields.forEach(f => {
      let val = document.getElementById(`general-${f}`)?.value.trim();
      if (f === 'name' || f === 'surname' || f === 'place' || f === 'contributor') val = normalizeNameList(val);
      if (val) out[PARAM_MAP[f] || f] = val;
    });
    if (!document.getElementById('general-exact')?.checked) out.ex = '0';
    if (document.getElementById('general-has_link')?.checked) out.hl = '1';
  } else if (tabType === 'person' || tabType === 'family') {
    const columns = tabType === 'person' ? personColumns : familyColumns;
    const prefix = `adv-${tabType}-`;
    columns.filter(c => !DISPLAY_ONLY_COLUMNS.has(c)).forEach(col => {
      let val = document.getElementById(`${prefix}${col}`)?.value.trim();
      if (col.includes('name') || col.includes('surname') || col.includes('place') || col === 'contributor') val = normalizeNameList(val);
      if (val) out[PARAM_MAP[col] || col] = val;
      if (DATE_RANGE_COLUMNS.has(col)) {
        const toVal = document.getElementById(`${prefix}${col}_to`)?.value.trim();
        const toKey = `${col}_to`;
        if (toVal) out[PARAM_MAP[toKey] || toKey] = toVal;
      }
    });
    if (!document.getElementById(`${prefix}exact`)?.checked) out.ex = '0';
    if (document.getElementById(`${prefix}has_link`)?.checked) out.hl = '1';
  }
  return out;
}

export function clearAllSearchForms() {
  ['general-name', 'general-surname', 'general-date_from', 'general-date_to', 'general-place', 'general-contributor', 'contributors-query'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; const cb = el.nextElementSibling; if (cb?.matches('.clear-btn')) cb.style.display = 'none'; }
  });
  const genHasLink = document.getElementById('general-has_link'); if (genHasLink) genHasLink.checked = false;
  const genExact = document.getElementById('general-exact'); if (genExact) genExact.checked = true;
  ['person', 'family'].forEach(type => {
    document.querySelectorAll(`#${type}-search-controls input`).forEach(el => {
      if (el.type === 'checkbox') el.checked = false;
      if (el.type === 'radio' && el.value === 'exact') el.checked = true;
      else { el.value = ''; const cb = el.nextElementSibling; if (cb?.matches('.clear-btn')) cb.style.display = 'none'; }
    });
  });
}

export function restoreFromURL() {
  isRestoring = true;
  const params = currentParams();
  const tParam = resolveTabType(params.get('t'));

  const hasGenParam = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'].some(k => params.has(k) || params.has(PARAM_MAP[k] || k));
  if ((!tParam || tParam === 'general') && hasGenParam) {
    const fields = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
    fields.forEach(f => {
      const shortKey = PARAM_MAP[f] || f;
      const val = params.get(shortKey) || params.get(f);
      if (val) {
        const input = document.getElementById(`general-${f}`);
        if (input) {
          input.value = val;
          const clearBtn = input.nextElementSibling;
          if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = 'block';
        }
      }
    });
    const exactRadio = document.getElementById('general-exact');
    const approxRadio = document.getElementById('general-exact-approx');
    if (params.get('ex') === '0') { if (approxRadio) approxRadio.checked = true; }
    else { if (exactRadio) exactRadio.checked = true; }
    if (params.get('hl') === '1') {
      const cb = document.getElementById('general-has_link');
      if (cb) cb.checked = true;
    }
    document.getElementById('btn-general-search')?.click();
  } else if (tParam === 'person' || tParam === 'family') {
    const columns = tParam === 'person' ? personColumns : familyColumns;
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
    const exactRadio = document.getElementById(`${prefix}exact`);
    const approxRadio = document.getElementById(`${prefix}exact-approx`);
    if (params.get('ex') === '0') { if (approxRadio) approxRadio.checked = true; }
    else { if (exactRadio) exactRadio.checked = true; }
    if (params.get('hl') === '1') {
      const cb = document.getElementById(`${prefix}has_link`);
      if (cb) { cb.checked = true; hasCriteria = true; }
    }
    if (hasCriteria) document.getElementById(`btn-adv-search-${tParam}`)?.click();
  }
  setTimeout(() => { isRestoring = false; }, 0);
}
