import { t } from './i18n.js';
import { toUnicodeSearch, LEGACY_TAB_MAP, currentParams } from './url.js';
import { isPremiumLocked, requireLogin } from './auth.js';
import { renderContributors, renderTotalsBar } from './contributors.js';
import { renderAncestorsPage, renderDescendantsPage } from './tree/index.js';
import { renderMatriculaStatsPage } from './contributors/matricula-stats.js';
import { getTabURLParams, restoreFromURL, clearAllSearchForms } from './search.js';
import { hideIntro, showIntros } from './intros.js';
import { tabsWithResults } from './tab-state.js';

const sidebar = document.getElementById('sidebar');

const SEARCH_TABS = ['tab-general', 'tab-person', 'tab-family', 'tab-contributors'];

// URL ?t= value → DOM tab id (and the inverse used when serializing).
const TAB_BY_TYPE = {
  general:      'tab-general',
  person:       'tab-person',
  family:       'tab-family',
  contributors: 'tab-contributors',
  ancestors:    'tab-ancestors',
  descendants:  'tab-descendants',
};
const TYPE_BY_TAB = Object.fromEntries(Object.entries(TAB_BY_TYPE).map(([type, tab]) => [tab, type]));

/** DOM tab id implied by the current URL's ?t= value (defaults to general). */
export function tabIdFromParams(params) {
  return TAB_BY_TYPE[params.get('t')] || 'tab-general';
}

/** Rewrite legacy ?t=birth / ?t=death values to ?t=person via replaceState.
 *  Runs at app load and when SPA-navigating into a legacy URL so the address
 *  bar always shows the canonical tab.  Other params (n, sn, dob, pob, dod, pod…)
 *  already line up with the unified person form so nothing else needs renaming. */
export function normalizeLegacyURL() {
  const params = currentParams();
  const tParam = params.get('t');
  const mapped = tParam && LEGACY_TAB_MAP[tParam];
  if (!mapped) return;
  params.set('t', mapped);
  const url = window.location.pathname + '?' + toUnicodeSearch(params);
  history.replaceState(null, '', url);
}

/** Side route: ?t=matricula renders the global Matricula stats page outside
 *  of the regular tab system (no nav entry, no sidebar search). Returns true
 *  when handled so the caller can skip the normal tab routing. */
export function maybeRouteMatricula(urlParams) {
  if (urlParams.get('t') !== 'matricula') return false;

  document.body.classList.remove('contributors-view', 'tree-view');

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));

  const sectionEl = document.getElementById('tab-matricula');
  if (sectionEl) sectionEl.classList.add('active');

  const sidebarSection = document.getElementById('matricula-search-sidebar');
  if (sidebarSection) {
    sidebarSection.classList.add('active');
    const input = document.getElementById('filter-matricula-books');
    if (input && window.innerWidth > 768) setTimeout(() => input.focus(), 0);
  }

  if (window.innerWidth <= 768) {
    sidebar?.classList.remove('open');
  } else {
    sidebar?.classList.add('open');
  }

  renderMatriculaStatsPage();
  return true;
}

/** Switch the active tab. `initial: true` (startup routing) suppresses the
 *  history write and lets a deep-linked premium tab fall back to general
 *  instead of prompting for login. */
export function activateTab(targetTab, { skipHistory = false, initial = false } = {}) {
  // Intercept if trying to open a premium tab without being logged in.
  const isPremium = targetTab === 'tab-ancestors' || targetTab === 'tab-descendants';
  if (isPremium && isPremiumLocked()) {
    if (!initial) {
      requireLogin('premium_gated_desc');
      return false; // Do not switch tab
    }
    // Direct URL into a premium tab while logged out: fall back to general, but
    // still surface the login prompt so the deep-link isn't silently dropped.
    requireLogin('premium_gated_desc');
    targetTab = 'tab-general';
  }

  const urlT = TYPE_BY_TAB[targetTab];
  if (urlT && !initial && !skipHistory) {
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

  const isTreeTab = targetTab === 'tab-ancestors' || targetTab === 'tab-descendants';
  document.body.classList.toggle('tree-view', isTreeTab);

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
    // Tree tabs let the CSS flex layout decide (`body.tree-view .results-container`);
    // other tabs need explicit display:block to override the initial inline display:none.
    if (resEl) resEl.style.display = isTreeTab ? '' : 'block';
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

// --- SPA navigation (shared by link clicks and popstate) ---
// `triggerSearch` false on browser Back/Forward — the results table for the
// returned-to URL is still in the DOM from when that search originally ran,
// so we skip the fetch and just switch tabs / refill the form.
function navigateToURL({ triggerSearch = true } = {}) {
  // If the user followed a legacy ?t=birth / ?t=death link, rewrite it before doing anything.
  normalizeLegacyURL();
  const urlParams = currentParams();
  if (maybeRouteMatricula(urlParams)) return;

  if (!activateTab(tabIdFromParams(urlParams), { skipHistory: true })) {
    return;
  }
  clearAllSearchForms();
  restoreFromURL({ triggerSearch });
}

/** Attach tab-button, intro-link, SPA-link and popstate handlers. Call once. */
export function initRouter() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // .tab-btn is an <a href="?t=X"> — middle/ctrl/cmd-click keeps the default
      // behavior (open the deep-linked URL in a new tab); plain clicks switch
      // tabs in-place without a page reload.
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      e.stopPropagation();
      activateTab(btn.dataset.target);
    });
  });

  // Intro links to the contributors tab switch tabs without a page reload.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href="?t=contributors"]');
    if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button !== 1) {
      e.preventDefault();
      activateTab('tab-contributors');
    }
  });

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
    if ((urlT === 'ancestors' || urlT === 'descendants' || (urlT === 'contributors' && hasWith)) && isPremiumLocked()) {
      requireLogin('premium_gated_desc');
      return;
    }

    const newUrlStr = url.pathname + (url.searchParams.toString() ? '?' + toUnicodeSearch(url.searchParams) : '');
    history.pushState(null, '', newUrlStr);
    navigateToURL();
  });

  window.addEventListener('popstate', () => {
    navigateToURL({ triggerSearch: false });
  });
}
