import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// Shared Vite config for every site. Each sites/<name>/vite.config.js is a thin
// wrapper that calls createSiteConfig() with its own directory and parsed
// site.config.js, so the build and plugin logic lives in exactly one place.
const coreWeb = path.resolve(import.meta.dirname, 'web');

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
    transformIndexHtml(html) {
      return html
        .replace(/<title>[^<]*<\/title>/, `<title>${siteTitle}</title>`)
        .replace('</head>', `  <meta property="og:title" content="${siteTitle}" />\n  </head>`);
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
    },
    server: {
      host: true,
    },
    plugins: [buildInfoPlugin(), siteTitlePlugin(siteConfig)],
  });
}
