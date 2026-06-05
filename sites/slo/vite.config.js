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

function robotsPlugin() {
  // Emit /robots.txt per build variant (BUILD_VARIANT is set by
  // scripts/build-site.mjs). The premium variant is served behind basic auth,
  // but we still disallow everything as defense-in-depth. The public variant
  // ('base', or '' for single-variant sites) stays indexable by search engines
  // while blocking known AI-training crawlers from harvesting the data.
  const AI_BOTS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web',
    'anthropic-ai', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Applebot-Extended',
    'Bytespider', 'Amazonbot', 'Meta-ExternalAgent', 'FacebookBot', 'cohere-ai',
    'Diffbot', 'YouBot', 'ImagesiftBot', 'Omgilibot', 'AI2Bot', 'DuckAssistBot',
  ];
  function generate(variant) {
    if (variant === 'premium') {
      return 'User-agent: *\nDisallow: /\n';
    }
    const aiBlocks = AI_BOTS.map((bot) => `User-agent: ${bot}\nDisallow: /`).join('\n\n');
    return `# AI / LLM crawlers — keep them off the data\n${aiBlocks}\n\n# Everyone else (search engines, etc.) may index\nUser-agent: *\nAllow: /\n`;
  }
  return {
    name: 'robots-txt',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: generate(process.env.BUILD_VARIANT || ''),
      });
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
  plugins: [buildInfoPlugin(), siteTitlePlugin(), robotsPlugin()],
});
