import { t, onLanguageChange } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL, personColumns, familyColumns, DATE_RANGE_COLUMNS, DISPLAY_ONLY_COLUMNS } from './config.js';
import { updateURL, pushURL, PARAM_MAP, LEGACY_TAB_MAP } from './url.js';
import { hideIntro, tabsWithResults } from './main.js';
import { getContributorUrlMap } from './contributors.js';

let lastGeneralResults = null;
const lastAdvResults = { person: null, family: null };

// Set to true during URL-driven restore so searches use replaceState, not pushState
let isRestoring = false;

// --- Date normalization ---

const MONTH_NAMES_EN = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Maps all supported month spellings (EN/IT/SL, full and abbreviated) to 1-based month index
const MONTH_MAP = {
  // English full & abbrev
  january:1,  february:2,  march:3,    april:4,    may:5,      june:6,
  july:7,     august:8,    september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  // Slovenian full & abbrev (those differing from English)
  januar:1,   februar:2,   marec:3,    maj:5,      junij:6,    julij:7,
  avgust:8,   avg:8,       oktober:10, okt:10,
  // Croatian full & abbrev (those differing from English)
  siječanj:1, veljača:2,   vel:2,      ožujak:3,   ožu:3,      travanj:4,   tra:4,
  svibanj:5,  svi:5,       lipanj:6,   lip:6,      srpanj:7,   srp:7,
  kolovoz:8,  kol:8,       rujan:9,    ruj:9,      listopad:10,lis:10,
  studeni:11, stu:11,      prosinac:12,pro:12,
  // German full & abbrev (those differing from English)
  januar:1,   februar:2,   märz:3,     mär:3,      april:4,    mai:5,
  juni:6,     juli:7,      august:8,   september:9, oktober:10,
  november:11,dezember:12, dez:12,
  // Hungarian full & abbrev (those differing from English)
  január:1,   február:2,   március:3,  márc:3,     már:3,      április:4,   ápr:4,
  május:5,    máj:5,       június:6,   jún:6,      július:7,   júl:7,
  augusztus:8, szeptember:9, szept:9,  október:10,
  // Italian full & abbrev (those differing from English)
  gennaio:1,  febbraio:2,  marzo:3,    aprile:4,   maggio:5,   giugno:6,
  luglio:7,   agosto:8,    settembre:9, ottobre:10, novembre:11, dicembre:12,
  gen:1, mag:5, giu:6, lug:7, ago:8, set:9, ott:10, dic:12,
};

const MON_RE = '[A-Za-zčšžČŠŽäöüÄÖÜáéíóőúűÁÉÍÓŐÚŰ]+';

function normalizeSearchDate(val) {
  if (!val) return val;
  const str = val.trim();

  const dotMatch = str.match(/^(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4})$/);
  if (dotMatch) {
    const m = parseInt(dotMatch[2], 10);
    if (m >= 1 && m <= 12) return `${parseInt(dotMatch[1], 10)} ${MONTH_NAMES_EN[m - 1]} ${dotMatch[3]}`;
  }

  const slashMatch = str.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    if (m >= 1 && m <= 12) return `${parseInt(slashMatch[2], 10)} ${MONTH_NAMES_EN[m - 1]} ${slashMatch[3]}`;
  }

  const wordMatch = str.match(new RegExp(`^(\\d{1,2})\\s+(${MON_RE})\\s+(\\d{4})$`));
  if (wordMatch) {
    const m = MONTH_MAP[wordMatch[2].toLowerCase()];
    if (m) return `${parseInt(wordMatch[1], 10)} ${MONTH_NAMES_EN[m - 1]} ${wordMatch[3]}`;
  }

  const monDotYearMatch = str.match(new RegExp(`^(\\d{1,2}|${MON_RE})\\s*\\.\\s*(\\d{4})$`));
  if (monDotYearMatch) {
    const raw = monDotYearMatch[1];
    const year = monDotYearMatch[2];
    const m = /^\d+$/.test(raw) ? parseInt(raw, 10) : MONTH_MAP[raw.toLowerCase()];
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${year}`;
  }

  const monSlashYearMatch = str.match(new RegExp(`^(\\d{1,2}|${MON_RE})\\s*\\/\\s*(\\d{4})$`));
  if (monSlashYearMatch) {
    const raw = monSlashYearMatch[1];
    const year = monSlashYearMatch[2];
    const m = /^\d+$/.test(raw) ? parseInt(raw, 10) : MONTH_MAP[raw.toLowerCase()];
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${year}`;
  }

  const monSpaceYearMatch = str.match(new RegExp(`^(${MON_RE})\\s+(\\d{4})$`));
  if (monSpaceYearMatch) {
    const m = MONTH_MAP[monSpaceYearMatch[1].toLowerCase()];
    if (m) return `${MONTH_NAMES_EN[m - 1]} ${monSpaceYearMatch[2]}`;
  }

  const isoFullMatch = str.match(/^(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (isoFullMatch) {
    const m = parseInt(isoFullMatch[2], 10);
    if (m >= 1 && m <= 12) return `${parseInt(isoFullMatch[3], 10)} ${MONTH_NAMES_EN[m - 1]} ${isoFullMatch[1]}`;
  }

  const isoMonthMatch = str.match(/^(\d{4})\s*-\s*(\d{1,2})$/);
  if (isoMonthMatch) {
    const m = parseInt(isoMonthMatch[2], 10);
    if (m >= 1 && m <= 12) return `${MONTH_NAMES_EN[m - 1]} ${isoMonthMatch[1]}`;
  }

  return str;
}

function pushOrReplaceURL(params) {
  const current = new URLSearchParams(window.location.search);
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
    const nameVal = document.getElementById('general-name')?.value || '';
    const surnameVal = document.getElementById('general-surname')?.value || '';
    const dateFromVal = document.getElementById('general-date_from')?.value || '';
    const dateToVal = document.getElementById('general-date_to')?.value || '';
    const placeVal = document.getElementById('general-place')?.value || '';
    const contributorVal = document.getElementById('general-contributor')?.value || '';
    const approxExists = document.getElementById('general-exact-approx');
    const exactChecked = approxExists ? document.getElementById('general-exact')?.checked : true;
    const hasLinkChecked = document.getElementById('general-has_link')?.checked || false;

    let html = `
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
      renderTable(lastGeneralResults.persons || [], 'table-general-persons', personColumns, 'surname', true, 'name', getContributorUrlMap());
      renderTable(lastGeneralResults.families || [], 'table-general-families', familyColumns, 'husband_surname', true, 'husband_name', getContributorUrlMap());
    }
  });
}

const DATE_FIELDS = new Set(['date_from', 'date_to', 'date_of_birth', 'date_of_birth_to', 'date_of_marriage', 'date_of_marriage_to', 'date_of_death', 'date_of_death_to']);

function performGeneralSearch() {
  const params = {};
  const fields = ['name', 'surname', 'date_from', 'date_to', 'place', 'contributor'];
  fields.forEach(f => {
    let val = document.getElementById(`general-${f}`)?.value.trim();
    if (DATE_FIELDS.has(f)) val = normalizeSearchDate(val);
    if (val) params[f] = val;
  });

  if (!Object.keys(params).length) return;

  const exact = document.getElementById('general-exact')?.checked ?? true;
  if (exact) params.exact = 'true';

  const hasLink = document.getElementById('general-has_link')?.checked || false;
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

  function renderFields() {
    const approxExists = document.getElementById(`${prefix}exact-approx`);
    const exactChecked = approxExists ? document.getElementById(exactId)?.checked : true;
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
      if (val) fieldParams[c] = val;
      if (DATE_RANGE_COLUMNS.has(c)) {
        let toVal = document.getElementById(`${prefix}${c}_to`)?.value.trim();
        toVal = normalizeSearchDate(toVal);
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

    const exact = document.getElementById(exactId)?.checked ?? true;
    const hasLink = document.getElementById(hasLinkId)?.checked || false;
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
      const val = document.getElementById(`general-${f}`)?.value.trim();
      if (val) out[PARAM_MAP[f] || f] = val;
    });
    if (!document.getElementById('general-exact')?.checked) out.ex = '0';
    if (document.getElementById('general-has_link')?.checked) out.hl = '1';
  } else if (tabType === 'person' || tabType === 'family') {
    const columns = tabType === 'person' ? personColumns : familyColumns;
    const prefix = `adv-${tabType}-`;
    columns.filter(c => !DISPLAY_ONLY_COLUMNS.has(c)).forEach(col => {
      const val = document.getElementById(`${prefix}${col}`)?.value.trim();
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
  ['general-name', 'general-surname', 'general-date_from', 'general-date_to', 'general-place', 'general-contributor'].forEach(id => {
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
  const params = new URLSearchParams(window.location.search);
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
