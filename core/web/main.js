import { t, initI18n, onLanguageChange, getIntro } from './i18n.js';
import siteConfig from '@site-config';
import { BUILD_TIME, DATA_UPDATED } from './build-info.js';
import { renderContributors, refreshContributorsIfVisible, renderTotalsBar, prefetchContributors } from './contributors.js';
import { setupGeneralSearch, setupPersonSearchForm, setupFamilySearchForm, restoreFromURL, clearAllSearchForms, getTabURLParams } from './search.js';
import { toUnicodeSearch, LEGACY_TAB_MAP } from './url.js';

// --- Global Link Styles ---
const globalStyles = document.createElement('style');
globalStyles.textContent = `
  a, a:visited { color: #3498db; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;
document.head.appendChild(globalStyles);

const SEARCH_TABS = ['tab-general', 'tab-person', 'tab-family', 'tab-contributors'];

/** Rewrite legacy ?t=birth / ?t=death values to ?t=person via replaceState.
 *  Runs at app load and when SPA-navigating into a legacy URL so the address
 *  bar always shows the canonical tab.  Other params (n, sn, dob, pob, dod, pod…)
 *  already line up with the unified person form so nothing else needs renaming. */
function normalizeLegacyURL() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  const mapped = t && LEGACY_TAB_MAP[t];
  if (!mapped) return;
  params.set('t', mapped);
  const url = window.location.pathname + '?' + toUnicodeSearch(params);
  history.replaceState(null, '', url);
}
export const tabsWithResults = new Set();

// --- Clearable inputs ---

function setupClearableInput(inputElement, onEnterCallback) {
  if (!inputElement) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'input-wrapper';
  inputElement.parentNode.insertBefore(wrapper, inputElement);
  wrapper.appendChild(inputElement);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'clear-btn';
  clearBtn.innerHTML = '&times;';
  wrapper.appendChild(clearBtn);

  const toggleClearBtn = () => {
    clearBtn.style.display = inputElement.value ? 'block' : 'none';
  };

  clearBtn.addEventListener('click', () => {
    inputElement.value = '';
    toggleClearBtn();
    inputElement.focus();
    inputElement.dispatchEvent(new Event('input'));
  });

  inputElement.addEventListener('input', toggleClearBtn);
  inputElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && onEnterCallback) onEnterCallback();
  });
  toggleClearBtn();
}

// --- Intro text ---

export function renderIntros() {
  const paragraphs = getIntro().map(p =>
    p.warning
      ? `<p class="intro-warning">${p.text}</p>`
      : `<p>${p.text}</p>`
  ).join('');
  const logoImg = siteConfig.logo
    ? `<img src="${siteConfig.logo}" alt="${siteConfig.logoAlt}" class="intro-logo" />`
    : '';
  const indexLink = siteConfig.indexUrl
    ? `<a href="${siteConfig.indexUrl}" target="_blank" rel="noopener" class="intro-logo-link">
        <span class="intro-logo-name">${t('site_title')}</span>
      </a>`
    : '';
  const logo = `<div class="intro-logo-links">
    ${logoImg}
    <div class="intro-logo-text">
      <a href="${siteConfig.societyUrl}" target="_blank" rel="noopener" class="intro-logo-link">
        <span class="intro-logo-name">${t('society_name')}</span>
      </a>
      ${indexLink}
    </div>
  </div>`;

  const otherIndexesList = [
    `<span>🇸🇮 <a href="https://indeks.rodoslovje.si/" target="_blank" rel="noopener" style="font-weight: 500;">${t('country_slo')}</a></span>`,
    `<span>🇭🇷 <a href="https://indeks.rodoslovlje.hr/" target="_blank" rel="noopener" style="font-weight: 500;">${t('country_cro')}</a></span>`
  ];
  const otherIndexesHtml = `
    <div class="other-indexes" style="margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; font-size: 1.05rem;">
      <div style="font-weight: 600;">${t('other_indexes')}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 1.5rem;">
        ${otherIndexesList.join('')}
      </div>
    </div>
  `;

  const html = paragraphs + logo + otherIndexesHtml;
  ['intro-general', 'intro-person', 'intro-family'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

export function hideIntro(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

export function showIntros(onlyId = null) {
  ['intro-general', 'intro-person', 'intro-family'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (!onlyId || id === onlyId) ? '' : 'none';
  });
}

// Intercept intro links to contributors tab so they switch tabs without a page reload
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href="?t=contributors"]');
  if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button !== 1) {
    e.preventDefault();
    document.querySelector('.tab-btn[data-target="tab-contributors"]')?.click();
  }
});

// --- Hamburger ---

const hamburgerBtn = document.querySelector('.hamburger-btn');
const sidebar = document.getElementById('sidebar');
const appHeader = document.querySelector('header');

function updateSidebarTop() {
  const h = appHeader.offsetHeight;
  document.documentElement.style.setProperty('--nav-height', `${h}px`);
}
updateSidebarTop();
window.addEventListener('resize', updateSidebarTop);

hamburgerBtn.addEventListener('click', (e) => {
  e.stopPropagation();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('t') === 'contributors' && urlParams.get('contributor')) {
    return;
  }

  if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
    const rect = sidebar.getBoundingClientRect();
    const sidebarVisible = rect.bottom > 0;
    if (!sidebarVisible) {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      return;
    }
  }
  sidebar.classList.toggle('open');
  if (sidebar.classList.contains('open')) {
    if (window.innerWidth <= 768) {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    const activeSection = sidebar.querySelector('.sidebar-section.active');
    if (activeSection) {
      const inputs = Array.from(activeSection.querySelectorAll('input[type="text"]'));
      const target = inputs.find(i => i.value.trim()) || inputs[0];
      if (target && window.innerWidth > 768) setTimeout(() => target.focus(), 0);
    }
  }
});

document.addEventListener('click', (e) => {
  if (window.innerWidth > 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !hamburgerBtn.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// --- Tab Management ---

let isInitializing = false;

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const targetTab = btn.dataset.target;

    const tabTypeMap = {
      'tab-general':      'general',
      'tab-person':       'person',
      'tab-family':       'family',
      'tab-contributors': 'contributors',
    };
    const urlT = tabTypeMap[targetTab];
    if (urlT && !isInitializing) {
      const params = urlT === 'contributors' ? { t: urlT } : getTabURLParams(urlT);
      const url = new URL(window.location);
      url.search = '';
      for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v);
      }
      const newUrlStr = url.pathname + (url.searchParams.toString() ? '?' + toUnicodeSearch(url.searchParams) : '');
      const currentT = new URLSearchParams(window.location.search).get('t') || 'general';
      if (currentT !== urlT) {
        history.pushState(null, '', newUrlStr);
      } else {
        history.replaceState(null, '', newUrlStr);
      }
    }

    if (targetTab === 'tab-contributors') {
      document.body.classList.add('contributors-view');
      renderContributors();
      renderTotalsBar();
    } else {
      document.body.classList.remove('contributors-view');
    }

    const resultsMap = {
      'tab-general': 'general-results',
      'tab-person':  'person-results',
      'tab-family':  'family-results',
    };
    ['tab-general', 'tab-person', 'tab-family'].forEach(tab => {
      if (tab !== targetTab) document.getElementById(resultsMap[tab])?.style.setProperty('display', 'none');
    });
    const introMap = {
      'tab-general': 'intro-general',
      'tab-person':  'intro-person',
      'tab-family':  'intro-family',
    };
    if (tabsWithResults.has(targetTab)) {
      document.getElementById(resultsMap[targetTab]).style.display = 'block';
      hideIntro(introMap[targetTab]);
    } else {
      showIntros(introMap[targetTab]);
    }

    const isMatchesPage = targetTab === 'tab-contributors' && new URLSearchParams(window.location.search).get('contributor');

    if (SEARCH_TABS.includes(targetTab) && !isMatchesPage) {
      sidebar.classList.add('open');
    } else if (window.innerWidth > 768 || isMatchesPage) {
      sidebar.classList.remove('open');
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));

    const sidebarSectionMap = {
      'tab-general':      'general-search-sidebar',
      'tab-person':       'person-search-sidebar',
      'tab-family':       'family-search-sidebar',
      'tab-contributors': 'contributors-search-sidebar',
    };
    const sidebarSection = sidebarSectionMap[targetTab];
    if (sidebarSection) {
      const section = document.getElementById(sidebarSection);
      section.classList.add('active');
      const inputs = Array.from(section.querySelectorAll('input[type="text"]'));
      const target = inputs.find(i => i.value.trim()) || inputs[0];
      if (target && window.innerWidth > 768) setTimeout(() => target.focus(), 0);
    }

    document.querySelectorAll(`.tab-btn[data-target="${targetTab}"]`).forEach(b => b.classList.add('active'));
    document.getElementById(targetTab).classList.add('active');
  });
});

// --- Init ---

async function init() {
  const loading = document.getElementById('loading');
  loading.style.display = 'none';

  try {
    initI18n();

    setupClearableInput(document.getElementById('contributors-query'), () => {
      sidebar.classList.remove('open');
      document.activeElement?.blur();
    });

    setupGeneralSearch();
    setupPersonSearchForm();
    setupFamilySearchForm();
    renderIntros();
    prefetchContributors();

    const buildEl = document.getElementById('build-time');
    const dataEl = document.getElementById('data-updated');
    if (buildEl) buildEl.textContent = BUILD_TIME.slice(0, 10);
    if (dataEl) dataEl.textContent = DATA_UPDATED.slice(0, 10);

    sidebar.classList.add('open');

    // Rewrite legacy ?t=birth or ?t=death URLs to ?t=person before any other
    // logic looks at the URL, so the address bar shows the canonical form.
    normalizeLegacyURL();

    // Infer active tab from the (now-normalized) URL.
    const urlParams = new URLSearchParams(window.location.search);
    const urlT = urlParams.get('t');
    let urlTab = 'general';
    if (urlT === 'contributors') urlTab = 'contributors';
    else if (urlT === 'person') urlTab = 'person';
    else if (urlT === 'family') urlTab = 'family';
    isInitializing = true;
    document.querySelector(`.tab-btn[data-target="tab-${urlTab}"]`)?.click();
    isInitializing = false;

    restoreFromURL();

    onLanguageChange(() => {
      renderIntros();
      refreshContributorsIfVisible();
    });
  } catch (err) {
    loading.style.display = 'block';
    loading.textContent = t('init_error');
    console.error(err);
  }
}

init();

// --- SPA navigation (shared by link clicks and popstate) ---
function navigateToURL(urlSearch) {
  // If the user followed a legacy ?t=birth / ?t=death link, rewrite it before doing anything.
  normalizeLegacyURL();
  const urlParams = new URLSearchParams(window.location.search);
  const urlT = urlParams.get('t') || 'general';
  const tabMap = { general: 'tab-general', person: 'tab-person', family: 'tab-family', contributors: 'tab-contributors' };
  const targetTab = tabMap[urlT] || 'tab-general';
  isInitializing = true;
  document.querySelector(`.tab-btn[data-target="${targetTab}"]`)?.click();
  isInitializing = false;
  clearAllSearchForms();
  restoreFromURL();
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-spa-nav]');
  if (!link) return;
  // Let browser handle Ctrl/Cmd/middle-click natively (opens new tab)
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  const url = new URL(link.href, window.location.href);
  const newUrlStr = url.pathname + (url.searchParams.toString() ? '?' + toUnicodeSearch(url.searchParams) : '');
  history.pushState(null, '', newUrlStr);
  navigateToURL(url.search);
});

window.addEventListener('popstate', () => {
  navigateToURL(window.location.search);
});
