import { t, onLanguageChange, getCurrentLang } from './i18n.js';

// The User Guide and the Changelog are standalone pages, not in-app popups:
// they open in a new tab so whatever the reader was doing — a search, a tree,
// a comparison — is still there when they come back. Both are real pages with
// shareable URLs; this module only injects the navbar's "?" link and keeps the
// three links pointing at the reader's current language.

const PAGE_LINKS = [
  ['help-toggle-btn', '/guide'],
  ['footer-guide-link', '/guide'],
  ['footer-changelog-link', '/changelog'],
];

/** The pages are built in the site's default language and switch themselves
 *  over client-side; passing ?lang= means a reader always lands in the
 *  language they were just reading, without a flash of the default one. */
function syncLinkLanguage() {
  const lang = getCurrentLang();
  for (const [id, path] of PAGE_LINKS) {
    const el = document.getElementById(id);
    if (el) el.href = `${path}?lang=${encodeURIComponent(lang)}`;
  }
}

export function initHelp() {
  const navRight = document.querySelector('.srd-nav-right');
  if (!navRight) return;

  // Help button: a real <a> to the guide, opened in a new tab.
  const helpBtn = document.createElement('a');
  helpBtn.id = 'help-toggle-btn';
  helpBtn.className = 'srd-icon-btn';
  helpBtn.href = '/guide';
  helpBtn.target = '_blank';
  helpBtn.rel = 'noopener';
  helpBtn.style.display = 'inline-flex';
  helpBtn.title = t('help');
  helpBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  // Navbar order: help, auth, lang, hamburger. We anchor on the leftmost of
  // the elements that come after us so help lands at the start of the cluster
  // regardless of which neighbours exist (auth is only present on sites with
  // authUrl configured). The lang switcher lookup must be scoped to navRight:
  // in compact-utils mode (phones) it has already been moved into the sidebar
  // slot, and insertBefore with an anchor outside navRight throws.
  const authWrapper = navRight.querySelector('.auth-nav-wrapper');
  const langSwitcher = navRight.querySelector('#lang-switcher');
  const hamburger = navRight.querySelector('.hamburger-btn');
  const anchor = authWrapper || langSwitcher || hamburger;
  if (anchor) {
    navRight.insertBefore(helpBtn, anchor);
  } else {
    navRight.prepend(helpBtn);
  }

  syncLinkLanguage();
  onLanguageChange(() => {
    helpBtn.title = t('help');
    syncLinkLanguage();
  });

  // `?help=1` used to open the guide in a popup over the app. Those links are
  // still out there, so send them to the page the guide now lives on.
  const params = new URLSearchParams(window.location.search);
  if (params.has('help')) {
    params.delete('help');
    history.replaceState(null, '', window.location.pathname + (params.toString() ? `?${params}` : ''));
    window.open(`/guide?lang=${encodeURIComponent(getCurrentLang())}`, '_blank', 'noopener');
  }
}
