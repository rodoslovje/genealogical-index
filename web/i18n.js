const translations = {
  en: {
    // Site title
    site_title: 'Slovenian Genealogical Index',

    // Navigation tabs
    tab_search: 'Search',
    tab_birth: 'Birth',
    tab_family: 'Family',
    tab_death: 'Death',
    tab_contributors: 'Contributors',

    // Search controls
    search_placeholder: 'Search all fields (e.g., name, place, date)...',
    search_btn: 'Search',
    exact_search: 'Exact',
    has_link: 'With link',
    date_to: 'to Year',
    download_csv: 'Download CSV',
    general_search_label: 'General',
    chart_others: 'Others',
    chart_timeline: 'Records Timeline',

    // Result section headings
    results_births: 'Birth',
    results_families: 'Family',
    results_deaths: 'Death',

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
    col_date: 'Date',
    col_place: 'Place',
    col_date_of_birth: 'Date of Birth',
    col_place_of_birth: 'Place of Birth',
    col_contributor: 'Contributor',
    col_date_of_death: 'Date of Death',
    col_place_of_death: 'Place of Death',
    col_husband_name: 'Husband Name',
    col_husband_surname: 'Husband Surname',
    col_wife_name: 'Wife Name',
    col_wife_surname: 'Wife Surname',
    col_parents: 'Parents',
    label_husband: 'Husband',
    label_wife: 'Wife',
    col_children: 'Children',
    col_date_of_marriage: 'Date of Marriage',
    col_place_of_marriage: 'Place of Marriage',
    col_contributor_ID: 'Contributor',
    col_total_births: 'Birth',
    col_total_families: 'Family',
    col_total_deaths: 'Death',
    col_total: 'Total',
    col_last_modified: 'Last Change',
    col_last_update: 'Last update',
    col_link: 'Link',
    col_total_links: 'Links',
    col_url: 'URL',

    // Tooltips
    icon_grave: 'Grave',
    icon_census: 'Census',
    icon_military: 'Casualty of the war',
    icon_matricula: 'Matricula Online',

    // Society name (used in intro logo)
    society_name: 'Slovenian Genealogy Society',

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
    tab_death: 'Smrt',
    tab_contributors: 'Dajalci',

    // Search controls
    search_placeholder: 'Išči po vseh poljih (npr. ime, kraj, datum)...',
    search_btn: 'Išči',
    exact_search: 'Točno',
    has_link: 'S povezavo',
    date_to: 'do leta',
    download_csv: 'Prenesi CSV',
    general_search_label: 'Splošno',
    chart_others: 'Ostali',
    chart_timeline: 'Časovnica zapisov',

    // Result section headings
    results_births: 'Rojstvo',
    results_families: 'Družina',
    results_deaths: 'Smrt',

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
    col_date: 'Datum',
    col_place: 'Kraj',
    col_date_of_birth: 'Datum rojstva',
    col_place_of_birth: 'Kraj rojstva',
    col_contributor: 'Dajalec',
    col_date_of_death: 'Datum smrti',
    col_place_of_death: 'Kraj smrti',
    col_husband_name: 'Ime moža',
    col_husband_surname: 'Priimek moža',
    col_wife_name: 'Ime žene',
    col_wife_surname: 'Priimek žene',
    col_parents: 'Starši',
    label_husband: 'Mož',
    label_wife: 'Žena',
    col_children: 'Otroci',
    col_date_of_marriage: 'Datum poroke',
    col_place_of_marriage: 'Kraj poroke',
    col_contributor_ID: 'Dajalec',
    col_total_births: 'Rojstvo',
    col_total_families: 'Družina',
    col_total_deaths: 'Smrt',
    col_total: 'Skupaj',
    col_last_modified: 'Zadnja sprememba',
    col_last_update: 'Zadnja posodobitev',
    col_link: 'Povezava',
    col_total_links: 'Povezave',
    col_url: 'URL',

    // Tooltips
    icon_grave: 'Grob',
    icon_census: 'Popis prebivalstva',
    icon_military: 'Žrtev vojne',
    icon_matricula: 'Matricula Online',

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
    { text: '<strong>The Slovenian Genealogical Index</strong> is an archival collection of data on births, marriages and deaths in Slovenia, which has been created from the collections of individual genealogists since the very beginning of the society\'s activities. In it, we can search for the names and surnames of the people we are researching to find out if someone else has already discovered and described them. The basic index contains, in addition to personal names, the dates and places of birth, marriage and death, as well as the surname of the data provider, which allows the researcher to make further contact, indicates the direction and often makes it possible to research in an indirectly discovered parish. The contact information of the donors is not published, but it will not be difficult to get to them through the <a href="https://rodoslovje.si" target="_blank" rel="noopener">Slovenian Genealogy Society</a>.' },
    { text: 'The main <strong>Search</strong> tab returns query results from all parts of the collection: births, marriages, and deaths of historical figures in Slovenia. The search engine allows for exact or approximate searches across all fields, as well as searching only for records with a link to the source documents (on <a href="https://data.matricula-online.eu/en/slovenia/" target="_blank" rel="noopener">Matricula Online</a>).' },
    { text: 'The additional <strong>Birth</strong>, <strong>Family</strong>, and <strong>Death</strong> tabs allow searching by specific record types. Again, all fields are available: name, surname, date and place of the event, and the surname of the genealogist-provider of these data.' },
    { text: 'The family index also includes parents who were never married or even never lived together, which can be valuable information for descendants or information seekers. For each family, you can also see the number of children. Hidden behind the number is a list of the children\'s names with their year of birth (where this data is available).' },
    { text: 'The query results can be sorted by any column. For a full view, the query window can be hidden. It is possible to export the results in the form of a CSV file. For foreign users of the index, the site is also available in English.' },
    { text: 'The list of surnames, names, dates and places of birth, marriage and death is made from a merged file to which many genealogists, listed on the <a href="?t=contributors">Contributors</a> page, have contributed the results of their work.' },
    { text: 'Warning! The Slovenian Genealogical Index is for informational purposes only. The Slovenian Genealogy Society disclaims any responsibility for the accuracy of the submitted data. The society is a voluntary association of individuals who are developing a common source of knowledge of data from registers and other written and oral sources. The structure of the society allows anyone who has their own collection of genealogical data to contribute it to the common cumulative collection and index. No individual who has contributed data to the index, nor the Slovenian Genealogy Society, can guarantee the accuracy of the data.', warning: true },
    { text: 'If you have your own family tree in the form of a database and would like to join the existing contributors with the results of your work, please send your GEDCOM file (excluding data on living persons) by <a href="mailto:martin.mali@siol.net">email</a> to the administrator.' },
  ],
  sl: [
    { text: '<strong>Slovenski rodoslovni indeks</strong> je arhivska zbirka podatkov o rojenih, poročenih in umrlih na Slovenskem, ki nastaja iz zbirk posameznih rodoslovcev že od samega pričetka delovanja društva. V njej lahko poiščemo imena in priimke oseb, ki jih raziskujemo, da bi ugotovili, če jih je morda odkril in popisal že kdo drug. Osnovni indeks vsebuje poleg osebnih imen, datume in kraje rojstev, porok in smrti ter priimek dajalca podatka, kar iskalcu omogoči nadaljnji stik, nakaže smer in marsikdaj sploh omogoči raziskovanje v posredno odkriti župniji. Kontaktni podatki dajalcev sicer niso objavljeni, vendar do njih ne bo težko priti preko <a href="https://rodoslovje.si" target="_blank" rel="noopener">Slovenskega rodoslovnega društva</a>.' },
    { text: 'Osnovni zavihek <strong>Iskanje</strong> vrne rezultate poizvedbe po vseh delih zbirke: rojenih, poročenih in umrlih zgodovinskih oseb na Slovenskem. Iskalnik omogoča točno ali približno iskanje po vseh poljih, pa tudi iskanje samo zapisov s povezavo do izvornih dokumentov (na <a href="https://data.matricula-online.eu/sl/slovenia/" target="_blank" rel="noopener">Matricula Online</a>).' },
    { text: 'Dodatni zavihki <strong>Rojstvo</strong>, <strong>Družina</strong> in <strong>Smrt</strong> omogočajo iskanje po posameznem tipu zapisov. Ponovno so na voljo vsa polja: ime, priimek, datum in kraj dogodka ter priimek rodoslovca-dajalca teh podatkov.' },
    { text: 'Indeks družin vsebuje tudi starše, ki niso bili nikoli poročeni ali celo nikoli niso živeli skupaj, kar je lahko dragocen podatek za potomce oziroma iskalce informacij. Pri vsaki družini pa vidite tudi število otrok. Za številko pa je skrit seznam imen otrok z letnico rojstva (kjer ta podatek obstaja).' },
    { text: 'Rezultate poizvedbe lahko razvrstite po poljubnem stolpcu. Za polno pregledovanje je mogoče skriti poizvedbeno okno. Možen je izvoz rezultatov v obliki CSV datoteke. Za tuje uporabnike indeksa pa je stran na voljo tudi v angleščini.' },
    { text: 'Spisek priimkov, imen, datumov in krajev rojstva, porok in smrti je narejen iz združene datoteke, v katero so rezultate svojega dela posredovali številni rodoslovci, ki so navedeni na strani <a href="?t=contributors">Dajalci</a>.' },
    { text: 'Opozorilo! Slovenski rodoslovni indeks je informativnega značaja. Slovensko rodoslovno društvo se odreka vsakršne odgovornosti za pravilnost posredovanih podatkov. Društvo je prostovoljna povezava posameznikov, ki razvijajo skupen vir poznavanja podatkov iz matičnih registrov in drugih pisnih in ustnih virov. Struktura društva omogoča, da lahko vsak, ki ima svojo zbirko rodoslovnih podatkov, to prispeva v skupno kumulativno zbirko in indeks. Za pravilnost podatkov ne more jamčiti noben posameznik, ki je prispeval podatke v indeks, kot tudi ne Slovensko rodoslovno društvo.', warning: true },
    { text: 'Če imate svoj rodovnik v obliki zbirke podatkov in bi se dosedanjim sodelavcem želeli pridružiti z rezultati svojega dela, svojo GEDCOM datoteko (brez podatkov o še živečih osebah) po <a href="mailto:martin.mali@siol.net">e-pošti</a> pošljite administratorju.' },
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
