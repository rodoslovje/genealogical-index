import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { normalizeSearchDate } from './lib/dates.js';
import { API_BASE_URL, personColumns, familyColumns, DATE_RANGE_COLUMNS, DISPLAY_ONLY_COLUMNS } from './config.js';
import { updateURL, pushURL, PARAM_MAP, LEGACY_TAB_MAP, currentParams } from './lib/url.js';
import { hideIntro } from './intros.js';
import { tabsWithResults } from './tab-state.js';
import { inputWithClear, wireClearableContainer, setInputValue } from './lib/utils.js';

let lastGeneralResults = null;
const lastAdvResults = { person: null, family: null };

// Set to true during URL-driven restore so searches use replaceState, not pushState
let isRestoring = false;

function normalizeNameList(val) {
  if (!val) return val;
  return val.split(',').map(s => s.trim()).filter(Boolean).join(',');
}

// --- Shared form fragments (used by both the general and advanced forms) ---

/** The source <select> (All / Family Trees / Matricula Index). */
function renderSourceSelect(id, value) {
  const opt = (v, key) => `<option value="${v}"${value === v ? ' selected' : ''}>${t(key)}</option>`;
  return `<select id="${id}" style="margin-top: 4px;">
            ${opt('all', 'source_all')}
            ${opt('tree', 'source_tree')}
            ${opt('matricula', 'source_matricula')}
          </select>`;
}

/** The "with link" checkbox, exact/approximate radio group, and submit button —
 *  identical across both forms apart from the id prefix and button id. */
function renderSearchOptions({ prefix, hasLinkChecked, exactChecked, buttonId }) {
  return `<label class="exact-toggle">
            <input type="checkbox" id="${prefix}has_link"${hasLinkChecked ? ' checked' : ''} />
            <span>${t('has_link')}</span>
          </label>
          <div class="exact-radio-group">
            <label class="exact-toggle">
              <input type="radio" name="${prefix}exact-mode" id="${prefix}exact-approx" value="approx"${!exactChecked ? ' checked' : ''} />
              <span>${t('approximate_search')}</span>
            </label>
            <label class="exact-toggle">
              <input type="radio" name="${prefix}exact-mode" id="${prefix}exact" value="exact"${exactChecked ? ' checked' : ''} />
              <span>${t('exact_search')}</span>
            </label>
          </div>
          <button id="${buttonId}">${t('search_btn')}</button>`;
}

// --- Shared param serialization ---

/** Maps API field params + toggle state to compact URL params (PARAM_MAP keys
 *  plus ex / hl / src flags). */
function toShortParams(fieldParams, { exact, hasLink, sourceVal } = {}) {
  const out = {};
  for (const [field, val] of Object.entries(fieldParams)) {
    out[PARAM_MAP[field] || field] = val;
  }
  if (exact === false) out.ex = '0';
  if (hasLink) out.hl = '1';
  if (sourceVal && sourceVal !== 'all') out.src = sourceVal;
  return out;
}

/** Maps API field params + toggle state to the long-form params the API expects. */
function toApiParams(fieldParams, { exact, hasLink, sourceVal } = {}) {
  const out = { ...fieldParams };
  if (exact) out.exact = 'true';
  if (hasLink) out.has_link = 'true';
  if (sourceVal && sourceVal !== 'all') out.source = sourceVal;
  return out;
}

// --- Shared form-state helpers (prefix-driven, used by both forms) ---

// Fields shown in the general (cross-type) search form, in render order.
const GENERAL_FIELDS = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];

// Date-typed fields (incl. range "_to" companions) that get date normalization.
const DATE_FIELDS = new Set(['date_from', 'date_to', 'date_of_birth', 'date_of_birth_to', 'date_of_marriage', 'date_of_marriage_to', 'date_of_death', 'date_of_death_to', 'husband_birth', 'husband_birth_to', 'wife_birth', 'wife_birth_to']);

/** Searchable input names for an advanced form's column set: every non
 *  display-only column, each date-range column followed by its "_to" partner. */
function searchFields(columns) {
  const out = [];
  columns.filter(c => !DISPLAY_ONLY_COLUMNS.has(c)).forEach(c => {
    out.push(c);
    if (DATE_RANGE_COLUMNS.has(c)) out.push(`${c}_to`);
  });
  return out;
}

/** Reads a form's field inputs into an API-field → value map: trims, normalizes
 *  comma lists for name/place/contributor fields and (optionally) dates. */
function collectFieldParams(prefix, fields, { normalizeDates = true } = {}) {
  const out = {};
  fields.forEach(f => {
    let val = document.getElementById(`${prefix}${f}`)?.value.trim();
    if (normalizeDates && DATE_FIELDS.has(f)) val = normalizeSearchDate(val);
    if (f.includes('name') || f.includes('place') || f === 'contributor') val = normalizeNameList(val);
    if (val) out[f] = val;
  });
  return out;
}

/** Reads the exact / has-link / source toggle state for a form. Defaults to
 *  exact search when the radio is absent (the rendered default). */
function readToggles(prefix) {
  return {
    exact: document.getElementById(`${prefix}exact`)?.checked ?? true,
    hasLink: document.getElementById(`${prefix}has_link`)?.checked || false,
    sourceVal: document.getElementById(`${prefix}source`)?.value || 'all',
  };
}

/** Restores field inputs from URL params (short or long key). Returns true if
 *  any field was filled. */
function restoreFields(prefix, fields, params) {
  let any = false;
  fields.forEach(f => {
    const val = params.get(PARAM_MAP[f] || f) || params.get(f);
    if (val) { setInputValue(document.getElementById(`${prefix}${f}`), val); any = true; }
  });
  return any;
}

/** Restores the exact / has-link / source toggles from URL params. Returns true
 *  if has-link was set (a standalone search criterion). */
function restoreToggles(prefix, params) {
  const srcSelect = document.getElementById(`${prefix}source`);
  if (srcSelect) srcSelect.value = params.get('src') || params.get('source') || 'all';
  const approxRadio = document.getElementById(`${prefix}exact-approx`);
  const exactRadio = document.getElementById(`${prefix}exact`);
  if (params.get('ex') === '0') { if (approxRadio) approxRadio.checked = true; }
  else { if (exactRadio) exactRadio.checked = true; }
  const hasLink = params.get('hl') === '1';
  if (hasLink) { const cb = document.getElementById(`${prefix}has_link`); if (cb) cb.checked = true; }
  return hasLink;
}

/** Resets a form's field inputs and toggles to their defaults. */
function clearForm(prefix, fields) {
  fields.forEach(f => setInputValue(document.getElementById(`${prefix}${f}`), ''));
  const hasLink = document.getElementById(`${prefix}has_link`); if (hasLink) hasLink.checked = false;
  const exact = document.getElementById(`${prefix}exact`); if (exact) exact.checked = true;
  const approx = document.getElementById(`${prefix}exact-approx`); if (approx) approx.checked = false;
  const src = document.getElementById(`${prefix}source`); if (src) src.value = 'all';
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
    const sourceVal = document.getElementById('general-source')?.value || 'all';
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
      <div class="field-group">
        <div class="field-group-label">${t('label_source')}</div>
        ${inputWithClear({ id: 'general-contributor', placeholder: t('col_contributor'), value: valOf('general-contributor'), title: t('tip_comma_separated_contributor') })}
        ${renderSourceSelect('general-source', sourceVal)}
      </div>
      ${renderSearchOptions({ prefix: 'general-', hasLinkChecked, exactChecked, buttonId: 'btn-general-search' })}
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
      renderTable(lastGeneralResults.persons || [], 'table-general-persons', personColumns, 'surname', true, 'name');
      renderTable(lastGeneralResults.families || [], 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name');
    }
  });
}

async function performGeneralSearch() {
  const fieldParams = collectFieldParams('general-', GENERAL_FIELDS);
  const { exact, hasLink, sourceVal } = readToggles('general-');

  hideIntro('intro-general');
  document.getElementById('general-results').style.display = 'block';

  // No criteria: show the same prompt the advanced forms show, rather than
  // silently doing nothing.
  if (!Object.keys(fieldParams).length && !hasLink) {
    document.getElementById('count-general-persons').textContent = '0';
    document.getElementById('count-general-families').textContent = '0';
    document.getElementById('table-general-persons').innerHTML = `<p>${t('enter_criterion')}</p>`;
    document.getElementById('table-general-families').innerHTML = '';
    return;
  }

  pushOrReplaceURL(toShortParams(fieldParams, { exact, hasLink, sourceVal }));
  document.getElementById('count-general-persons').textContent = '…';
  document.getElementById('count-general-families').textContent = '…';
  document.getElementById('table-general-persons').innerHTML = `<p>${t('searching')}</p>`;
  document.getElementById('table-general-families').innerHTML = `<p>${t('searching')}</p>`;

  if (!lastGeneralResults) lastGeneralResults = { persons: [], families: [] };

  const baseParams = new URLSearchParams(toApiParams(fieldParams, { exact, hasLink, sourceVal }));

  const fetchType = (type, tableId, countId, columns, defaultSort, secondarySort) => {
    const p = new URLSearchParams(baseParams);
    p.set('type', type);
    return fetch(`${API_BASE_URL}/api/search/general?${p}`)
      .then(r => r.json())
      .then(results => {
        const rows = results[type] || [];
        lastGeneralResults[type] = rows;
        tabsWithResults.add('tab-general');
        document.getElementById(countId).textContent = rows.length;
        renderTable(rows, tableId, columns, defaultSort, true, secondarySort);
        collapseSidebarOnDesktop();
        dismissKeyboardAndScrollToResults('general-results');
      })
      .catch((error) => {
        console.error('Search failed:', error);
        document.getElementById(countId).textContent = '0';
        document.getElementById(tableId).innerHTML = `<p>${t('search_failed')}</p>`;
      });
  };

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10));
  }
  // Hide the overlay as soon as the first set (persons or families) returns —
  // the user can start inspecting those results while the other set still loads.
  const hideOverlay = () => { if (overlay) overlay.style.display = 'none'; };
  fetchType('persons',  'table-general-persons',  'count-general-persons',  personColumns, 'surname',         'name').finally(hideOverlay);
  fetchType('families', 'table-general-families', 'count-general-families', familyColumns, 'husband_surname', 'husband_name').finally(hideOverlay);
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
    const sourceVal = document.getElementById(`${prefix}source`)?.value || 'all';
    const exactChecked = approxExists ? document.getElementById(exactId)?.checked : true;
    const hasLinkChecked = document.getElementById(hasLinkId)?.checked || false;
    const visibleColumns = columns.filter(col => !DISPLAY_ONLY_COLUMNS.has(col) && col !== 'contributor');
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
    html += `<div class="field-group">
               <div class="field-group-label">${t('label_source')}</div>
               ${renderInput('contributor')}
               ${renderSourceSelect(`${prefix}source`, sourceVal)}
             </div>`;
    html += renderSearchOptions({ prefix, hasLinkChecked, exactChecked, buttonId: `btn-adv-search-${urlType}` });
    container.innerHTML = html;
  }

  async function performSearch() {
    const fieldParams = collectFieldParams(prefix, searchFields(columns));
    const { exact, hasLink, sourceVal } = readToggles(prefix);

    hideIntro(introId);
    document.getElementById(resultsId).style.display = 'block';

    if (!Object.keys(fieldParams).length && !hasLink) {
      document.getElementById(tableId).innerHTML = `<p>${t('enter_criterion')}</p>`;
      document.getElementById(countId).textContent = '0';
      return;
    }

    pushOrReplaceURL({ t: urlType, ...toShortParams(fieldParams, { exact, hasLink, sourceVal }) });

    document.getElementById(countId).textContent = '…';
    document.getElementById(tableId).innerHTML = `<p>${t('searching')}</p>`;
    const apiParams = new URLSearchParams(toApiParams(fieldParams, { exact, hasLink, sourceVal }));

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
      renderTable(results, tableId, columns, defaultSort, true, defaultSecondarySort);
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
    if (last) renderTable(last.data, tableId, last.cols, last.defaultSort, true, last.defaultSecondarySort);
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
  // normalizeDates:false — preserve whatever the user typed when serializing
  // current form state on a tab switch; searches normalize at fetch time.
  if (tabType === 'general') {
    const fieldParams = collectFieldParams('general-', GENERAL_FIELDS, { normalizeDates: false });
    Object.assign(out, toShortParams(fieldParams, readToggles('general-')));
  } else if (tabType === 'person' || tabType === 'family') {
    const columns = tabType === 'person' ? personColumns : familyColumns;
    const prefix = `adv-${tabType}-`;
    const fieldParams = collectFieldParams(prefix, searchFields(columns), { normalizeDates: false });
    Object.assign(out, toShortParams(fieldParams, readToggles(prefix)));
  }
  return out;
}

export function clearAllSearchForms() {
  clearForm('general-', GENERAL_FIELDS);
  clearForm('adv-person-', searchFields(personColumns));
  clearForm('adv-family-', searchFields(familyColumns));
  // The contributors / matricula sidebars have their own standalone filter inputs.
  ['contributors-query', 'filter-matricula-books'].forEach(id => setInputValue(document.getElementById(id), ''));
}

export function restoreFromURL({ triggerSearch = true } = {}) {
  isRestoring = true;
  const params = currentParams();
  const tParam = resolveTabType(params.get('t'));

  // `hl=1` (with link) is itself a valid general criterion, so a has-link-only
  // search URL must restore even with no name/date/place field present.
  const hasGenParam = GENERAL_FIELDS.some(k => params.has(k) || params.has(PARAM_MAP[k] || k)) || params.get('hl') === '1';
  if ((!tParam || tParam === 'general') && hasGenParam) {
    restoreFields('general-', GENERAL_FIELDS, params);
    restoreToggles('general-', params);
    if (triggerSearch) document.getElementById('btn-general-search')?.click();
  } else if (tParam === 'person' || tParam === 'family') {
    const columns = tParam === 'person' ? personColumns : familyColumns;
    const prefix = `adv-${tParam}-`;
    const fieldsFilled = restoreFields(prefix, searchFields(columns), params);
    const hasLinkSet = restoreToggles(prefix, params);
    if ((fieldsFilled || hasLinkSet) && triggerSearch) document.getElementById(`btn-adv-search-${tParam}`)?.click();
  }
  setTimeout(() => { isRestoring = false; }, 0);
}
