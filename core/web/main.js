import { t, initI18n, onLanguageChange } from './i18n.js';
import { BUILD_TIME } from './build-info.js';
import { initAuth } from './auth.js';
import { refreshContributorsIfVisible, prefetchContributors, updateFooterDataDate } from './contributors.js';
import { initHelp } from './help.js';
import { setupGeneralSearch, setupPersonSearchForm, setupFamilySearchForm, restoreFromURL } from './search.js';
import { currentParams } from './lib/url.js';
import { renderAncestorsPage, renderDescendantsPage } from './tree/index.js';
import { renderIntros } from './intros.js';
import { initNavbar, checkNavOverflow } from './navbar.js';
import { initRouter, activateTab, normalizeLegacyURL, maybeRouteMatricula, maybeRouteCompare, tabIdFromParams } from './router.js';
import { relocalizeCompare } from './tree/compare.js';
import { setupClearableInput } from './lib/utils.js';

// --- Global styles injected from JS ---
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

const sidebar = document.getElementById('sidebar');

// Navbar + routing event wiring (does not depend on i18n being ready).
initNavbar();
initRouter();

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

    setupClearableInput(document.getElementById('filter-matricula-books'), () => {
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
    if (maybeRouteMatricula(urlParams)) {
      return;
    }
    if (maybeRouteCompare(urlParams)) {
      return;
    }
    activateTab(tabIdFromParams(urlParams), { initial: true });

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
      if (document.getElementById('tab-compare')?.classList.contains('active')) {
        relocalizeCompare();
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
