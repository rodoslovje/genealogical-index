import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { renderGuideManual } from './web/lib/guide-content.js';

// Shared Vite config for every site. Each sites/<name>/vite.config.js is a thin
// wrapper that calls createSiteConfig() with its own directory and parsed
// site.config.js, so the build and plugin logic lives in exactly one place.
const coreWeb = path.resolve(import.meta.dirname, 'web');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

      const en = (await import(pathToFileURL(path.resolve(coreWeb, 'i18n/en.js')).href)).default;
      const locale = lang === 'en' ? null : await import(pathToFileURL(path.resolve(coreWeb, `i18n/${lang}.js`)).href)
        .then(m => m.default)
        .catch(() => null);
      const strings = { ...en, ...(locale || {}) };
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
        },
      },
    },
    server: {
      host: true,
    },
    plugins: [buildInfoPlugin(), siteTitlePlugin(siteConfig), guidePagePlugin(siteConfig)],
  });
}
