import { t, onLanguageChange } from './i18n.js';
import { currentParams, toUnicodeSearch } from './lib/url.js';
import { renderGuideManual } from './lib/guide-content.js';
import siteConfig from '@site-config';

const hasAuth = !!siteConfig.authUrl;

export function initHelp() {
  const navRight = document.querySelector('.srd-nav-right');
  if (!navRight) return;

  // 1. Inject Help Button. A real <a href="/guide"> (rather than a <button>)
  // so the user guide has a crawlable, shareable URL even though in-app
  // clicks are intercepted below to open the modal instead.
  const helpBtn = document.createElement('a');
  helpBtn.id = 'help-toggle-btn';
  helpBtn.className = 'srd-icon-btn';
  helpBtn.href = '/guide';
  helpBtn.style.display = 'inline-flex';
  helpBtn.title = t('help');
  helpBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  // Keep the URL in sync with the modal's open state so the address bar can
  // be copied/shared at any time and `?help=1` deep-links work both ways.
  // Opening pushes a history entry (rather than replacing) so browser Back
  // has something to land on — see the popstate listener below, which is
  // what actually closes the modal when that entry is popped.
  const HISTORY_MARK = 'guideModal';

  const pushHelpParam = () => {
    const params = currentParams();
    if (params.get('help') === '1') return;
    params.set('help', '1');
    const search = toUnicodeSearch(params);
    history.pushState({ [HISTORY_MARK]: true }, '', window.location.pathname + (search ? '?' + search : ''));
  };

  const dropHelpParam = () => {
    const params = currentParams();
    if (!params.has('help')) return;
    // If we're the entry that pushed `?help=1`, Back lands cleanly on
    // whatever preceded it. Otherwise (e.g. someone loaded `/?help=1`
    // directly, so there's no "before" entry of ours to pop) just strip the
    // param in place.
    if (history.state?.[HISTORY_MARK]) {
      history.back();
    } else {
      params.delete('help');
      const search = toUnicodeSearch(params);
      history.replaceState(null, '', window.location.pathname + (search ? '?' + search : ''));
    }
  };

  const openHelp = ({ fromPopstate = false } = {}) => {
    const modal = document.getElementById('help-modal');
    modal.classList.add('open');
    const scrollArea = modal.querySelector('#help-scroll');
    if (scrollArea) scrollArea.scrollTop = 0;
    if (!fromPopstate) pushHelpParam();
  };

  const closeHelp = ({ fromPopstate = false } = {}) => {
    const modal = document.getElementById('help-modal');
    modal.classList.remove('open');
    if (!fromPopstate) dropHelpParam();
  };

  // Back/Forward through a `?help=1` entry we (or a shared link) created:
  // sync the modal to match instead of leaving it stuck open/closed while
  // the address bar moves on without it.
  window.addEventListener('popstate', () => {
    const isOpen = document.getElementById('help-modal')?.classList.contains('open');
    const wantOpen = currentParams().has('help');
    if (wantOpen && !isOpen) openHelp({ fromPopstate: true });
    else if (!wantOpen && isOpen) closeHelp({ fromPopstate: true });
  });

  // Intercept plain clicks to open the in-app modal instead of navigating to
  // /guide; ctrl/cmd/middle-click and the footer's identical link still fall
  // through to the real page (new tab, no-JS, crawlers).
  const interceptToOpenHelp = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openHelp();
  };
  helpBtn.addEventListener('click', interceptToOpenHelp);
  document.getElementById('footer-guide-link')?.addEventListener('click', interceptToOpenHelp);

  // Navbar order: help, auth, lang, hamburger. We anchor on the leftmost of
  // the elements that come after us so help lands at the start of the cluster
  // regardless of which neighbours exist (auth is only present on sites with
  // authUrl configured).
  const authWrapper = navRight.querySelector('.auth-nav-wrapper');
  const langSwitcher = document.getElementById('lang-switcher');
  const hamburger = navRight.querySelector('.hamburger-btn');
  const anchor = authWrapper || langSwitcher || hamburger;
  if (anchor) {
    navRight.insertBefore(helpBtn, anchor);
  } else {
    navRight.prepend(helpBtn);
  }

  // 2. Inject Help Modal
  const modalHtml = `
    <div id="help-modal" class="srd-modal-overlay">
      <div class="srd-modal" style="max-width: 800px; width: 90%; max-height: 90vh; padding: 0; text-align: left;">
        <button type="button" class="srd-modal-close" aria-label="Close" style="position: absolute; top: 16px; right: 16px; background: var(--srd-surface); z-index: 10; border: 1px solid var(--srd-line-strong); border-radius: var(--srd-radius); box-shadow: var(--srd-shadow-1); padding: 2px 12px; line-height: 1;">&times;</button>
        <div id="help-scroll" style="max-height: 90vh; overflow-y: auto; padding: 24px;">
          <div id="help-content" class="help-content intro-text"></div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('help-modal');
  const closeBtn = modal.querySelector('.srd-modal-close');
  closeBtn.addEventListener('click', closeHelp);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeHelp(); });

  // 3. Update localized content
  const strings = {
    help_manual: '', help_auth_nav: '', help_auth_tree: '', help_auth_match: '', help_auth_section: '',
    help_source_type_item: '', help_matricula_cols: '', help_matricula_mark: '',
  };
  const updateHelpContent = () => {
    for (const key of Object.keys(strings)) strings[key] = t(key) || '';
    document.getElementById('help-content').innerHTML = renderGuideManual(strings, hasAuth, siteConfig);
  };

  updateHelpContent();
  onLanguageChange(() => {
    updateHelpContent();
    helpBtn.title = t('help');
  });

  // `?help=1` (or just `?help`) auto-opens the user guide on page load.
  // `fromPopstate: true` here too: this is the initial render, not a user
  // action, so it must not push a history entry of its own.
  if (currentParams().has('help')) openHelp({ fromPopstate: true });
}