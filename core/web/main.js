import { t, initI18n, onLanguageChange, getIntro } from './i18n.js';
import siteConfig from '@site-config';
import { BUILD_TIME } from './build-info.js';
import { initAuth, isLoggedIn, requireLogin } from './auth.js';
import { renderContributors, refreshContributorsIfVisible, renderTotalsBar, prefetchContributors, updateFooterDataDate } from './contributors.js';
import { initHelp } from './help.js';
import { setupGeneralSearch, setupPersonSearchForm, setupFamilySearchForm, restoreFromURL, clearAllSearchForms, getTabURLParams } from './search.js';
import { toUnicodeSearch, LEGACY_TAB_MAP, currentParams, getParam } from './url.js';
import { renderAncestorsPage, renderDescendantsPage } from './tree.js';

// --- Global Link Styles ---
// (Anchor color/underline is handled per-area in style.css — `.intro-text a`,
// `.link-cell a`, `.srd-nav-tabs a`, etc. — so no global `a` rule here.)
const globalStyles = document.createElement('style');
globalStyles.textContent = `
  .collapsible-header { cursor: pointer; user-select: none; position: relative; }
  .collapsible-header::before {
    content: '';
    display: inline-block;
    width: 0; height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 6px solid currentColor;
    margin-right: 8px;
    transform: rotate(90deg);
    transition: transform 0.2s ease-in-out;
    vertical-align: middle;
  }
  .collapsible-header.collapsed::before {
    transform: rotate(0deg);
  }
`;
document.head.appendChild(globalStyles);

const SEARCH_TABS = ['tab-general', 'tab-person', 'tab-family', 'tab-contributors'];

/** Rewrite legacy ?t=birth / ?t=death values to ?t=person via replaceState.
 *  Runs at app load and when SPA-navigating into a legacy URL so the address
 *  bar always shows the canonical tab.  Other params (n, sn, dob, pob, dod, pod…)
 *  already line up with the unified person form so nothing else needs renaming. */
function normalizeLegacyURL() {
  const params = currentParams();
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
    activateTab('tab-contributors');
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

// Navbar overflow handling has two stages:
//   compact-nav   → primary nav tabs move into the sidebar
//   compact-utils → help / language / login icons also move into the sidebar
// `compact-utils` only kicks in when the navbar still doesn't fit after the
// tabs have already collapsed — so on a phone with a short site title the
// utility icons stay visible in the navbar, and only on really tight layouts
// (long title or many tabs) do they move out of the way.
const navbarEl = document.querySelector('.srd-navbar');

// Re-parents help / login / lang between .srd-nav-right (desktop) and the
// .mobile-utils-section slot inside the sidebar header (compact-utils mode).
// Single source of truth per control — listeners and dropdowns stay attached.
function applyCompactNav() {
  const utilsSlot = document.querySelector('.mobile-utils-section');
  const navRight = document.querySelector('.srd-nav-right');
  if (!utilsSlot || !navRight) return;

  const collapseUtils = document.body.classList.contains('compact-utils');
  const helpBtn = document.getElementById('help-toggle-btn');
  const langSwitcher = document.getElementById('lang-switcher');
  const authWrapper = document.querySelector('.auth-nav-wrapper');
  const hamburger = navRight.querySelector('.hamburger-btn');

  if (collapseUtils) {
    // Sidebar slot order top-to-bottom: lang, auth, help — reversed from the
    // navbar so the rightmost-in-navbar (language) ends up on top once stacked
    // vertically, matching the mental model that the dropdown opens downward.
    if (langSwitcher && langSwitcher.parentElement !== utilsSlot) utilsSlot.appendChild(langSwitcher);
    if (authWrapper && authWrapper.parentElement !== utilsSlot) utilsSlot.appendChild(authWrapper);
    if (helpBtn && helpBtn.parentElement !== utilsSlot) utilsSlot.appendChild(helpBtn);
  } else {
    // Restore right-to-left: lang first (anchored on hamburger which never
    // moves), then auth (anchored on the now-restored lang), then help. This
    // guarantees the anchor is always already a child of navRight, so
    // insertBefore can't hit a NotFoundError when an anchor still happens
    // to live in the sidebar slot.
    if (langSwitcher && langSwitcher.parentElement !== navRight) {
      navRight.insertBefore(langSwitcher, hamburger);
    }
    if (authWrapper && authWrapper.parentElement !== navRight) {
      navRight.insertBefore(authWrapper, langSwitcher || hamburger);
    }
    if (helpBtn && helpBtn.parentElement !== navRight) {
      navRight.insertBefore(helpBtn, authWrapper || langSwitcher || hamburger);
    }
  }
}

function checkNavOverflow() {
  if (!navbarEl) return;

  // Reset to the "everything visible in the navbar" baseline before measuring.
  // Physically restore the icons too — without this the navbar's scrollWidth
  // would miss whichever icons were previously moved to the sidebar slot, so
  // the overflow detection (and the subsequent restore on a wider window)
  // would not behave symmetrically.
  document.body.classList.remove('compact-nav');
  document.body.classList.remove('compact-utils');
  applyCompactNav();

  if (window.innerWidth <= 480) {
    // Phones: the title gets the screen; everything else lives in the menu.
    // Driven by viewport, not overflow — even with a short title, the icons
    // should sit next to the tabs inside the sidebar at this size.
    document.body.classList.add('compact-nav');
    document.body.classList.add('compact-utils');
  } else if (navbarEl.scrollWidth > navbarEl.clientWidth + 1) {
    // Wider screens: tabs collapse first; icons follow only if there's still
    // not enough room for the title (which never shrinks — .srd-brand stays
    // flex-shrink: 0 at every size).
    document.body.classList.add('compact-nav');
    if (navbarEl.scrollWidth > navbarEl.clientWidth + 1) {
      document.body.classList.add('compact-utils');
    }
  }

  applyCompactNav();
  updateSidebarTop();
}
checkNavOverflow();
window.addEventListener('resize', checkNavOverflow);
if (window.ResizeObserver && navbarEl) {
  new ResizeObserver(checkNavOverflow).observe(navbarEl);
}
onLanguageChange(checkNavOverflow);

hamburgerBtn.addEventListener('click', (e) => {
  // Tree pages have no search controls. The sidebar is normally a no-op there,
  // but in compact-nav mode it also hosts the help / language / login utilities
  // collapsed out of the navbar, so we still want it reachable.
  const isTreePage = document.getElementById('tab-ancestors').classList.contains('active') ||
                     document.getElementById('tab-descendants').classList.contains('active');
  if (isTreePage && !document.body.classList.contains('compact-nav')) {
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
    // .tab-btn is now an <a href="?t=X"> — middle/ctrl/cmd-click should keep
    // the default behavior (open the deep-linked URL in a new tab); plain
    // clicks switch tabs in-place without a page reload.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    e.stopPropagation();
    activateTab(btn.dataset.target);
  });
});

export function activateTab(targetTab, { skipHistory = false } = {}) {
  // Intercept click if trying to open a premium tab without being logged in
  const isPremium = targetTab === 'tab-ancestors' || targetTab === 'tab-descendants';
  if (isPremium && !isLoggedIn()) {
    if (!isInitializing) {
      requireLogin('premium_gated_desc');
      return false; // Do not switch tab
    }
    targetTab = 'tab-general'; // Fallback to general if accessing via direct URL
  }

  const tabTypeMap = {
    'tab-general':      'general',
    'tab-person':       'person',
    'tab-family':       'family',
    'tab-contributors': 'contributors',
    'tab-ancestors':    'ancestors',
    'tab-descendants':  'descendants',
  };
  const urlT = tabTypeMap[targetTab];
  if (urlT && !isInitializing && !skipHistory) {
    const params = urlT === 'contributors' || urlT === 'ancestors' || urlT === 'descendants' ? { t: urlT } : getTabURLParams(urlT);
    const url = new URL(window.location);
    url.search = '';
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
    const newUrlStr = url.pathname + (url.searchParams.toString() ? '?' + toUnicodeSearch(url.searchParams) : '');
    const currentT = currentParams().get('t') || 'general';
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

  if (targetTab === 'tab-ancestors') {
    renderAncestorsPage();
  } else if (targetTab === 'tab-descendants') {
    renderDescendantsPage();
  } else if (targetTab !== 'tab-contributors') {
    document.title = t('site_title');
  }

  const resultsMap = {
    'tab-general': 'general-results',
    'tab-person':  'person-results',
    'tab-family':  'family-results',
    'tab-ancestors':'ancestors-results',
    'tab-descendants':'descendants-results',
  };
  ['tab-general', 'tab-person', 'tab-family', 'tab-ancestors', 'tab-descendants'].forEach(tab => {
    if (tab !== targetTab) document.getElementById(resultsMap[tab])?.style.setProperty('display', 'none');
  });
  const introMap = {
    'tab-general': 'intro-general',
    'tab-person':  'intro-person',
    'tab-family':  'intro-family',
    'tab-ancestors': null,
    'tab-descendants': null,
  };
  if (tabsWithResults.has(targetTab) || targetTab === 'tab-ancestors' || targetTab === 'tab-descendants') {
    const resEl = document.getElementById(resultsMap[targetTab]);
    if (resEl) resEl.style.display = 'block';
    if (introMap[targetTab]) hideIntro(introMap[targetTab]);
  } else {
    showIntros(introMap[targetTab]);
  }

  if (SEARCH_TABS.includes(targetTab)) {
    if (targetTab === 'tab-contributors' && window.innerWidth <= 768) {
      sidebar.classList.remove('open');
    } else {
      sidebar.classList.add('open');
    }
  } else {
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
  const tabEl = document.getElementById(targetTab);
  if (tabEl) tabEl.classList.add('active');

  return true;
}

// --- Init ---

async function init() {
  const loading = document.getElementById('loading');
  loading.style.display = 'none';

  try {
    // i18n boots first so the preferred locale is already loaded when the rest
    // of the UI starts calling t(). Without this, a Slovenian user would see a
    // brief English flash before the locale chunk arrived.
    await initI18n();

    initAuth();
    initHelp();

    // help-btn and auth-wrapper now exist; re-evaluate so they land in the
    // sidebar slot if we're already in compact-nav mode.
    checkNavOverflow();

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
    if (buildEl) buildEl.textContent = BUILD_TIME.slice(0, 10);
    // Data-update date is fetched from the API (latest contributor import on
    // the server), so an older deployed build still shows fresh data dates.
    updateFooterDataDate();

    sidebar.classList.add('open');

    // Rewrite legacy ?t=birth or ?t=death URLs to ?t=person before any other
    // logic looks at the URL, so the address bar shows the canonical form.
    normalizeLegacyURL();

    // Infer active tab from the (now-normalized) URL.
    const urlParams = currentParams();
    const urlT = urlParams.get('t');
    let urlTab = 'general';
    if (urlT === 'contributors') urlTab = 'contributors';
    else if (urlT === 'person') urlTab = 'person';
    else if (urlT === 'family') urlTab = 'family';
    else if (urlT === 'ancestors') urlTab = 'ancestors';
    else if (urlT === 'descendants') urlTab = 'descendants';
    isInitializing = true;
    activateTab(`tab-${urlTab}`);
    isInitializing = false;

    restoreFromURL();

    onLanguageChange(() => {
      renderIntros();
      refreshContributorsIfVisible();
      if (document.getElementById('tab-ancestors').classList.contains('active')) {
        renderAncestorsPage();
      }
      if (document.getElementById('tab-descendants').classList.contains('active')) {
        renderDescendantsPage();
      }
    });
  } catch (err) {
    loading.style.display = 'block';
    loading.textContent = t('init_error');
    console.error(err);
  }
}

init();

// Safety net: if i18n init never resolves (network error loading a locale,
// thrown exception, etc.) reveal the page anyway after 2s so the user isn't
// stuck looking at a blank screen.
setTimeout(() => document.documentElement.classList.remove('i18n-pending'), 2000);

// --- SPA navigation (shared by link clicks and popstate) ---
// `triggerSearch` false on browser Back/Forward — the results table for the
// returned-to URL is still in the DOM from when that search originally ran,
// so we skip the fetch and just switch tabs / refill the form.
function navigateToURL(urlSearch, { triggerSearch = true } = {}) {
  // If the user followed a legacy ?t=birth / ?t=death link, rewrite it before doing anything.
  normalizeLegacyURL();
  const urlParams = currentParams();
  const urlT = urlParams.get('t') || 'general';
  const tabMap = { general: 'tab-general', person: 'tab-person', family: 'tab-family', contributors: 'tab-contributors', ancestors: 'tab-ancestors', descendants: 'tab-descendants' };
  const targetTab = tabMap[urlT] || 'tab-general';

  if (!activateTab(targetTab, { skipHistory: true })) {
    return;
  }
  clearAllSearchForms();
  restoreFromURL({ triggerSearch });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-spa-nav]');
  if (!link) return;
  // Let browser handle Ctrl/Cmd/middle-click natively (opens new tab)
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  const href = typeof link.href === 'string' ? link.href : link.getAttribute('href');
  const url = new URL(href, window.location.href);

  const urlT = url.searchParams.get('t');
  const hasWith = url.searchParams.has('w') || url.searchParams.has('with');
  if ((urlT === 'ancestors' || urlT === 'descendants' || (urlT === 'contributors' && hasWith)) && !isLoggedIn()) {
    requireLogin('premium_gated_desc');
    return;
  }

  const newUrlStr = url.pathname + (url.searchParams.toString() ? '?' + toUnicodeSearch(url.searchParams) : '');
  history.pushState(null, '', newUrlStr);
  navigateToURL(url.search);
});

window.addEventListener('popstate', () => {
  navigateToURL(window.location.search, { triggerSearch: false });
});
