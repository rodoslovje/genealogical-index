import siteConfig from '@site-config';
import en from './i18n/en.js';

// Generic UI translations live in per-locale modules under ./i18n/. Only the
// default English locale is bundled with the initial JS chunk; the others are
// fetched on demand the first time setLanguage() selects them.
//
// Site-specific strings (site_title, society_name, intro paragraphs) live in
// site.config.js and override the bundled translations.

const translations = { en };

// Flag, code, and native name for each supported language. The flag + code go
// on the navbar toggle; the dropdown shows "<flag> <native name> (<code>)".
const LANG_META = {
  en: { flag: '🇬🇧', code: 'EN', name: 'English' },
  sl: { flag: '🇸🇮', code: 'SL', name: 'Slovenščina' },
  hr: { flag: '🇭🇷', code: 'HR', name: 'Hrvatski' },
  hu: { flag: '🇭🇺', code: 'HU', name: 'Magyar' },
  de: { flag: '🇩🇪', code: 'DE', name: 'Deutsch' },
  it: { flag: '🇮🇹', code: 'IT', name: 'Italiano' },
};

let currentLang = 'en';
const changeListeners = [];

/** Returns the language code we'd like to display on first paint:
 *  saved choice → browser locale → site default. Never returns a locale that
 *  isn't listed in the current site's `languages` array. */
function detectLanguage() {
  const allowed = siteConfig.languages;
  const saved = localStorage.getItem('sgi-lang');
  if (saved && allowed.includes(saved)) return saved;
  const browser = (navigator.language || '').slice(0, 2).toLowerCase();
  if (allowed.includes(browser)) return browser;
  return siteConfig.defaultLang || 'en';
}

// Map of `'./i18n/<lang>.js'` → async loader. Vite emits one chunk per
// matching file at build time. English is excluded from the glob because it
// is statically imported above; including it would have Vite warn about a
// module that's both static and dynamic.
const localeLoaders = import.meta.glob(['./i18n/*.js', '!./i18n/en.js'], { import: 'default' });

/** Lazy-load a locale chunk. Returns the cached translations object. */
async function loadLocale(lang) {
  if (translations[lang]) return translations[lang];
  const loader = localeLoaders[`./i18n/${lang}.js`];
  if (!loader) return en;
  try {
    translations[lang] = await loader();
    return translations[lang];
  } catch (err) {
    console.warn(`Failed to load locale "${lang}", falling back to en.`, err);
    return en;
  }
}

/** Returns the translation for a given key in the current language. Site
 *  overrides (site_title, society_name) win; the active locale comes next;
 *  English is the final fallback. */
export function t(key) {
  const siteOverride = siteConfig.i18n?.[currentLang]?.[key];
  if (siteOverride !== undefined) return siteOverride;
  return (translations[currentLang]?.[key]) ?? (translations.en?.[key]) ?? key;
}

/** Formats a word appended after a hyphen for titles (lowercases it in languages that require it) */
export function formatTitleSuffix(text) {
  if (!text) return text;
  if (currentLang === 'en' || currentLang === 'de') return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Intro paragraphs are site-specific (`siteConfig.intro`). */
export function getIntro() {
  return siteConfig.intro?.[currentLang] || siteConfig.intro?.en || [];
}

export function getCurrentLang() {
  return currentLang;
}

/** Register a callback fired after every language change. */
export function onLanguageChange(callback) {
  changeListeners.push(callback);
}

/** Switch the active language. Loads the locale chunk if it isn't cached yet,
 *  then re-applies static translations and notifies listeners. Safe to call
 *  fire-and-forget — the promise resolves when the UI has been updated. */
export async function setLanguage(lang) {
  if (!siteConfig.languages.includes(lang) || lang === currentLang) return;
  await loadLocale(lang);
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
  if (flagEl && meta) flagEl.textContent = meta.flag;
  if (codeEl && meta) codeEl.textContent = meta.code;

  document.documentElement.lang = currentLang;
}

/** Sets up the language switcher dropdown and applies initial translations.
 *  Preloads the user's preferred locale before the first render so first
 *  paint already shows the right language (no English flash). */
export async function initI18n() {
  // Build language buttons from site config (only languages defined for this installation)
  const dropdown = document.getElementById('lang-dropdown');
  if (dropdown) {
    dropdown.innerHTML = siteConfig.languages
      .map(lang => {
        const meta = LANG_META[lang];
        if (!meta) return '';
        return `<a class="lang-option" data-lang="${lang}" href="#">${meta.flag} ${meta.name} (${meta.code})</a>`;
      })
      .join('');
  }

  // Pre-load the user's preferred locale (if non-en) before the first paint so
  // the UI never flashes English text. If the load fails we fall back to en.
  const initial = detectLanguage();
  if (initial !== 'en') {
    try {
      await loadLocale(initial);
      currentLang = initial;
    } catch { /* falls back to en */ }
  }

  applyStaticTranslations();
  document.documentElement.classList.remove('i18n-pending');

  const toggle = document.getElementById('lang-toggle');
  if (!toggle || !dropdown) return;

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!toggle.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  dropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-option');
    if (btn) {
      e.preventDefault();
      setLanguage(btn.dataset.lang);
      dropdown.classList.remove('open');
    }
  });
}
