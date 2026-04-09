import { t, initI18n, onLanguageChange, getIntro } from './i18n.js';
import { BUILD_TIME, DATA_UPDATED } from './build-info.js';
import { renderContributors, refreshContributorsIfVisible, renderTotalsBar, prefetchContributors } from './contributors.js';
import { setupGeneralSearch, setupBirthSearchForm, setupFamilySearchForm, setupDeathSearchForm, restoreFromURL } from './search.js';
import { updateURL } from './url.js';

const SEARCH_TABS = ['tab-general', 'tab-birth', 'tab-family', 'tab-death'];

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
  const logo = `<a href="https://rodoslovje.si" target="_blank" rel="noopener" class="intro-logo-link">
    <img src="/srd-logo.png" alt="Slovensko rodoslovno društvo" class="intro-logo" />
    <span class="intro-logo-name">${t('society_name')}</span>
  </a>`;
  const html = paragraphs + logo;
  ['intro-general', 'intro-birth', 'intro-family', 'intro-death'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

export function hideIntro(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

export function showIntros() {
  ['intro-general', 'intro-birth', 'intro-family', 'intro-death'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
}

// Intercept intro links to contributors tab so they switch tabs without a page reload
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href="?t=contributors"]');
  if (link) {
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

hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.toggle('open'); });

document.addEventListener('click', (e) => {
  if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !hamburgerBtn.contains(e.target)) {
    sidebar.classList.remove('open');
  }
});

// --- Tab Management ---

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const targetTab = btn.dataset.target;

    if (targetTab === 'tab-contributors') {
      document.body.classList.add('contributors-view');
      updateURL({ t: 'contributors' });
      renderContributors();
      renderTotalsBar();
    } else {
      document.body.classList.remove('contributors-view');
    }

    document.getElementById('general-results').style.display = 'none';
    document.getElementById('birth-results').style.display = 'none';
    document.getElementById('family-results').style.display = 'none';
    document.getElementById('death-results').style.display = 'none';
    showIntros();

    // On desktop: open sidebar for search tabs, close for contributors
    // On mobile: hamburger controls the sidebar — never auto-change
    if (window.innerWidth > 768) {
      if (SEARCH_TABS.includes(targetTab)) {
        sidebar.classList.add('open');
      } else {
        sidebar.classList.remove('open');
      }
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));

    const sidebarSectionMap = {
      'tab-general': 'general-search-sidebar',
      'tab-birth':   'birth-search-sidebar',
      'tab-family':  'family-search-sidebar',
      'tab-death':   'death-search-sidebar',
    };
    const sidebarSection = sidebarSectionMap[targetTab];
    if (sidebarSection) document.getElementById(sidebarSection).classList.add('active');

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

    setupClearableInput(document.getElementById('general-query'), () => {
      document.getElementById('btn-general-search').click();
    });

    setupGeneralSearch();
    setupBirthSearchForm();
    setupFamilySearchForm();
    setupDeathSearchForm();
    renderIntros();
    prefetchContributors();

    const buildEl = document.getElementById('build-time');
    const dataEl = document.getElementById('data-updated');
    if (buildEl) buildEl.textContent = BUILD_TIME.slice(0, 10);
    if (dataEl) dataEl.textContent = DATA_UPDATED.slice(0, 10);

    if (window.innerWidth > 768) sidebar.classList.add('open');

    // Infer active tab from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const urlT = urlParams.get('t');
    let urlTab = 'general';
    if (urlT === 'contributors') urlTab = 'contributors';
    else if (urlT === 'birth') urlTab = 'birth';
    else if (urlT === 'family') urlTab = 'family';
    else if (urlT === 'death') urlTab = 'death';
    document.querySelector(`.tab-btn[data-target="tab-${urlTab}"]`)?.click();

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
