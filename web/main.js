import { t, initI18n, onLanguageChange } from './i18n.js';
import { renderContributors, refreshContributorsIfVisible } from './contributors.js';
import { setupGeneralSearch, setupAdvancedSearchForm } from './search.js';

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

// --- Hamburger ---

const hamburgerBtn = document.querySelector('.hamburger-btn');
const sidebar = document.getElementById('sidebar');

hamburgerBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

// --- Tab Management ---

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.target;

    if (targetTab === 'tab-contributors') {
      document.body.classList.add('contributors-view');
      renderContributors();
    } else {
      document.body.classList.remove('contributors-view');
    }

    document.getElementById('general-results').style.display = 'none';
    document.getElementById('advanced-results').style.display = 'none';

    // Close sidebar on mobile when a tab is selected
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));

    if (targetTab === 'tab-general') {
      document.getElementById('general-search-sidebar').classList.add('active');
    } else if (targetTab === 'tab-advanced') {
      document.getElementById('advanced-search-sidebar').classList.add('active');
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

    setupClearableInput(document.getElementById('general-query'), () => {
      document.getElementById('btn-general-search').click();
    });

    setupGeneralSearch();
    setupAdvancedSearchForm();

    sidebar.classList.add('open');
    document.querySelector('.tab-btn[data-target="tab-general"]').click();

    // Refresh contributors table column headers on language change
    onLanguageChange(() => refreshContributorsIfVisible());
  } catch (err) {
    loading.style.display = 'block';
    loading.textContent = t('init_error');
    console.error(err);
  }
}

init();
