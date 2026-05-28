import { t, onLanguageChange } from './i18n.js';
import { currentParams, toUnicodeSearch } from './url.js';
import siteConfig from '@site-config';

const hasAuth = !!siteConfig.authUrl;
const USER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

export function initHelp() {
  const navRight = document.querySelector('.srd-nav-right');
  if (!navRight) return;

  // 1. Inject Help Button
  const helpBtn = document.createElement('button');
  helpBtn.id = 'help-toggle-btn';
  helpBtn.className = 'srd-icon-btn';
  helpBtn.style.display = 'inline-flex';
  helpBtn.title = t('help');
  helpBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;

  // Keep the URL in sync with the modal's open state so the address bar can
  // be copied/shared at any time and `?help=1` deep-links work both ways.
  const setHelpParam = (open) => {
    const params = currentParams();
    if (open) {
      if (params.get('help') === '1') return;
      params.set('help', '1');
    } else {
      if (!params.has('help')) return;
      params.delete('help');
    }
    const search = toUnicodeSearch(params);
    history.replaceState(null, '', window.location.pathname + (search ? '?' + search : ''));
  };

  const openHelp = () => {
    const modal = document.getElementById('help-modal');
    modal.classList.add('open');
    const innerModal = modal.querySelector('.srd-modal');
    if (innerModal) innerModal.scrollTop = 0;
    setHelpParam(true);
  };

  const closeHelp = () => {
    const modal = document.getElementById('help-modal');
    modal.classList.remove('open');
    setHelpParam(false);
  };

  helpBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openHelp();
  });

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
      <div class="srd-modal" style="max-width: 800px; width: 90%; max-height: 90vh; overflow-y: auto; text-align: left;">
        <button type="button" class="srd-modal-close" aria-label="Close" style="position: sticky; top: 0; float: right; background: var(--surface-color, var(--bg-color, #ffffff)); z-index: 10; border-radius: 50%; box-shadow: 0 2px 5px rgba(0,0,0,0.2); margin-left: 15px; margin-bottom: 5px;">&times;</button>
        <div id="help-content" class="help-content intro-text"></div>
      </div>
    </div>
    <style>
      .help-content { padding-top: 5px; }
      .help-content p, .help-content ul, .help-content li { font-size: 1rem; line-height: 1.7; color: var(--srd-ink-muted); }
      .help-content p, .help-content ul { margin-bottom: 1.2rem; }
      .help-content li { margin-bottom: 0.4rem; }
      .help-content h2 { margin-top: 0; margin-bottom: 1.2rem; font-size: 1.6rem; font-family: var(--srd-font-serif); font-weight: 500; color: var(--srd-brand); }
      .help-content h3 { margin-top: 2rem; margin-bottom: 1rem; padding-bottom: 6px; font-size: 1.3rem; font-family: var(--srd-font-serif); font-weight: 500; color: var(--srd-ink); border-bottom: 1px solid var(--srd-line); }
      .help-content h4 { margin-top: 1.5rem; margin-bottom: 0.5rem; font-size: 1.05rem; font-weight: 600; color: var(--srd-ink); }
      .help-content strong { color: var(--srd-ink); font-weight: 600; }
    </style>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modal = document.getElementById('help-modal');
  const closeBtn = modal.querySelector('.srd-modal-close');
  closeBtn.addEventListener('click', closeHelp);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeHelp(); });

  // 3. Update localized content
  const updateHelpContent = () => {
    const authNav = hasAuth ? t('help_auth_nav') : '';
    const authTree = hasAuth ? t('help_auth_tree') : '';
    const authMatch = hasAuth ? t('help_auth_match') : '';
    const authSection = hasAuth ? (t('help_auth_section') || '').replace('{USER_ICON}', USER_ICON) : '';

    let content = t('help_manual') || '';
    document.getElementById('help-content').innerHTML = content
      .replace('{auth_nav}', authNav)
      .replace('{auth_tree}', authTree)
      .replace('{auth_match}', authMatch)
      .replace('{auth_section}', authSection);
  };

  updateHelpContent();
  onLanguageChange(() => {
    updateHelpContent();
    helpBtn.title = t('help');
  });

  // `?help=1` (or just `?help`) auto-opens the user guide on page load. The
  // param stays in the URL while the modal is open and is cleared by closeHelp
  // when the user dismisses it — so the URL always mirrors the modal state.
  if (currentParams().has('help')) openHelp();
}