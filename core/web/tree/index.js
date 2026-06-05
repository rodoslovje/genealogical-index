import { API_BASE_URL } from '../config.js';
import { toUnicodeHref, currentParams } from '../url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import { escapeHtml, ensureD3 } from '../utils.js';
import { authFetch } from '../auth.js';
import { renderD3AncestorsTree } from './ancestors.js';
import { renderD3DescendantsTree } from './descendants.js';

// --- DOM id maps for each variant. The two tree pages re-use the same HTML
// shell with slightly different ids; everything else is shared. -------------

const ANCESTORS_IDS = {
  pageTitle:  'ancestor-page-title',
  container:  'ancestor-tree-container',
  controls:   'ancestor-tree-controls',
  source:     'ancestor-tree-source',
  wrapper:    'ancestor-tree-wrapper',
  zoomIn:     'btn-zoom-in',
  zoomOut:    'btn-zoom-out',
  downloadSvg:'btn-download-svg',
  downloadCsv:'btn-download-csv',
  downloadGed:'btn-download-ged',
};
const DESCENDANTS_IDS = {
  pageTitle:  'descendant-page-title',
  container:  'descendant-tree-container',
  controls:   'descendant-tree-controls',
  source:     'descendant-tree-source',
  wrapper:    'descendant-tree-wrapper',
  zoomIn:     'btn-descendant-zoom-in',
  zoomOut:    'btn-descendant-zoom-out',
  downloadSvg:'btn-descendant-download-svg',
  downloadCsv:'btn-descendant-download-csv',
  downloadGed:'btn-descendant-download-ged',
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function renderAncestorsPage()   { renderTreePage('ancestors'); }
export function renderDescendantsPage() { renderTreePage('descendants'); }

function renderTreePage(kind) {
  const config = kind === 'ancestors'
    ? { ids: ANCESTORS_IDS,   titleKey: 'tree_ancestors_title',   apiPath: 'ancestors',   filePrefix: 'ancestors',   renderTree: renderD3AncestorsTree }
    : { ids: DESCENDANTS_IDS, titleKey: 'tree_descendants_title', apiPath: 'descendants', filePrefix: 'descendants', renderTree: renderD3DescendantsTree };

  const params = currentParams();
  const n = params.get('n') || '';
  const sn = params.get('sn') || '';
  const dob = params.get('dob') || '';
  const c = params.get('c') || '';
  const extId = params.get('id') || '';
  const personName = [n, sn].filter(Boolean).join(' ');

  const titleSuffix = personName ? formatTitleSuffix(t(config.titleKey)) : t(config.titleKey);
  const pageTitle = personName ? `${personName} - ${titleSuffix}` : t(config.titleKey);
  document.getElementById(config.ids.pageTitle).textContent = pageTitle;
  document.title = `${pageTitle} | ${t('site_title')}`;

  const container = document.getElementById(config.ids.container);
  const controls = document.getElementById(config.ids.controls);
  const sourceEl = document.getElementById(config.ids.source);

  const zoomInBtn = document.getElementById(config.ids.zoomIn);
  if (zoomInBtn) { zoomInBtn.innerHTML = '➕'; zoomInBtn.title = t('tree_zoom_in'); }
  const zoomOutBtn = document.getElementById(config.ids.zoomOut);
  if (zoomOutBtn) { zoomOutBtn.innerHTML = '➖'; zoomOutBtn.title = t('tree_zoom_out'); }
  const downloadBtn = document.getElementById(config.ids.downloadSvg);
  if (downloadBtn) downloadBtn.title = t('tree_download_svg');
  const downloadCsvBtn = document.getElementById(config.ids.downloadCsv);
  if (downloadCsvBtn) downloadCsvBtn.title = t('tree_download_csv');
  const downloadGedBtn = document.getElementById(config.ids.downloadGed);
  if (downloadGedBtn) downloadGedBtn.title = t('tree_download_ged');

  controls.style.display = 'none';
  if (sourceEl) sourceEl.style.display = 'none';
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  const apiParams = new URLSearchParams();
  if (n) apiParams.set('n', n);
  if (sn) apiParams.set('sn', sn);
  if (dob) apiParams.set('dob', dob);
  if (c) apiParams.set('c', c);
  if (extId) apiParams.set('id', extId);
  // 0 = all generations (the API stops once the tree is fully expanded). The
  // tree's zoom/minimap handle the larger result, and the CSV/GEDCOM exports
  // then cover the complete tree.
  apiParams.set('max_generations', '0');

  // Kick off D3 load alongside the API call so the script lands while the
  // tree data is in flight; both must resolve before we can render.
  const dataPromise = authFetch(`${API_BASE_URL}/api/${config.apiPath}?${apiParams}`)
      .then(r => r.ok ? r.json() : null);
  const d3Promise   = ensureD3().catch(() => {});

  Promise.all([dataPromise, d3Promise])
    .then(([data]) => {
      container.innerHTML = '';
      if (!data) {
        container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
        return;
      }
      if (typeof d3 === 'undefined') {
        container.innerHTML = `<p style="padding: 20px;">${t('tree_no_d3')}</p>`;
        return;
      }
      controls.style.display = 'flex';
      if (sourceEl && c) {
        sourceEl.innerHTML = `${t('tree_source')}: <a href="${toUnicodeHref({ t: 'contributors', c })}" data-spa-nav>${escapeHtml(c)}</a>`;
        sourceEl.style.display = 'block';
      }
      config.renderTree(data, container, personName, c, config.ids, {
        titleText: personName ? `${personName} - ${titleSuffix}` : t(config.titleKey),
        filePrefix: config.filePrefix,
        criteria: { name: n, surname: sn, dob },
      });
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}
