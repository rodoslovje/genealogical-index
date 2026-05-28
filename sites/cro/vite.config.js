import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import siteConfig from './web/site.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreWeb = path.resolve(__dirname, '../../core/web');

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

function siteTitlePlugin() {
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

export default defineConfig({
  root: coreWeb,
  publicDir: path.resolve(__dirname, 'web/public'),
  resolve: {
    alias: {
      '@site-config': path.resolve(__dirname, 'web/site.config.js'),
    },
  },
  build: {
    // BUILD_VARIANT is set by scripts/build-site.mjs: 'base' or 'premium' for
    // two-variant sites, empty string for single-variant sites. Vite picks up
    // the parent dir if the subdir is empty, so single-variant outputs land
    // in dist/ as before.
    outDir: path.resolve(__dirname, 'dist', process.env.BUILD_VARIANT || ''),
    emptyOutDir: true,
  },
  define: {
    // Inline the variant into client code so site.config.js can branch on
    // it (process.env is not otherwise available in the browser bundle).
    'process.env.BUILD_VARIANT': JSON.stringify(process.env.BUILD_VARIANT || ''),
  },
  server: {
    host: true,
  },
  plugins: [buildInfoPlugin(), siteTitlePlugin()],
});
