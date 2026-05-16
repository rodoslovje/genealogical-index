/**
 * Slovenia site configuration.
 * This is the only file that differs between installations.
 * Fork this file (and the public/ assets) to create a new country site.
 */
const siteConfig = {
  // Branding
  logo:        null,
  logoAlt:     'nologo',
  societyUrl:  'https://renko.fyi',
  indexUrl:    null,
  contactEmail: 'indeks@rodoslovje.si',

  apiHost: 'tgi-api.renko.fyi',
  filePrefix: 'tgi',

  // Languages shown in the dropdown, ordered alphabetically by language name
  languages: ['de', 'en', 'hr', 'hu', 'it', 'sl'],

  // Preferred language when no saved preference or browser match is found
  defaultLang: 'sl',

  // Per-language overrides: site title and society name
  i18n: {
    en: { site_title: 'TEST Genealogical Index',  society_name: 'TEST Genealogy Society' },
    sl: { site_title: 'TEST rodoslovni indeks',   society_name: 'TEST rodoslovno društvo' },
    hr: { site_title: 'TEST rodoslovni indeks',   society_name: 'TEST rodoslovno društvo' },
    hu: { site_title: 'TEST Genealógiai Index',   society_name: 'TEST Genealógiai Társaság' },
    de: { site_title: 'TEST Genealogischer Index', society_name: 'TEST Genealogische Gesellschaft' },
    it: { site_title: 'Indice genealogico TEST',  society_name: 'Società genealogica TEST' },
  },

  // Intro paragraphs shown on empty search tabs. Falls back to 'en' for missing languages.
  // Each entry: { text: string (HTML allowed), warning?: true }
  intro: {
    en: [
      { text: 'This is a TEST site.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
    sl: [
      { text: 'To je TESTNO okolje.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
    hr: [
      { text: 'Ovo je TESTNA stranica.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
    hu: [
      { text: 'Ez egy TESZT oldal.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
    de: [
      { text: 'Dies ist eine TEST-Seite.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
    it: [
      { text: 'Questo è un sito di TEST.' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
      { text: '' },
    ],
  },
};

export default siteConfig;
