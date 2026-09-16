import siteConfig from '@site-config';
import { renderGuideManual } from './lib/guide-content.js';
import { mergeChangelog, renderChangelog } from './lib/changelog-content.js';

// Shared by the two standalone pages (guide.html, changelog.html), which are
// rendered at build time in the site's default language so that crawlers and
// no-JS visitors get real content. This script runs after that and, when the
// visitor reads the site in another language, swaps the page over to it.
//
// Language is taken from ?lang= (which is what the in-app links pass, so a
// reader always lands in the language they were just reading) and otherwise
// from the preference the app stores. Anything not offered by this site, or
// already the language baked into the page, is left alone.

const LOCALES = import.meta.glob('./i18n/*.js', { import: 'default' });
const CHANGELOGS = import.meta.glob('./changelog/*.js', { import: 'default' });

/** The language to show: explicit ?lang= → the app's saved preference →
 *  whatever the page was built in. Never a language this site doesn't offer. */
function wantedLang(baked) {
  const allowed = siteConfig.languages || [];
  const asked = new URLSearchParams(window.location.search).get('lang');
  if (asked && allowed.includes(asked)) return asked;
  try {
    const saved = localStorage.getItem('sgi-lang');
    if (saved && allowed.includes(saved)) return saved;
  } catch {
    // Private mode / blocked storage: fall through to the baked language.
  }
  return baked;
}

/** Loads one globbed module, or null when it doesn't exist or fails — a locale
 *  or a changelog translation that hasn't been written yet is an expected
 *  state, not an error, and each caller falls back to English. */
async function load(map, key) {
  const loader = map[key];
  if (!loader) return null;
  try {
    return await loader();
  } catch (err) {
    console.warn(`Could not load ${key}, falling back to English.`, err);
    return null;
  }
}

/** Site overrides (site_title, society_name, intro text) beat the locale, the
 *  same precedence t() applies in the app. */
function stringsFor(lang, locale, en) {
  return { ...en, ...(locale || {}), ...(siteConfig.i18n?.[lang] || {}) };
}

// Translates the navbar tab labels and the browser-tab title, which the build
// also filled in in the default language.
function retitle(strings, pageTitleKey, fallbackTitle) {
  const labels = [
    strings.tab_search, strings.tab_person, strings.tab_family, strings.tab_contributors,
  ];
  document.querySelectorAll('.srd-nav-tabs .tab-btn').forEach((el, i) => {
    if (labels[i]) el.textContent = labels[i];
  });
  const pageTitle = strings[pageTitleKey] || fallbackTitle;
  const site = strings.site_title || '';
  document.title = site ? `${pageTitle} – ${site}` : pageTitle;
}

/** The footer's version label and its link to the sibling page were filled in
 *  at build time in the default language; this moves them over with the rest of
 *  the page. The link also carries ?lang= so the sibling opens in the language
 *  being read, exactly as the in-app footer links do (help.js). */
function refooter(strings, lang) {
  const label = document.getElementById('footer-version-label');
  if (label && strings.footer_version) label.textContent = strings.footer_version;

  const sibling = document.getElementById('footer-sibling-link');
  if (!sibling) return;
  const isGuide = sibling.dataset.page === 'guide';
  const text = isGuide ? strings.footer_user_guide : strings.footer_changelog;
  if (text) sibling.textContent = text;
  sibling.href = `/${isGuide ? 'guide' : 'changelog'}?lang=${encodeURIComponent(lang)}`;
}

async function main() {
  const baked = document.documentElement.lang || 'en';
  const lang = wantedLang(baked);

  const guideEl = document.getElementById('guide-page-content');
  const changelogEl = document.getElementById('changelog-content');
  if (!guideEl && !changelogEl) return;

  // The English modules are the fallback for everything, so they are always
  // needed; the target locale only when it isn't English.
  const en = await load(LOCALES, './i18n/en.js');
  const locale = lang === 'en' ? en : await load(LOCALES, `./i18n/${lang}.js`);
  const strings = stringsFor(lang, locale, en);

  if (guideEl) {
    retitle(strings, 'footer_user_guide', 'User Guide');
    refooter(strings, lang);
    document.documentElement.lang = lang;
    guideEl.innerHTML = renderGuideManual(strings, !!siteConfig.authUrl, siteConfig);
    return;
  }

  const enEntries = await load(CHANGELOGS, './changelog/en.js');
  const translated = lang === 'en' ? null : await load(CHANGELOGS, `./changelog/${lang}.js`);
  retitle(strings, 'footer_changelog', 'Changelog');
  refooter(strings, lang);
  document.documentElement.lang = lang;
  changelogEl.innerHTML = renderChangelog(mergeChangelog(enEntries, translated), strings);
}

main().catch(err => console.warn('Could not switch page language.', err));
