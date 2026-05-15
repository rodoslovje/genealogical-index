import siteConfig from '@site-config';

// Generic UI translations — identical for every installation.
// Site-specific strings (site_title, society_name, intro paragraphs) live in site.config.js.
const translations = {
  en: {
    // Navigation tabs
    tab_search: 'Search',
    tab_person: 'Person',
    tab_family: 'Family',
    tab_contributors: 'Genealogists',

    // Search controls
    search_btn: 'Search',
    exact_search: 'Exact',
    approximate_search: 'Approximate',
    has_link: 'With link',
    filter_with: 'Matching with',
    date_to: 'to Year',
    download_csv: 'Download CSV',
    expand_all: 'Expand',
    collapse_all: 'Collapse',
    general_search_label: 'General',
    chart_others: 'Others',
    chart_timeline: 'Records Timeline',
    chart_surnames_title: 'Top Surnames by Genealogist',
    contributors_filter_placeholder: 'Filter by genealogist surname…',
    chart_surnames_all: 'All genealogists',
    chart_surnames_select: 'Select genealogist…',
    chart_surnames_loading: 'Loading…',
    section_surnames: 'Top Surnames',

    // Result section headings
    results_persons: 'Person',
    results_families: 'Family',
    chart_births: 'Births',
    chart_marriages: 'Marriages',
    chart_deaths: 'Deaths',

    // Status messages
    loading: 'Loading genealogical data...',
    searching: 'Searching...',
    no_results: 'No results found.',
    enter_criterion: 'Please enter at least one search criterion.',
    search_failed: 'Search failed. Check API connection.',
    loading_contributors: 'Loading genealogists...',
    contributors_failed: 'Could not load genealogist data.',
    init_error: 'Error initializing the application.',

    // Table column headers
    col_name: 'Name',
    col_surname: 'Surname',
    col_date: 'Date',
    col_place: 'Place',
    col_date_of_birth: 'Date of Birth',
    col_place_of_birth: 'Place of Birth',
    col_contributor: 'Genealogist',
    col_date_of_death: 'Date of Death',
    col_place_of_death: 'Place of Death',
    col_husband_name: 'Husband Name',
    col_husband_surname: 'Husband Surname',
    col_husband_birth: 'Husband Birth',
    col_wife_name: 'Wife Name',
    col_wife_surname: 'Wife Surname',
    col_wife_birth: 'Wife Birth',
    col_parents: 'Parents',
    col_partners: 'Partners',
    label_husband: 'Husband',
    label_wife: 'Wife',
    label_person: 'Person',
    label_birth: 'Birth',
    label_death: 'Death',
    label_marriage: 'Marriage',
    col_children: 'Children',
    col_date_of_marriage: 'Date of Marriage',
    col_place_of_marriage: 'Place of Marriage',
    col_contributor_ID: 'Genealogist',
    col_total_persons: 'Persons',
    col_total_families: 'Families',
    col_total: 'Total',
    col_last_modified: 'Last Change',
    col_last_update: 'Last update',
    col_links: 'Links',
    col_total_links: 'Links',
    col_url: 'URL',
    col_sum: 'Sum',
    col_tree: 'Tree',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'Genealogist who contributed this data to the index.',
    tip_contributor_ID: 'Genealogist who contributed this data to the index.',
    tip_contributor_ID_matches: 'Genealogist with potentially matching records.',
    tip_total_persons: 'Number of person records.',
    tip_total_families: 'Number of family records.',
    tip_total: 'Total number of persons and families.',
    tip_total_persons_matches: 'Number of matching person records.',
    tip_total_families_matches: 'Number of matching family records.',
    tip_total_matches: 'Total number of matching persons and families.',
    tip_confidence: 'Estimated likelihood that the records refer to the same person or family.',
    tip_matches: 'Number of other genealogists with potentially matching records.',
    tip_total_contributors: 'Total number of genealogists.',
    tip_last_update: 'Date of the most recent data import.',
    tip_total_links: 'Number of links to source documents (e.g. Matricula Online, Geneanet Cemeteries, FamilySearch.org…).',
    tip_last_modified: 'Date this genealogist\'s data was last imported into the index.',
    tip_links: 'Links to source documents (e.g. Matricula Online, Geneanet Cemeteries, FamilySearch.org…).',
    tip_parents_person: 'Parents of this person, with search links to their family and to each parent.',
    tip_partners: 'Partners (married or unmarried) of this person, with a search link to their family.',
    tip_parents_family: 'Parents of husband and wife, with search links to their families and to each parent.',
    tip_children: 'Children of this family, with a search link to each child.',
    tip_comma_separated_name: 'Multiple values can be separated by commas (e.g. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'Multiple values can be separated by commas (e.g. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'Multiple values can be separated by commas (e.g. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'Multiple values can be separated by commas (e.g. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Grave',
    icon_census: 'Census',
    icon_military: 'War casualty',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Matricula Index',
    icon_dlib: 'Digital Library of Slovenia',

    // Matches
    col_matches: 'Matches',
    col_confidence: 'Confidence',
    matches_loading: 'Loading…',
    matches_none: 'No matches found.',
    matches_confidence: 'Confidence',
    matches_for: 'Matches for',
    matches_found_intro: 'We have found that the following genealogists have matching or similar data to',
    matches_found_outro: 'Select a matching genealogist to view all matches between the two.',
    matches_detail_intro: 'All matches between {1} and {0} are shown below.',
    contributor_surnames_intro: 'Genealogist',
    contributor_surnames_outro: 'has the following top surnames in their tree:',
    contributor_surnames_matricula_outro: 'has the following top surnames in their Matricula Index:',
    section_surnames_matricula: 'Top Surnames - Matricula Index',
    more_info_about: 'More information about',
    back_to_genealogists: 'Genealogists',
    matches_persons: 'Persons',
    matches_families: 'Families',

    // Footer
    footer_version: 'Version',
    footer_data_update: 'Data update',

    // Other indexes
    other_indexes: 'Genealogical indexes:',
    country_slo: 'Slovenia',
    country_cro: 'Croatia',

    // Tree
    tree_zoom_in: 'Zoom In',
    tree_zoom_out: 'Zoom Out',
    tree_reset: 'Reset',
    tree_download_svg: 'Download SVG',
    tree_ancestors_of: 'Ancestors of',
    tree_ancestors_title: 'Ancestors',
    tree_loading: 'Loading tree...',
    tree_error: 'Error loading tree.',
    tree_no_d3: 'Error: D3.js library not loaded.',
    tree_descendants_of: 'Descendants of',
    tree_descendants_title: 'Descendants',
    tree_source: 'Source',
  },
  sl: {
    // Navigation tabs
    tab_search: 'Iskanje',
    tab_person: 'Oseba',
    tab_family: 'Družina',
    tab_contributors: 'Rodoslovci',

    // Search controls
    search_btn: 'Išči',
    exact_search: 'Točno',
    approximate_search: 'Približno',
    has_link: 'S povezavo',
    filter_with: 'Ujemanje z',
    date_to: 'do leta',
    download_csv: 'Prenesi CSV',
    expand_all: 'Razširi',
    collapse_all: 'Skrči',
    general_search_label: 'Splošno',
    chart_others: 'Ostali',
    chart_timeline: 'Časovnica zapisov',
    chart_surnames_title: 'Najpogostejši priimki po rodoslovcu',
    contributors_filter_placeholder: 'Filtriraj po priimku rodoslovca…',
    chart_surnames_all: 'Vsi rodoslovci',
    chart_surnames_select: 'Izberite rodoslovca…',
    chart_surnames_loading: 'Nalaganje…',
    section_surnames: 'Najpogostejši priimki',

    // Result section headings
    results_persons: 'Osebe',
    results_families: 'Družine',
    chart_births: 'Rojstva',
    chart_marriages: 'Poroke',
    chart_deaths: 'Smrti',

    // Status messages
    loading: 'Nalaganje genealoških podatkov...',
    searching: 'Iskanje...',
    no_results: 'Ni rezultatov.',
    enter_criterion: 'Vnesite vsaj eno iskalno merilo.',
    search_failed: 'Iskanje ni uspelo. Preverite povezavo z API-jem.',
    loading_contributors: 'Nalaganje rodoslovcev...',
    contributors_failed: 'Podatkov o rodoslovcih ni mogoče naložiti.',
    init_error: 'Napaka pri inicializaciji aplikacije.',

    // Table column headers
    col_name: 'Ime',
    col_surname: 'Priimek',
    col_date: 'Datum',
    col_place: 'Kraj',
    col_date_of_birth: 'Datum rojstva',
    col_place_of_birth: 'Kraj rojstva',
    col_contributor: 'Rodoslovec',
    col_date_of_death: 'Datum smrti',
    col_place_of_death: 'Kraj smrti',
    col_husband_name: 'Ime moža',
    col_husband_surname: 'Priimek moža',
    col_husband_birth: 'Rojstvo moža',
    col_wife_name: 'Ime žene',
    col_wife_surname: 'Priimek žene',
    col_wife_birth: 'Rojstvo žene',
    col_parents: 'Starši',
    col_partners: 'Partnerji',
    label_husband: 'Mož',
    label_wife: 'Žena',
    label_person: 'Oseba',
    label_birth: 'Rojstvo',
    label_death: 'Smrt',
    label_marriage: 'Poroka',
    col_children: 'Otroci',
    col_date_of_marriage: 'Datum poroke',
    col_place_of_marriage: 'Kraj poroke',
    col_contributor_ID: 'Rodoslovec',
    col_total_persons: 'Osebe',
    col_total_families: 'Družine',
    col_total: 'Skupaj',
    col_last_modified: 'Zadnja sprememba',
    col_last_update: 'Zadnja posodobitev',
    col_links: 'Povezave',
    col_total_links: 'Povezave',
    col_url: 'URL',
    col_sum: 'Skupno',
    col_tree: 'Drevo',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'Rodoslovec, ki je te podatke prispeval v indeks.',
    tip_contributor_ID: 'Rodoslovec, ki je te podatke prispeval v indeks.',
    tip_contributor_ID_matches: 'Rodoslovec z morebitnimi ujemajočimi se zapisi.',
    tip_total_persons: 'Število zapisov o osebah.',
    tip_total_families: 'Število zapisov o družinah.',
    tip_total: 'Skupno število oseb in družin.',
    tip_total_persons_matches: 'Število ujemajočih se zapisov o osebah.',
    tip_total_families_matches: 'Število ujemajočih se zapisov o družinah.',
    tip_total_matches: 'Skupno število ujemajočih se oseb in družin.',
    tip_confidence: 'Ocenjena verjetnost, da se zapisa nanašata na isto osebo ali družino.',
    tip_matches: 'Število rodoslovcev, ki imajo z izbranim rodoslovcem morebitna ujemanja.',
    tip_total_contributors: 'Skupno število rodoslovcev.',
    tip_last_update: 'Datum zadnjega uvoza podatkov.',
    tip_total_links: 'Število povezav na izvorne dokumente (npr. Matricula Online, Geneanet pokopališča, FamilySearch.org…).',
    tip_last_modified: 'Datum zadnjega uvoza podatkov tega rodoslovca v indeks.',
    tip_links: 'Povezave na izvorne dokumente (npr. Matricula Online, Geneanet pokopališča, FamilySearch.org…).',
    tip_parents_person: 'Starši te osebe s povezavami za iskanje njihove družine in posameznih oseb.',
    tip_partners: 'Partnerji (poročeni ali neporočeni) te osebe s povezavo za iskanje njune družine.',
    tip_parents_family: 'Starši moža in žene s povezavami za iskanje njihovih družin in posameznih oseb.',
    tip_children: 'Otroci te družine s povezavo za iskanje vsakega otroka.',
    tip_comma_separated_name: 'Vnesete lahko več vrednosti, ločenih z vejico (npr. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'Vnesete lahko več vrednosti, ločenih z vejico (npr. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'Vnesete lahko več vrednosti, ločenih z vejico (npr. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'Vnesete lahko več vrednosti, ločenih z vejico (npr. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Grob',
    icon_census: 'Popis prebivalstva',
    icon_military: 'Žrtev vojne',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Matricula indeks',
    icon_dlib: 'Digitalna knjižnica Slovenije',

    // Matches
    col_matches: 'Ujemanja',
    col_confidence: 'Zaupanje',
    matches_loading: 'Nalaganje…',
    matches_none: 'Ni najdenih ujemanj.',
    matches_confidence: 'Zaupanje',
    matches_for: 'Ujemanja za',
    matches_found_intro: 'Naslednji rodoslovci imajo ujemajoče ali podobne podatke kot',
    matches_found_outro: 'Z izbiro posameznega rodoslovca vam prikažemo vse ujemke med njima.',
    matches_detail_intro: 'Prikazana so vsa ujemanja med rodoslovcema {1} in {0}.',
    contributor_surnames_intro: 'Rodoslovec',
    contributor_surnames_outro: 'ima v svojem drevesu naslednje najpogostejše priimke:',
    contributor_surnames_matricula_outro: 'ima v indeksu Matricula naslednje najpogostejše priimke:',
    section_surnames_matricula: 'Najpogostejši priimki - Matricula indeks',
    more_info_about: 'Več informacij o',
    back_to_genealogists: 'Rodoslovci',
    matches_persons: 'Osebe',
    matches_families: 'Družine',

    // Footer
    footer_version: 'Različica',
    footer_data_update: 'Posodobitev podatkov',

    // Other indexes
    other_indexes: 'Rodoslovni indeksi:',
    country_slo: 'Slovenija',
    country_cro: 'Hrvaška',

    // Tree
    tree_zoom_in: 'Povečaj',
    tree_zoom_out: 'Pomanjšaj',
    tree_reset: 'Ponastavi',
    tree_download_svg: 'Prenesi SVG',
    tree_ancestors_of: 'Predniki osebe',
    tree_ancestors_title: 'Predniki',
    tree_loading: 'Nalaganje drevesa...',
    tree_error: 'Napaka pri nalaganju drevesa.',
    tree_no_d3: 'Napaka: Knjižnica D3.js ni naložena.',
    tree_descendants_of: 'Potomci osebe',
    tree_descendants_title: 'Potomci',
    tree_source: 'Vir',
  },
  hr: {
    // Navigation tabs
    tab_search: 'Pretraga',
    tab_person: 'Osoba',
    tab_family: 'Obitelj',
    tab_contributors: 'Rodoslovci',

    // Search controls
    search_btn: 'Pretraži',
    exact_search: 'Točno',
    approximate_search: 'Približno',
    has_link: 'S poveznicom',
    filter_with: 'Podudaranje s',
    date_to: 'do godine',
    download_csv: 'Preuzmi CSV',
    expand_all: 'Proširi',
    collapse_all: 'Sažmi',
    general_search_label: 'Opće',
    chart_others: 'Ostali',
    chart_timeline: 'Vremenski pregled zapisa',
    chart_surnames_title: 'Najčešća prezimena po rodoslovcu',
    contributors_filter_placeholder: 'Filtriraj po prezimenu rodoslovca…',
    chart_surnames_all: 'Svi rodoslovci',
    chart_surnames_select: 'Odaberi rodoslovca…',
    chart_surnames_loading: 'Učitavanje…',
    section_surnames: 'Najčešća prezimena',

    // Result section headings
    results_persons: 'Osobe',
    results_families: 'Obitelji',
    chart_births: 'Rođenja',
    chart_marriages: 'Vjenčanja',
    chart_deaths: 'Smrti',

    // Status messages
    loading: 'Učitavanje rodoslovnih podataka...',
    searching: 'Pretraživanje...',
    no_results: 'Nema rezultata.',
    enter_criterion: 'Unesite barem jedan kriterij pretrage.',
    search_failed: 'Pretraga nije uspjela. Provjerite API vezu.',
    loading_contributors: 'Učitavanje rodoslovaca...',
    contributors_failed: 'Nije moguće učitati podatke o rodoslovcima.',
    init_error: 'Greška pri inicijalizaciji aplikacije.',

    // Table column headers
    col_name: 'Ime',
    col_surname: 'Prezime',
    col_date: 'Datum',
    col_place: 'Mjesto',
    col_date_of_birth: 'Datum rođenja',
    col_place_of_birth: 'Mjesto rođenja',
    col_contributor: 'Rodoslovac',
    col_date_of_death: 'Datum smrti',
    col_place_of_death: 'Mjesto smrti',
    col_husband_name: 'Ime muža',
    col_husband_surname: 'Prezime muža',
    col_husband_birth: 'Rođenje muža',
    col_wife_name: 'Ime žene',
    col_wife_surname: 'Prezime žene',
    col_wife_birth: 'Rođenje žene',
    col_parents: 'Roditelji',
    col_partners: 'Partneri',
    label_husband: 'Muž',
    label_wife: 'Žena',
    label_person: 'Osoba',
    label_birth: 'Rođenje',
    label_death: 'Smrt',
    label_marriage: 'Vjenčanje',
    col_children: 'Djeca',
    col_date_of_marriage: 'Datum vjenčanja',
    col_place_of_marriage: 'Mjesto vjenčanja',
    col_contributor_ID: 'Rodoslovac',
    col_total_persons: 'Osobe',
    col_total_families: 'Obitelji',
    col_total: 'Ukupno',
    col_last_modified: 'Zadnja izmjena',
    col_last_update: 'Zadnje ažuriranje',
    col_links: 'Poveznice',
    col_total_links: 'Poveznice',
    col_url: 'URL',
    col_sum: 'Zbroj',
    col_tree: 'Stablo',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'Rodoslovac koji je ove podatke ustupio indeksu.',
    tip_contributor_ID: 'Rodoslovac koji je ove podatke ustupio indeksu.',
    tip_contributor_ID_matches: 'Rodoslovac s potencijalno podudarnim zapisima.',
    tip_total_persons: 'Broj zapisa o osobama.',
    tip_total_families: 'Broj zapisa o obiteljima.',
    tip_total: 'Ukupan broj osoba i obitelji.',
    tip_total_persons_matches: 'Broj podudarnih zapisa o osobama.',
    tip_total_families_matches: 'Broj podudarnih zapisa o obiteljima.',
    tip_total_matches: 'Ukupan broj podudarnih osoba i obitelji.',
    tip_confidence: 'Procijenjena vjerojatnost da se zapisi odnose na istu osobu ili obitelj.',
    tip_matches: 'Broj rodoslovaca koji imaju potencijalno podudarne zapise s odabranim rodoslovcem.',
    tip_total_contributors: 'Ukupan broj rodoslovaca.',
    tip_last_update: 'Datum posljednjeg uvoza podataka.',
    tip_total_links: 'Broj poveznica na izvorne dokumente (npr. Matricula Online, Geneanet groblja, FamilySearch.org…).',
    tip_last_modified: 'Datum posljednjeg uvoza podataka ovog rodoslovca u indeks.',
    tip_links: 'Poveznice na izvorne dokumente (npr. Matricula Online, Geneanet groblja, FamilySearch.org…).',
    tip_parents_person: 'Roditelji ove osobe s poveznicama za pretragu njihove obitelji i pojedinih osoba.',
    tip_partners: 'Partneri (vjenčani ili nevjenčani) ove osobe s poveznicom za pretragu njihove obitelji.',
    tip_parents_family: 'Roditelji muža i žene s poveznicama za pretragu njihovih obitelji i pojedinih osoba.',
    tip_children: 'Djeca ove obitelji s poveznicom za pretragu svakog djeteta.',
    tip_comma_separated_name: 'Možete unijeti više vrijednosti odvojenih zarezom (npr. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'Možete unijeti više vrijednosti odvojenih zarezom (npr. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'Možete unijeti više vrijednosti odvojenih zarezom (npr. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'Možete unijeti više vrijednosti odvojenih zarezom (npr. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Grob',
    icon_census: 'Popis stanovništva',
    icon_military: 'Žrtva rata',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Matricula indeks',
    icon_dlib: 'Digitalna knjižnica Slovenije',

    // Matches
    col_matches: 'Podudaranja',
    col_confidence: 'Pouzdanost',
    matches_loading: 'Učitavanje…',
    matches_none: 'Nema pronađenih podudaranja.',
    matches_confidence: 'Pouzdanost',
    matches_for: 'Podudaranja za',
    matches_found_intro: 'Pronašli smo sljedeće rodoslovce koji imaju podudarne ili slične podatke kao',
    matches_found_outro: 'Odabirom podudarnog rodoslovca prikazat će se sva podudaranja između dva rodoslovca.',
    matches_detail_intro: 'Prikazana su sva podudaranja između rodoslovaca {1} i {0}.',
    contributor_surnames_intro: 'Rodoslovac',
    contributor_surnames_outro: 'ima u svom stablu sljedeća najčešća prezimena:',
    contributor_surnames_matricula_outro: 'ima u indeksu Matricula sljedeća najčešća prezimena:',
    section_surnames_matricula: 'Najčešća prezimena - Matricula indeks',
    more_info_about: 'Više informacija o',
    back_to_genealogists: 'Rodoslovci',
    matches_persons: 'Osobe',
    matches_families: 'Obitelji',

    // Footer
    footer_version: 'Verzija',
    footer_data_update: 'Ažuriranje podataka',

    // Other indexes
    other_indexes: 'Rodoslovni indeksi:',
    country_slo: 'Slovenija',
    country_cro: 'Hrvatska',

    // Tree
    tree_zoom_in: 'Povećaj',
    tree_zoom_out: 'Smanji',
    tree_reset: 'Poništi',
    tree_download_svg: 'Preuzmi SVG',
    tree_ancestors_of: 'Preci osobe',
    tree_ancestors_title: 'Preci',
    tree_loading: 'Učitavanje stabla...',
    tree_error: 'Greška pri učitavanju stabla.',
    tree_no_d3: 'Greška: D3.js biblioteka nije učitana.',
    tree_descendants_of: 'Potomci osobe',
    tree_descendants_title: 'Potomci',
    tree_source: 'Izvor',
  },
  de: {
    // Navigation tabs
    tab_search: 'Suche',
    tab_person: 'Person',
    tab_family: 'Familie',
    tab_contributors: 'Genealogen',

    // Search controls
    search_btn: 'Suchen',
    exact_search: 'Genau',
    approximate_search: 'Ungefähr',
    has_link: 'Mit Link',
    filter_with: 'Übereinstimmung mit',
    date_to: 'bis Jahr',
    download_csv: 'CSV herunterladen',
    expand_all: 'Ausklappen',
    collapse_all: 'Einklappen',
    general_search_label: 'Allgemein',
    chart_others: 'Andere',
    chart_timeline: 'Zeitverlauf der Einträge',
    chart_surnames_title: 'Häufigste Nachnamen pro Genealoge',
    contributors_filter_placeholder: 'Nach Nachnamen des Genealogen filtern…',
    chart_surnames_all: 'Alle Genealogen',
    chart_surnames_select: 'Genealogen auswählen…',
    chart_surnames_loading: 'Laden…',
    section_surnames: 'Häufigste Nachnamen',

    // Result section headings
    results_persons: 'Personen',
    results_families: 'Familien',
    chart_births: 'Geburten',
    chart_marriages: 'Heiraten',
    chart_deaths: 'Sterbefälle',

    // Status messages
    loading: 'Genealogische Daten werden geladen...',
    searching: 'Suche läuft...',
    no_results: 'Keine Ergebnisse gefunden.',
    enter_criterion: 'Bitte mindestens ein Suchkriterium eingeben.',
    search_failed: 'Suche fehlgeschlagen. API-Verbindung prüfen.',
    loading_contributors: 'Genealogen werden geladen...',
    contributors_failed: 'Daten der Genealogen konnten nicht geladen werden.',
    init_error: 'Fehler beim Initialisieren der Anwendung.',

    // Table column headers
    col_name: 'Vorname',
    col_surname: 'Nachname',
    col_date: 'Datum',
    col_place: 'Ort',
    col_date_of_birth: 'Geburtsdatum',
    col_place_of_birth: 'Geburtsort',
    col_contributor: 'Genealoge',
    col_date_of_death: 'Sterbedatum',
    col_place_of_death: 'Sterbeort',
    col_husband_name: 'Vorname des Mannes',
    col_husband_surname: 'Nachname des Mannes',
    col_husband_birth: 'Geburt des Mannes',
    col_wife_name: 'Vorname der Frau',
    col_wife_surname: 'Nachname der Frau',
    col_wife_birth: 'Geburt der Frau',
    col_parents: 'Eltern',
    col_partners: 'Partner',
    label_husband: 'Mann',
    label_wife: 'Frau',
    label_person: 'Person',
    label_birth: 'Geburt',
    label_death: 'Tod',
    label_marriage: 'Heirat',
    col_children: 'Kinder',
    col_date_of_marriage: 'Heiratsdatum',
    col_place_of_marriage: 'Heiratsort',
    col_contributor_ID: 'Genealoge',
    col_total_persons: 'Personen',
    col_total_families: 'Familien',
    col_total: 'Gesamt',
    col_last_modified: 'Letzte Änderung',
    col_last_update: 'Letztes Update',
    col_links: 'Links',
    col_total_links: 'Links',
    col_url: 'URL',
    col_sum: 'Summe',
    col_tree: 'Stammbaum',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'Genealoge, der diese Daten zum Index beigesteuert hat.',
    tip_contributor_ID: 'Genealoge, der diese Daten zum Index beigesteuert hat.',
    tip_contributor_ID_matches: 'Genealoge mit potenziell übereinstimmenden Einträgen.',
    tip_total_persons: 'Anzahl der Personeneinträge.',
    tip_total_families: 'Anzahl der Familieneinträge.',
    tip_total: 'Gesamtzahl der Personen und Familien.',
    tip_total_persons_matches: 'Anzahl übereinstimmender Personeneinträge.',
    tip_total_families_matches: 'Anzahl übereinstimmender Familieneinträge.',
    tip_total_matches: 'Gesamtzahl übereinstimmender Personen und Familien.',
    tip_confidence: 'Geschätzte Wahrscheinlichkeit, dass die Einträge dieselbe Person oder Familie betreffen.',
    tip_matches: 'Anzahl anderer Genealogen mit potenziell übereinstimmenden Einträgen.',
    tip_total_contributors: 'Gesamtzahl der Genealogen.',
    tip_last_update: 'Datum des letzten Datenimports.',
    tip_total_links: 'Anzahl der Verweise auf Quelldokumente (z. B. Matricula Online, Geneanet Friedhöfe, FamilySearch.org …).',
    tip_last_modified: 'Datum des letzten Imports der Daten dieses Genealogen in den Index.',
    tip_links: 'Verweise auf Quelldokumente (z. B. Matricula Online, Geneanet Friedhöfe, FamilySearch.org …).',
    tip_parents_person: 'Eltern dieser Person mit Suchlinks zur Familie und zu jedem Elternteil.',
    tip_partners: 'Partner (verheiratet oder unverheiratet) dieser Person mit Suchlink zu ihrer Familie.',
    tip_parents_family: 'Eltern von Mann und Frau mit Suchlinks zu ihren Familien und zu jedem Elternteil.',
    tip_children: 'Kinder dieser Familie mit einem Suchlink zu jedem Kind.',
    tip_comma_separated_name: 'Mehrere Werte können durch Kommas getrennt werden (z. B. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'Mehrere Werte können durch Kommas getrennt werden (z. B. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'Mehrere Werte können durch Kommas getrennt werden (z. B. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'Mehrere Werte können durch Kommas getrennt werden (z. B. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Grab',
    icon_census: 'Volkszählung',
    icon_military: 'Kriegsopfer',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Matricula-Index',
    icon_dlib: 'Digitale Bibliothek Sloweniens',

    // Matches
    col_matches: 'Übereinstimmungen',
    col_confidence: 'Konfidenz',
    matches_loading: 'Laden…',
    matches_none: 'Keine Übereinstimmungen gefunden.',
    matches_confidence: 'Konfidenz',
    matches_for: 'Übereinstimmungen für',
    matches_found_intro: 'Wir haben die folgenden Genealogen gefunden, die übereinstimmende oder ähnliche Daten aufweisen wie',
    matches_found_outro: 'Wählen Sie einen übereinstimmenden Genealogen aus, um alle Übereinstimmungen zwischen den beiden anzuzeigen.',
    matches_detail_intro: 'Alle Übereinstimmungen zwischen {1} und {0} werden unten angezeigt.',
    contributor_surnames_intro: 'Der Genealoge',
    contributor_surnames_outro: 'hat die folgenden häufigsten Nachnamen in seinem Stammbaum:',
    contributor_surnames_matricula_outro: 'hat die folgenden häufigsten Nachnamen in seinem Matricula-Index:',
    section_surnames_matricula: 'Häufigste Nachnamen - Matricula-Index',
    more_info_about: 'Weitere Informationen über',
    back_to_genealogists: 'Genealogen',
    matches_persons: 'Personen',
    matches_families: 'Familien',

    // Footer
    footer_version: 'Version',
    footer_data_update: 'Datenaktualisierung',

    // Other indexes
    other_indexes: 'Genealogische Indizes:',
    country_slo: 'Slowenien',
    country_cro: 'Kroatien',

    // Tree
    tree_zoom_in: 'Vergrößern',
    tree_zoom_out: 'Verkleinern',
    tree_reset: 'Zurücksetzen',
    tree_download_svg: 'SVG herunterladen',
    tree_ancestors_of: 'Vorfahren von',
    tree_ancestors_title: 'Vorfahren',
    tree_loading: 'Stammbaum wird geladen...',
    tree_error: 'Fehler beim Laden des Stammbaums.',
    tree_no_d3: 'Fehler: D3.js-Bibliothek nicht geladen.',
    tree_descendants_of: 'Nachkommen von',
    tree_descendants_title: 'Nachkommen',
    tree_source: 'Quelle',
  },
  hu: {
    // Navigation tabs
    tab_search: 'Keresés',
    tab_person: 'Személy',
    tab_family: 'Család',
    tab_contributors: 'Genealógusok',

    // Search controls
    search_btn: 'Keresés',
    exact_search: 'Pontos',
    approximate_search: 'Közelítő',
    has_link: 'Hivatkozással',
    filter_with: 'Egyezés vele',
    date_to: 'évig',
    download_csv: 'CSV letöltése',
    expand_all: 'Kibontás',
    collapse_all: 'Összecsukás',
    general_search_label: 'Általános',
    chart_others: 'Mások',
    chart_timeline: 'Rekordok időrendje',
    chart_surnames_title: 'Leggyakoribb vezetéknevek genealógusonként',
    contributors_filter_placeholder: 'Szűrés genealógus vezetékneve szerint…',
    chart_surnames_all: 'Összes genealógus',
    chart_surnames_select: 'Válasszon genealógust…',
    chart_surnames_loading: 'Betöltés…',
    section_surnames: 'Leggyakoribb vezetéknevek',

    // Result section headings
    results_persons: 'Személyek',
    results_families: 'Családok',
    chart_births: 'Születések',
    chart_marriages: 'Házasságkötések',
    chart_deaths: 'Halálozások',

    // Status messages
    loading: 'Genealógiai adatok betöltése...',
    searching: 'Keresés...',
    no_results: 'Nincs találat.',
    enter_criterion: 'Kérjük, adjon meg legalább egy keresési feltételt.',
    search_failed: 'A keresés sikertelen. Ellenőrizze az API-kapcsolatot.',
    loading_contributors: 'Genealógusok betöltése...',
    contributors_failed: 'A genealógusok adatait nem sikerült betölteni.',
    init_error: 'Hiba az alkalmazás inicializálásakor.',

    // Table column headers
    col_name: 'Utónév',
    col_surname: 'Vezetéknév',
    col_date: 'Dátum',
    col_place: 'Helyszín',
    col_date_of_birth: 'Születési dátum',
    col_place_of_birth: 'Születési hely',
    col_contributor: 'Genealógus',
    col_date_of_death: 'Halál dátuma',
    col_place_of_death: 'Halál helye',
    col_husband_name: 'Férj utóneve',
    col_husband_surname: 'Férj vezetékneve',
    col_husband_birth: 'Férj születése',
    col_wife_name: 'Feleség utóneve',
    col_wife_surname: 'Feleség vezetékneve',
    col_wife_birth: 'Feleség születése',
    col_parents: 'Szülők',
    col_partners: 'Partnerek',
    label_husband: 'Férj',
    label_wife: 'Feleség',
    label_person: 'Személy',
    label_birth: 'Születés',
    label_death: 'Halál',
    label_marriage: 'Házasság',
    col_children: 'Gyermekek',
    col_date_of_marriage: 'Házasságkötés dátuma',
    col_place_of_marriage: 'Házasságkötés helye',
    col_contributor_ID: 'Genealógus',
    col_total_persons: 'Személyek',
    col_total_families: 'Családok',
    col_total: 'Összesen',
    col_last_modified: 'Utolsó módosítás',
    col_last_update: 'Utolsó frissítés',
    col_links: 'Hivatkozások',
    col_total_links: 'Hivatkozások',
    col_url: 'URL',
    col_sum: 'Összeg',
    col_tree: 'Családfa',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'A genealógus, aki ezeket az adatokat az indexhez hozzájárult.',
    tip_contributor_ID: 'A genealógus, aki ezeket az adatokat az indexhez hozzájárult.',
    tip_contributor_ID_matches: 'Genealógus, akinek potenciálisan egyező rekordjai vannak.',
    tip_total_persons: 'Személyrekordok száma.',
    tip_total_families: 'Családrekordok száma.',
    tip_total: 'Személyek és családok teljes száma.',
    tip_total_persons_matches: 'Egyező személyrekordok száma.',
    tip_total_families_matches: 'Egyező családrekordok száma.',
    tip_total_matches: 'Az egyező személyek és családok teljes száma.',
    tip_confidence: 'Becsült valószínűség, hogy a rekordok ugyanarra a személyre vagy családra vonatkoznak.',
    tip_matches: 'A más genealógusok száma, akiknek potenciálisan egyező rekordjaik vannak.',
    tip_total_contributors: 'A genealógusok teljes száma.',
    tip_last_update: 'A legutóbbi adatimport dátuma.',
    tip_total_links: 'A forrásdokumentumokra mutató hivatkozások száma (pl. Matricula Online, Geneanet temetők, FamilySearch.org…).',
    tip_last_modified: 'A genealógus adatainak az indexbe való utolsó importálásának dátuma.',
    tip_links: 'Hivatkozások forrásdokumentumokra (pl. Matricula Online, Geneanet temetők, FamilySearch.org…).',
    tip_parents_person: 'A személy szülei, családjukra és az egyes szülőkre mutató keresési hivatkozásokkal.',
    tip_partners: 'A személy partnerei (házastársak vagy élettársak), családjukra mutató keresési hivatkozással.',
    tip_parents_family: 'A férj és a feleség szülei, családjukra és az egyes szülőkre mutató keresési hivatkozásokkal.',
    tip_children: 'A család gyermekei, mindegyikükre mutató keresési hivatkozással.',
    tip_comma_separated_name: 'Több értéket is megadhat vesszővel elválasztva (pl. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'Több értéket is megadhat vesszővel elválasztva (pl. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'Több értéket is megadhat vesszővel elválasztva (pl. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'Több értéket is megadhat vesszővel elválasztva (pl. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Sír',
    icon_census: 'Népszámlálás',
    icon_military: 'Háborús áldozat',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Matricula index',
    icon_dlib: 'Szlovénia Digitális Könyvtára',

    // Matches
    col_matches: 'Egyezések',
    col_confidence: 'Megbízhatóság',
    matches_loading: 'Betöltés…',
    matches_none: 'Nem találhatók egyezések.',
    matches_confidence: 'Megbízhatóság',
    matches_for: 'Egyezések:',
    matches_found_intro: 'A következő genealógusokat találtuk, akik egyező vagy hasonló adatokkal rendelkeznek, mint',
    matches_found_outro: 'Válasszon ki egy egyező genealógust a kettejük közötti összes egyezés megtekintéséhez.',
    matches_detail_intro: 'A {1} és {0} közötti összes egyezés alább látható.',
    contributor_surnames_intro: 'A genealógus',
    contributor_surnames_outro: 'a következő leggyakoribb vezetéknevekkel rendelkezik a családfájában:',
    contributor_surnames_matricula_outro: 'a következő leggyakoribb vezetéknevekkel rendelkezik a Matricula indexében:',
    section_surnames_matricula: 'Leggyakoribb vezetéknevek - Matricula index',
    more_info_about: 'További információk róla:',
    back_to_genealogists: 'Genealógusok',
    matches_persons: 'Személyek',
    matches_families: 'Családok',

    // Footer
    footer_version: 'Verzió',
    footer_data_update: 'Adatfrissítés',

    // Other indexes
    other_indexes: 'Genealógiai indexek:',
    country_slo: 'Szlovénia',
    country_cro: 'Horvátország',

    // Tree
    tree_zoom_in: 'Nagyítás',
    tree_zoom_out: 'Kicsinyítés',
    tree_reset: 'Visszaállítás',
    tree_download_svg: 'SVG letöltése',
    tree_ancestors_of: 'Ősei:',
    tree_ancestors_title: 'Ősök',
    tree_loading: 'Családfa betöltése...',
    tree_error: 'Hiba a családfa betöltésekor.',
    tree_no_d3: 'Hiba: D3.js könyvtár nincs betöltve.',
    tree_descendants_of: 'Leszármazottai:',
    tree_descendants_title: 'Leszármazottak',
    tree_source: 'Forrás',
  },
  it: {
    // Navigation tabs
    tab_search: 'Ricerca',
    tab_person: 'Persona',
    tab_family: 'Famiglia',
    tab_contributors: 'Genealogisti',

    // Search controls
    search_btn: 'Cerca',
    exact_search: 'Esatto',
    approximate_search: 'Approssimato',
    has_link: 'Con collegamento',
    filter_with: 'Corrispondenza con',
    date_to: 'fino all\'anno',
    download_csv: 'Scarica CSV',
    expand_all: 'Espandi',
    collapse_all: 'Comprimi',
    general_search_label: 'Generale',
    chart_others: 'Altri',
    chart_timeline: 'Cronologia dei record',
    chart_surnames_title: 'Cognomi più frequenti per genealogista',
    contributors_filter_placeholder: 'Filtra per cognome genealogista…',
    chart_surnames_all: 'Tutti i genealogisti',
    chart_surnames_select: 'Seleziona genealogista…',
    chart_surnames_loading: 'Caricamento…',
    section_surnames: 'Cognomi più frequenti',

    // Result section headings
    results_persons: 'Persone',
    results_families: 'Famiglie',
    chart_births: 'Nascite',
    chart_marriages: 'Matrimoni',
    chart_deaths: 'Morti',

    // Status messages
    loading: 'Caricamento dei dati genealogici...',
    searching: 'Ricerca in corso...',
    no_results: 'Nessun risultato trovato.',
    enter_criterion: 'Inserisci almeno un criterio di ricerca.',
    search_failed: 'Ricerca fallita. Controlla la connessione API.',
    loading_contributors: 'Caricamento genealogisti...',
    contributors_failed: 'Impossibile caricare i dati dei genealogisti.',
    init_error: 'Errore durante l\'inizializzazione dell\'applicazione.',

    // Table column headers
    col_name: 'Nome',
    col_surname: 'Cognome',
    col_date: 'Data',
    col_place: 'Luogo',
    col_date_of_birth: 'Data di nascita',
    col_place_of_birth: 'Luogo di nascita',
    col_contributor: 'Genealogista',
    col_date_of_death: 'Data di morte',
    col_place_of_death: 'Luogo di morte',
    col_husband_name: 'Nome del marito',
    col_husband_surname: 'Cognome del marito',
    col_husband_birth: 'Nascita del marito',
    col_wife_name: 'Nome della moglie',
    col_wife_surname: 'Cognome della moglie',
    col_wife_birth: 'Nascita della moglie',
    col_parents: 'Genitori',
    col_partners: 'Partner',
    label_husband: 'Marito',
    label_wife: 'Moglie',
    label_person: 'Persona',
    label_birth: 'Nascita',
    label_death: 'Morte',
    label_marriage: 'Matrimonio',
    col_children: 'Figli',
    col_date_of_marriage: 'Data di matrimonio',
    col_place_of_marriage: 'Luogo di matrimonio',
    col_contributor_ID: 'Genealogista',
    col_total_persons: 'Persone',
    col_total_families: 'Famiglie',
    col_total: 'Totale',
    col_last_modified: 'Ultima modifica',
    col_last_update: 'Ultimo aggiornamento',
    col_links: 'Collegamenti',
    col_total_links: 'Collegamenti',
    col_url: 'URL',
    col_sum: 'Somma',
    col_tree: 'Albero',
    col_matricula: 'Matricula',

    // Column header tooltips
    tip_contributor: 'Genealogista che ha fornito questi dati all\'indice.',
    tip_contributor_ID: 'Genealogista che ha fornito questi dati all\'indice.',
    tip_contributor_ID_matches: 'Genealogista con record potenzialmente corrispondenti.',
    tip_total_persons: 'Numero di record di persone.',
    tip_total_families: 'Numero di record di famiglie.',
    tip_total: 'Numero totale di persone e famiglie.',
    tip_total_persons_matches: 'Numero di record di persone corrispondenti.',
    tip_total_families_matches: 'Numero di record di famiglie corrispondenti.',
    tip_total_matches: 'Numero totale di persone e famiglie corrispondenti.',
    tip_confidence: 'Probabilità stimata che i record si riferiscano alla stessa persona o famiglia.',
    tip_matches: 'Numero di altri genealogisti con record potenzialmente corrispondenti.',
    tip_total_contributors: 'Numero totale di genealogisti.',
    tip_last_update: 'Data dell\'ultima importazione dei dati.',
    tip_total_links: 'Numero di collegamenti a documenti originali (ad es. Matricula Online, Geneanet cimiteri, FamilySearch.org…).',
    tip_last_modified: 'Data dell\'ultima importazione dei dati di questo genealogista nell\'indice.',
    tip_links: 'Collegamenti a documenti originali (ad es. Matricula Online, Geneanet cimiteri, FamilySearch.org…).',
    tip_parents_person: 'Genitori di questa persona, con collegamenti di ricerca alla loro famiglia e a ciascun genitore.',
    tip_partners: 'Partner (sposati o non sposati) di questa persona, con un collegamento di ricerca alla loro famiglia.',
    tip_parents_family: 'Genitori del marito e della moglie, con collegamenti di ricerca alle loro famiglie e a ciascun genitore.',
    tip_children: 'Figli di questa famiglia, con un collegamento di ricerca a ciascun figlio.',
    tip_comma_separated_name: 'È possibile inserire più valori separati da virgole (es. &quot;Janez, Ivan&quot;).',
    tip_comma_separated_surname: 'È possibile inserire più valori separati da virgole (es. &quot;Mali, Mally&quot;).',
    tip_comma_separated_place: 'È possibile inserire più valori separati da virgole (es. &quot;Metlika, Podzemelj&quot;).',
    tip_comma_separated_contributor: 'È possibile inserire più valori separati da virgole (es. &quot;Mali, Toplišek&quot;).',

    // Icon tooltips
    icon_familysearch: 'FamilySearch',
    icon_grave: 'Tomba',
    icon_census: 'Censimento',
    icon_military: 'Vittima di guerra',
    icon_matricula: 'Matricula Online',
    icon_matricula_index: 'Indice Matricula',
    icon_dlib: 'Biblioteca digitale della Slovenia',

    // Matches
    col_matches: 'Corrispondenze',
    col_confidence: 'Confidenza',
    matches_loading: 'Caricamento…',
    matches_none: 'Nessuna corrispondenza trovata.',
    matches_confidence: 'Confidenza',
    matches_for: 'Corrispondenze per',
    matches_found_intro: 'Abbiamo trovato i seguenti genealogisti che hanno dati corrispondenti o simili a',
    matches_found_outro: 'Seleziona un genealogista corrispondente per visualizzare tutte le corrispondenze tra i due.',
    matches_detail_intro: 'Tutte le corrispondenze tra {1} e {0} sono mostrate di seguito.',
    contributor_surnames_intro: 'Il genealogista',
    contributor_surnames_outro: 'ha i seguenti cognomi più frequenti nel suo albero:',
    contributor_surnames_matricula_outro: 'ha i seguenti cognomi più frequenti nel suo indice Matricula:',
    section_surnames_matricula: 'Cognomi più frequenti - Indice Matricula',
    more_info_about: 'Maggiori informazioni su',
    back_to_genealogists: 'Genealogisti',
    matches_persons: 'Persone',
    matches_families: 'Famiglie',

    // Footer
    footer_version: 'Versione',
    footer_data_update: 'Aggiornamento dati',

    // Other indexes
    other_indexes: 'Indici genealogici:',
    country_slo: 'Slovenia',
    country_cro: 'Croazia',

    // Tree
    tree_zoom_in: 'Ingrandisci',
    tree_zoom_out: 'Rimpicciolisci',
    tree_reset: 'Reimposta',
    tree_download_svg: 'Scarica SVG',
    tree_ancestors_of: 'Antenati di',
    tree_ancestors_title: 'Antenati',
    tree_loading: 'Caricamento dell\'albero...',
    tree_error: 'Errore durante il caricamento dell\'albero.',
    tree_no_d3: 'Errore: libreria D3.js non caricata.',
    tree_descendants_of: 'Discendenti di',
    tree_descendants_title: 'Discendenti',
    tree_source: 'Fonte',
  },
};

// Flag and code for each supported language (used to render the lang switcher)
const LANG_META = {
  en: { flag: '🇬🇧', code: 'EN' },
  sl: { flag: '🇸🇮', code: 'SL' },
  hr: { flag: '🇭🇷', code: 'HR' },
  hu: { flag: '🇭🇺', code: 'HU' },
  de: { flag: '🇩🇪', code: 'DE' },
  it: { flag: '🇮🇹', code: 'IT' },
};

function detectLanguage() {
  const saved = localStorage.getItem('sgi-lang');
  if (saved && siteConfig.languages.includes(saved) && translations[saved]) return saved;
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  if (siteConfig.languages.includes(browser) && translations[browser]) return browser;
  return siteConfig.defaultLang || 'en';
}

let currentLang = detectLanguage();
const changeListeners = [];

/** Returns the translation for a given key in the current language.
 *  Site-specific overrides (site_title, society_name) are checked first. */
export function t(key) {
  const siteOverride = siteConfig.i18n?.[currentLang]?.[key];
  if (siteOverride !== undefined) return siteOverride;
  return (translations[currentLang]?.[key]) ?? (translations.en?.[key]) ?? key;
}

/** Returns the intro paragraphs for the current language (from site config). */
export function getIntro() {
  return siteConfig.intro?.[currentLang] || siteConfig.intro?.en || [];
}

export function getCurrentLang() {
  return currentLang;
}

/** Register a callback to be called whenever the language changes. */
export function onLanguageChange(callback) {
  changeListeners.push(callback);
}

export function setLanguage(lang) {
  if (!translations[lang] || !siteConfig.languages.includes(lang) || lang === currentLang) return;
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
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  // Update page title
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
  // Build language buttons from site config (only languages defined for this installation)
  const dropdown = document.getElementById('lang-dropdown');
  if (dropdown) {
    dropdown.innerHTML = siteConfig.languages
      .map(lang => {
        const meta = LANG_META[lang];
        if (!meta) return '';
        return `<button class="lang-option" data-lang="${lang}">${meta.flag} ${meta.code}</button>`;
      })
      .join('');
  }

  applyStaticTranslations();

  const toggle = document.getElementById('lang-toggle');
  if (!toggle || !dropdown) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => dropdown.classList.remove('open'));

  dropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-option');
    if (btn) {
      setLanguage(btn.dataset.lang);
      dropdown.classList.remove('open');
    }
  });
}
