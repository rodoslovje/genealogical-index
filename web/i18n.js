const translations = {
  en: {
    // Navigation tabs
    tab_search: 'Search',
    tab_advanced: 'Advanced Search',
    tab_contributors: 'Contributors',

    // Search controls
    search_placeholder: 'Search all fields (e.g., name, place, date)...',
    search_btn: 'Search',
    adv_type_births: 'Birth',
    adv_type_families: 'Family',

    // Result section headings
    results_births: 'Birth',
    results_families: 'Family',
    results_title: 'Results',

    // Status messages
    loading: 'Loading genealogical data...',
    searching: 'Searching...',
    no_results: 'No results found.',
    enter_criterion: 'Please enter at least one search criterion.',
    search_failed: 'Search failed. Check API connection.',
    loading_contributors: 'Loading contributors...',
    contributors_failed: 'Could not load contributor data.',
    init_error: 'Error initializing the application.',

    // Table column headers
    col_name: 'Name',
    col_surname: 'Surname',
    col_date_of_birth: 'Date of Birth',
    col_place_of_birth: 'Place of Birth',
    col_contributor: 'Contributor',
    col_husband_name: 'Husband Name',
    col_husband_surname: 'Husband Surname',
    col_wife_name: 'Wife Name',
    col_wife_surname: 'Wife Surname',
    col_date_of_marriage: 'Date of Marriage',
    col_place_of_marriage: 'Place of Marriage',
    col_contributor_ID: 'Contributor',
    col_total_births: 'Birth',
    col_total_families: 'Family',
    col_total: 'Total',
    col_last_modified: 'Last Change',
  },
  sl: {
    // Navigation tabs
    tab_search: 'Iskanje',
    tab_advanced: 'Napredno iskanje',
    tab_contributors: 'Dajalci',

    // Search controls
    search_placeholder: 'Išči po vseh poljih (npr. ime, kraj, datum)...',
    search_btn: 'Išči',
    adv_type_births: 'Rojstvo',
    adv_type_families: 'Družina',

    // Result section headings
    results_births: 'Rojstvo',
    results_families: 'Družina',
    results_title: 'Rezultati',

    // Status messages
    loading: 'Nalaganje genealoških podatkov...',
    searching: 'Iskanje...',
    no_results: 'Ni rezultatov.',
    enter_criterion: 'Vnesite vsaj eno iskalno merilo.',
    search_failed: 'Iskanje ni uspelo. Preverite povezavo z API-jem.',
    loading_contributors: 'Nalaganje prispevkov...',
    contributors_failed: 'Podatkov o prispevkih ni mogoče naložiti.',
    init_error: 'Napaka pri inicializaciji aplikacije.',

    // Table column headers
    col_name: 'Ime',
    col_surname: 'Priimek',
    col_date_of_birth: 'Datum rojstva',
    col_place_of_birth: 'Kraj rojstva',
    col_contributor: 'Prispevek',
    col_husband_name: 'Ime moža',
    col_husband_surname: 'Priimek moža',
    col_wife_name: 'Ime žene',
    col_wife_surname: 'Priimek žene',
    col_date_of_marriage: 'Datum poroke',
    col_place_of_marriage: 'Kraj poroke',
    col_contributor_ID: 'Dajalec',
    col_total_births: 'Rojstvo',
    col_total_families: 'Družina',
    col_total: 'Skupaj',
    col_last_modified: 'Zadnja sprememba',
  },
};

const LANG_META = {
  en: { flag: '🇬🇧', code: 'EN' },
  sl: { flag: '🇸🇮', code: 'SL' },
};

function detectLanguage() {
  const saved = localStorage.getItem('sgi-lang');
  if (saved && translations[saved]) return saved;
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  return translations[browser] ? browser : 'en';
}

let currentLang = detectLanguage();
const changeListeners = [];

/** Returns the translation for a given key in the current language. */
export function t(key) {
  return (translations[currentLang]?.[key]) ?? (translations.en?.[key]) ?? key;
}

export function getCurrentLang() {
  return currentLang;
}

/** Register a callback to be called whenever the language changes. */
export function onLanguageChange(callback) {
  changeListeners.push(callback);
}

export function setLanguage(lang) {
  if (!translations[lang] || lang === currentLang) return;
  currentLang = lang;
  localStorage.setItem('sgi-lang', lang);
  applyStaticTranslations();
  changeListeners.forEach(fn => fn(lang));
}

function applyStaticTranslations() {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // Update all placeholder attributes
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Update lang toggle button to show current language
  const meta = LANG_META[currentLang];
  const flagEl = document.querySelector('#lang-toggle .lang-flag');
  const codeEl = document.querySelector('#lang-toggle .lang-code');
  if (flagEl) flagEl.textContent = meta.flag;
  if (codeEl) codeEl.textContent = meta.code;

  // Mark active option in dropdown
  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });

  document.documentElement.lang = currentLang;
}

/** Sets up the language switcher dropdown and applies initial translations. */
export function initI18n() {
  applyStaticTranslations();

  const toggle = document.getElementById('lang-toggle');
  const dropdown = document.getElementById('lang-dropdown');
  if (!toggle || !dropdown) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => dropdown.classList.remove('open'));

  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      setLanguage(btn.dataset.lang);
      dropdown.classList.remove('open');
    });
  });
}
