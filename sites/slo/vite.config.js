import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import siteConfig from './web/site.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreWeb = path.resolve(__dirname, '../../core/web');

function buildInfoPlugin() {
  function generate() {
    const buildTime = new Date().toISOString();
    let dataUpdated = buildTime;
    try {
      const metaPath = path.resolve(__dirname, '../../data/metadata.json');
      dataUpdated = fs.statSync(metaPath).mtime.toISOString();
    } catch { /* fall back to build time */ }
    return `export const BUILD_TIME = ${JSON.stringify(buildTime)};\nexport const DATA_UPDATED = ${JSON.stringify(dataUpdated)};\n`;
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
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: true,
  },
  plugins: [buildInfoPlugin(), siteTitlePlugin()],
});
