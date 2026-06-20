import { onLanguageChange } from './i18n.js';

// Responsive navbar + hamburger/sidebar behavior.
//
// Navbar overflow handling has two stages:
//   compact-nav   → primary nav tabs move into the sidebar
//   compact-utils → help / language / login icons also move into the sidebar
// `compact-utils` only kicks in when the navbar still doesn't fit after the
// tabs have already collapsed — so on a phone with a short site title the
// utility icons stay visible in the navbar, and only on really tight layouts
// (long title or many tabs) do they move out of the way.

const hamburgerBtn = document.querySelector('.hamburger-btn');
const sidebar = document.getElementById('sidebar');
const appHeader = document.querySelector('header');
const navbarEl = document.querySelector('.srd-navbar');

export function updateSidebarTop() {
  const h = appHeader.offsetHeight;
  document.documentElement.style.setProperty('--nav-height', `${h}px`);
}

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

export function checkNavOverflow() {
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

/** Wires up sidebar-top tracking, navbar overflow handling, and the hamburger /
 *  click-outside sidebar toggles. Call once at startup. */
export function initNavbar() {
  updateSidebarTop();
  window.addEventListener('resize', updateSidebarTop);

  checkNavOverflow();
  window.addEventListener('resize', checkNavOverflow);
  if (window.ResizeObserver && navbarEl) {
    new ResizeObserver(checkNavOverflow).observe(navbarEl);
  }
  onLanguageChange(checkNavOverflow);

  hamburgerBtn.addEventListener('click', () => {
    // Tree pages, every contributors-tab view (list / single contributor /
    // matches detail), and the Matricula/Geneanet stats pages have no use for
    // the sidebar's search controls — their text filters all live inline in
    // each table's header instead. The sidebar is normally a no-op there, but
    // in compact-nav mode it also hosts the nav tabs and/or help / language /
    // login utilities collapsed out of the navbar, so we still want it reachable.
    const isTreePage = document.getElementById('tab-ancestors').classList.contains('active') ||
                       document.getElementById('tab-descendants').classList.contains('active');
    const isContributorsPage = document.getElementById('tab-contributors').classList.contains('active') ||
                       document.getElementById('tab-matricula')?.classList.contains('active') ||
                       document.getElementById('tab-geneanet')?.classList.contains('active');
    if ((isTreePage || isContributorsPage) && !document.body.classList.contains('compact-nav')) {
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
    // Click-outside auto-close on desktop. Don't close when the click lands on
    // any navbar control — the help / login / language icons open modals or
    // popovers that shouldn't disturb the search sidebar behind them.
    if (window.innerWidth > 768
        && sidebar.classList.contains('open')
        && !sidebar.contains(e.target)
        && !hamburgerBtn.contains(e.target)
        && !navbarEl?.contains(e.target)) {
      sidebar.classList.remove('open');
    }
  });
}
