const translations = {
  en: {
    // Site title
    site_title: 'Slovenian Genealogical Index',

    // Navigation tabs
    tab_search: 'Search',
    tab_birth: 'Birth',
    tab_family: 'Family',
    tab_contributors: 'Contributors',

    // Search controls
    search_placeholder: 'Search all fields (e.g., name, place, date)...',
    search_btn: 'Search',
    exact_search: 'Exact',

    // Result section headings
    results_births: 'Birth',
    results_families: 'Family',

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

    // Society name (used in intro logo)
    society_name: 'Slovenian Genealogical Society',

    // Footer
    footer_version: 'Version',
    footer_data_update: 'Data update',
  },
  sl: {
    // Site title
    site_title: 'Slovenski rodoslovni indeks',

    // Navigation tabs
    tab_search: 'Iskanje',
    tab_birth: 'Rojstvo',
    tab_family: 'Družina',
    tab_contributors: 'Dajalci',

    // Search controls
    search_placeholder: 'Išči po vseh poljih (npr. ime, kraj, datum)...',
    search_btn: 'Išči',
    exact_search: 'Točno',

    // Result section headings
    results_births: 'Rojstvo',
    results_families: 'Družina',

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
    col_contributor: 'Dajalec',
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

    // Society name (used in intro logo)
    society_name: 'Slovensko rodoslovno društvo',

    // Footer
    footer_version: 'Različica',
    footer_data_update: 'Posodobitev podatkov',
  },
};

// Intro paragraphs shown on empty Search and Advanced Search tabs.
// { text: string (may contain HTML), warning?: true }
const introData = {
  en: [
    { text: 'The <strong>Slovenian Genealogical Index</strong> of surnames, given names, dates and places of birth and marriages is intended for genealogists who wish to determine whether persons appearing in their family trees have already been recorded in another genealogical register. For this purpose there are many more extensive databases maintained by our western colleagues. Searchers from Slovenia will not find many points of connection in foreign databases for the time being — but it is still worth trying.' },
    { text: 'The probability of overlap with data contributed for comparative purposes by members of the <a href="https://rodoslovje.si" target="_blank" rel="noopener">Slovenian Genealogical Society</a> is considerably higher.' },
    { text: 'The list of surnames, given names, dates and places of birth is compiled from a merged file to which many genealogists, listed on the <a href="?t=contributors">Contributors</a> page, have contributed the results of their work.' },
    { text: '<strong>Family index</strong> also includes parents who were never married or who never even lived together.' },
    { text: 'Warning! No individual, nor the Slovenian Genealogical Society, can vouch for the accuracy of the data! It must be borne in mind that only documents issued by an authorised official have legal validity. The data collected here was entered by individuals based on their own knowledge or the knowledge of others who provided the data; it was gathered from publications, and primarily from private and public archives, civil and ecclesiastical records.', warning: true },
    { text: 'The broader aspects of genealogical work and the publication of genealogical research results have been discussed in the Slovenian Genealogical Society on several occasions, and our views on these aspects have been published in the journal <a href="https://rodoslovje.si/drevesa-revija/" target="_blank" rel="noopener">Drevesa</a>. The more important contributions are summarised in <a href="http://www2.arnes.si/%7Ekrsrd1/Drustveni_pogledi.htm" target="_blank" rel="noopener">Society Perspectives</a>.' },
    { text: 'If anyone else would like to join the existing contributors with the results of their work, they should bring their GEDCOM file to the society\'s computer or send it by <a href="mailto:martin.mali@siol.net">email</a> to the administrator.' },
  ],
  sl: [
    { text: '<strong>Slovenski rodoslovni indeks</strong> priimkov, imen, datumov in krajev rojstva in poroke je namenjen rodoslovcem, ki bi želeli ugotoviti, ali so osebe, ki se pojavljajo v njihovih rodovnikih, že vpisane v kakšni drugi rodoslovni evidenci. Za ta namen sicer obstojajo številne obsežnejše podatkovne zbirke, ki jih vzdržujejo naši zahodni kolegi. Iskalci iz Slovenije v tujih zbirkah zaenkrat ne bodo našli veliko stičnih točk. Poskusiti pa je vseeno vredno.' },
    { text: 'Precej večja pa je verjetnost prekrivanja s podatki, ki jih za primerjalni namen posredujejo v skupno zalogo rodoslovnih datotek člani <a href="https://rodoslovje.si" target="_blank" rel="noopener">Slovenskega rodoslovnega društva</a>.' },
    { text: 'Spisek priimkov, imen, datumov in krajev rojstva je narejen iz združene datoteke, v katero so rezultate svojega dela posredovali številni rodoslovci, ki so navedeni na strani <a href="?t=contributors">Dajalci</a>.' },
    { text: '<strong>Indeks družin</strong> vsebuje tudi starše, ki nikoli niso bili poročeni ali celo nikoli niso živeli skupaj.' },
    { text: 'Opozorilo! Za verodostojnost podatkov ne more jamčiti noben posameznik kot tudi ne Slovensko rodoslovno društvo! Zavedati se je treba, da imajo zakonsko veljavo samo dokumenti, ki jih izda za to pooblaščena uradna oseba. Tu zbrani podatki so nastali tako, da so jih vnašali posamezniki po lastnem poznavanju ali poznavanju drugih oseb, ki so jim posredovale podatke, nabirali so jih v objavah, predvsem pa v zasebnih in javnih arhivih, civilnih in cerkvenih.', warning: true },
    { text: 'Širše vidike rodoslovnega dela in objavljanja rezultatov rodoslovnih raziskav smo v Slovenskem rodoslovnem društvu večkrat obravnavali in poglede na te vidike objavljali v časopisu <a href="https://rodoslovje.si/drevesa-revija/" target="_blank" rel="noopener">Drevesa</a>. Pomembnejše prispevke povzemamo v <a href="http://www2.arnes.si/%7Ekrsrd1/Drustveni_pogledi.htm" target="_blank" rel="noopener">Društvenih pogledih</a>.' },
    { text: 'Če bi se dosedanjim sodelavcem želel še kdo pridružiti z rezultati svojega dela, naj svojo GEDCOM datoteko prinese na društveni računalnik ali jo po <a href="mailto:martin.mali@siol.net">e-pošti</a> pošlje administratorju.' },
  ],
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

/** Returns the intro paragraphs for the current language. */
export function getIntro() {
  return introData[currentLang] || introData.en;
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
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  // Update page title and nav title
  document.title = t('site_title');

  // Update lang toggle button
  const meta = LANG_META[currentLang];
  const flagEl = document.querySelector('#lang-toggle .lang-flag');
  const codeEl = document.querySelector('#lang-toggle .lang-code');
  if (flagEl) flagEl.textContent = meta.flag;
  if (codeEl) codeEl.textContent = meta.code;

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

  document.addEventListener('click', () => dropdown.classList.remove('open'));

  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      setLanguage(btn.dataset.lang);
      dropdown.classList.remove('open');
    });
  });
}
