import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { renderGuideManual } from './web/lib/guide-content.js';
import { mergeChangelog, renderChangelog } from './web/lib/changelog-content.js';

// Shared Vite config for every site. Each sites/<name>/vite.config.js is a thin
// wrapper that calls createSiteConfig() with its own directory and parsed
// site.config.js, so the build and plugin logic lives in exactly one place.
const coreWeb = path.resolve(import.meta.dirname, 'web');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Imports one of the app's own ES modules at build time and returns its
 *  default export, or `fallback` when the file doesn't exist — a language with
 *  no translation yet is an expected state, not a build failure. */
async function importDefault(absPath, fallback) {
  try {
    return (await import(pathToFileURL(absPath).href)).default ?? fallback;
  } catch {
    return fallback;
  }
}

/** UI strings for one language: English underneath, the locale on top. Shared
 *  by the two static-page plugins so they resolve strings identically. */
async function loadStrings(lang) {
  const en = await importDefault(path.resolve(coreWeb, 'i18n/en.js'), {});
  if (lang === 'en') return en;
  const locale = await importDefault(path.resolve(coreWeb, `i18n/${lang}.js`), null);
  return { ...en, ...(locale || {}) };
}

function buildInfoPlugin() {
  // Only BUILD_TIME is baked into the bundle. The data-update date used in the
  // footer is fetched at runtime from /api/contributors/ so an older deployed
  // build still reflects the server's latest contributor import.
  function generate() {
    const buildTime = new Date().toISOString();
    return `export const BUILD_TIME = ${JSON.stringify(buildTime)};\n`;
  }

  return {
    name: 'build-info',
    buildStart() {
      fs.writeFileSync(path.resolve(coreWeb, 'build-info.js'), generate());
    },
  };
}

function siteTitlePlugin(siteConfig) {
  const lang = siteConfig.defaultLang || 'en';
  const nativeTitle = (siteConfig.i18n?.[lang] ?? siteConfig.i18n?.en)?.site_title ?? 'Genealogical Index';
  const enTitle = siteConfig.i18n?.en?.site_title;
  const siteTitle = (enTitle && lang !== 'en') ? `${nativeTitle} - ${enTitle}` : nativeTitle;
  return {
    name: 'site-title',
    transformIndexHtml(html, ctx) {
      // guide.html gets its own title/og tag from guidePagePlugin below.
      if (ctx?.path?.endsWith('guide.html')) return html;
      return html
        .replace(/<title>[^<]*<\/title>/, `<title>${siteTitle}</title>`)
        .replace('/__SITE_LOGO__', () => siteConfig.logo)
        .replace('</head>', `  <meta property="og:title" content="${siteTitle}" />\n  </head>`);
    },
  };
}

// Renders guide.html as a real static page (own URL, <title>, meta
// description, and the manual's actual text in the initial HTML) instead of
// only living inside the in-app JS-injected modal — see help.js. Content is
// rendered once at build time in the site's default language, reusing the
// same renderGuideManual() helper the modal uses at runtime.
function guidePagePlugin(siteConfig) {
  const lang = siteConfig.defaultLang || 'en';
  const nativeTitle = (siteConfig.i18n?.[lang] ?? siteConfig.i18n?.en)?.site_title ?? 'Genealogical Index';
  const nativeOrg = (siteConfig.i18n?.[lang] ?? siteConfig.i18n?.en)?.society_name ?? '';

  return {
    name: 'guide-page',
    async transformIndexHtml(html, ctx) {
      if (!ctx?.path?.endsWith('guide.html')) return html;

      const strings = await loadStrings(lang);
      const content = renderGuideManual(strings, !!siteConfig.authUrl, siteConfig);

      const guideLabel = strings.footer_user_guide || 'User Guide';
      const title = `${guideLabel} – ${nativeTitle}`;
      const description = escapeHtml(
        content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      );

      // Function replacers throughout: the substituted strings (translated
      // content especially) may contain literal "$" sequences that String.replace
      // would otherwise interpret as $&/$1/$<name> substitution patterns.
      return html
        .replace('<html lang="en">', () => `<html lang="${lang}">`)
        .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
        .replace('__GUIDE_DESCRIPTION__', () => description)
        .replace('/__GUIDE_LOGO__', () => siteConfig.logo)
        .replace('__GUIDE_SITE_TITLE__', () => escapeHtml(nativeTitle))
        .replace('__GUIDE_ORG_NAME__', () => escapeHtml(nativeOrg))
        .replace('__GUIDE_BACK_LABEL__', () => escapeHtml(nativeTitle))
        .replace('__GUIDE_TAB_GENERAL__', () => escapeHtml(strings.tab_search || 'Search'))
        .replace('__GUIDE_TAB_PERSON__', () => escapeHtml(strings.tab_person || 'Person'))
        .replace('__GUIDE_TAB_FAMILY__', () => escapeHtml(strings.tab_family || 'Family'))
        .replace('__GUIDE_TAB_CONTRIBUTORS__', () => escapeHtml(strings.tab_contributors || 'Genealogists'))
        .replace('__GUIDE_CONTENT__', () => content)
        .replace('</head>', () => `  <meta property="og:title" content="${escapeHtml(title)}" />\n  </head>`);
    },
  };
}

// Static /changelog page, built the same way as /guide: rendered at build time
// in the site's default language (so it is crawlable and works without JS),
// then switched to the visitor's own language client-side by page-lang.js.
function changelogPagePlugin(siteConfig) {
  const lang = siteConfig.defaultLang || 'en';
  const nativeTitle = (siteConfig.i18n?.[lang] ?? siteConfig.i18n?.en)?.site_title ?? 'Genealogical Index';
  const nativeOrg = (siteConfig.i18n?.[lang] ?? siteConfig.i18n?.en)?.society_name ?? '';

  return {
    name: 'changelog-page',
    async transformIndexHtml(html, ctx) {
      if (!ctx?.path?.endsWith('changelog.html')) return html;

      const strings = await loadStrings(lang);
      // English is the source of record; a translation that lags behind falls
      // back to it per entry (mergeChangelog), so the newest release always
      // shows even before it has been translated.
      const enEntries = await importDefault(path.resolve(coreWeb, 'changelog/en.js'), []);
      const translated = lang === 'en'
        ? null
        : await importDefault(path.resolve(coreWeb, `changelog/${lang}.js`), null);
      const content = renderChangelog(mergeChangelog(enEntries, translated), strings);

      const label = strings.footer_changelog || 'Changelog';
      const title = `${label} – ${nativeTitle}`;
      const description = escapeHtml(
        content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      );

      // Function replacers throughout: see guidePagePlugin.
      return html
        .replace('<html lang="en">', () => `<html lang="${lang}">`)
        .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
        .replace('__CHANGELOG_DESCRIPTION__', () => description)
        .replace('/__CHANGELOG_LOGO__', () => siteConfig.logo)
        .replace('__CHANGELOG_SITE_TITLE__', () => escapeHtml(nativeTitle))
        .replace('__CHANGELOG_ORG_NAME__', () => escapeHtml(nativeOrg))
        .replace('__CHANGELOG_BACK_LABEL__', () => escapeHtml(nativeTitle))
        .replace('__CHANGELOG_TAB_GENERAL__', () => escapeHtml(strings.tab_search || 'Search'))
        .replace('__CHANGELOG_TAB_PERSON__', () => escapeHtml(strings.tab_person || 'Person'))
        .replace('__CHANGELOG_TAB_FAMILY__', () => escapeHtml(strings.tab_family || 'Family'))
        .replace('__CHANGELOG_TAB_CONTRIBUTORS__', () => escapeHtml(strings.tab_contributors || 'Genealogists'))
        .replace('__CHANGELOG_CONTENT__', () => content)
        .replace('</head>', () => `  <meta property="og:title" content="${escapeHtml(title)}" />\n  </head>`);
    },
  };
}

export function createSiteConfig(siteDir, siteConfig) {
  return defineConfig({
    root: coreWeb,
    publicDir: path.resolve(siteDir, 'web/public'),
    resolve: {
      alias: {
        '@site-config': path.resolve(siteDir, 'web/site.config.js'),
      },
    },
    build: {
      outDir: path.resolve(siteDir, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(coreWeb, 'index.html'),
          guide: path.resolve(coreWeb, 'guide.html'),
          changelog: path.resolve(coreWeb, 'changelog.html'),
        },
      },
    },
    server: {
      host: true,
    },
    plugins: [
      buildInfoPlugin(),
      siteTitlePlugin(siteConfig),
      guidePagePlugin(siteConfig),
      changelogPagePlugin(siteConfig),
    ],
  });
}
