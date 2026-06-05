import { API_BASE_URL } from '../config.js';
import { currentParams, toUnicodeHref } from '../lib/url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import { escapeHtml, ensureD3, highlightDifferences, baseContributorName } from '../lib/utils.js';
import { authFetch } from '../auth.js';
import { computeBounds, createSvgWithZoom, appendLinks, attachSvgExport } from './shared.js';

// Tree comparison view (Phase 1: ancestors). Superimposes two genealogists'
// ancestor trees rooted at a matched person pair into one merged tree, each
// node coloured by its comparison status. Clicking a node opens a side-by-side
// field detail with the differences highlighted. Reuses the layout/zoom/minimap
// and SVG-export chrome from the regular tree views.

const IDS = {
  pageTitle:   'compare-page-title',
  container:   'compare-tree-container',
  controls:    'compare-tree-controls',
  legend:      'compare-legend',
  detail:      'compare-detail-panel',
  wrapper:     'compare-tree-wrapper',
  zoomIn:      'btn-compare-zoom-in',
  zoomOut:     'btn-compare-zoom-out',
  downloadSvg: 'btn-compare-download-svg',
};

// Status → swatch colour. Kept in sync with the circle fill in decorate().
const STATUS_COLOR = {
  agree:    '#2e7d32',
  conflict: '#f59e0b',
  only_a:   '#3498db',
  only_b:   '#e8590c',
};

// Fields shown in the side-by-side detail panel, in display order.
const DETAIL_FIELDS = [
  ['name',            'col_name'],
  ['surname',         'col_surname'],
  ['date_of_birth',   'col_date_of_birth'],
  ['place_of_birth',  'col_place_of_birth'],
  ['date_of_baptism', 'col_date_of_baptism'],
  ['place_of_baptism','col_place_of_baptism'],
  ['date_of_death',   'col_date_of_death'],
  ['place_of_death',  'col_place_of_death'],
];

export function renderComparePage() {
  const params = currentParams();
  const aId = params.get('a') || '';
  const bId = params.get('b') || '';
  const personName = params.get('pn') || '';

  const titleSuffix = formatTitleSuffix(t('compare_title'));
  const pageTitle = personName ? `${personName} - ${titleSuffix}` : t('compare_title');
  const titleEl = document.getElementById(IDS.pageTitle);
  if (titleEl) titleEl.textContent = pageTitle;
  document.title = `${pageTitle} | ${t('site_title')}`;

  const container = document.getElementById(IDS.container);
  const controls = document.getElementById(IDS.controls);
  const legend = document.getElementById(IDS.legend);
  const detail = document.getElementById(IDS.detail);

  const zoomInBtn = document.getElementById(IDS.zoomIn);
  if (zoomInBtn) { zoomInBtn.innerHTML = '➕'; zoomInBtn.title = t('tree_zoom_in'); }
  const zoomOutBtn = document.getElementById(IDS.zoomOut);
  if (zoomOutBtn) { zoomOutBtn.innerHTML = '➖'; zoomOutBtn.title = t('tree_zoom_out'); }
  const downloadBtn = document.getElementById(IDS.downloadSvg);
  if (downloadBtn) downloadBtn.title = t('tree_download_svg');

  if (controls) controls.style.display = 'none';
  if (legend) legend.innerHTML = '';
  if (detail) { detail.innerHTML = ''; detail.style.display = 'none'; }
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  if (!aId || !bId) {
    container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
    return;
  }

  const apiParams = new URLSearchParams({ a_id: aId, b_id: bId, max_generations: '0' });
  const dataPromise = authFetch(`${API_BASE_URL}/api/compare/ancestors?${apiParams}`)
      .then(r => r.ok ? r.json() : null);
  const d3Promise = ensureD3().catch(() => {});

  Promise.all([dataPromise, d3Promise])
    .then(([data]) => {
      container.innerHTML = '';
      if (!data || !data.tree) {
        container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
        return;
      }
      if (typeof d3 === 'undefined') {
        container.innerHTML = `<p style="padding: 20px;">${t('tree_no_d3')}</p>`;
        return;
      }
      if (controls) controls.style.display = 'flex';
      renderLegend(legend, data);
      renderTree(data, container, detail);
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

// Legend + status counts header, plus which colour belongs to which genealogist.
function renderLegend(legend, data) {
  if (!legend) return;
  const a = escapeHtml(baseContributorName(data.contributor_a || ''));
  const b = escapeHtml(baseContributorName(data.contributor_b || ''));
  const s = data.summary || {};
  const swatch = (status, label, count) =>
    `<span class="compare-legend-item">
      <span class="compare-swatch" style="background:${STATUS_COLOR[status]}"></span>
      ${label}${count != null ? ` <strong>(${count})</strong>` : ''}
    </span>`;
  legend.innerHTML = `
    <div class="compare-legend-row">
      ${swatch('agree', t('compare_agree'), s.agree)}
      ${swatch('conflict', t('compare_conflict'), s.conflict)}
      ${swatch('only_a', `${t('compare_only_in')} ${a}`, s.only_a)}
      ${swatch('only_b', `${t('compare_only_in')} ${b}`, s.only_b)}
    </div>
    <div class="compare-legend-hint">${t('compare_click_hint')}</div>`;
}

function renderTree(data, container, detail) {
  const dx = 120, dy = 250;

  const root = d3.hierarchy(data.tree, d => d.parents);
  d3.tree().nodeSize([dx, dy])(root.sort((a, b) => {
    const sexOrder = { m: 1, f: 2 };
    const aSex = sexOrder[a.data.sex] || 3;
    const bSex = sexOrder[b.data.sex] || 3;
    if (aSex !== bSex) return aSex - bSex;
    return d3.ascending(a.data.name || '', b.data.name || '');
  }));

  const bounds = computeBounds(root, dx, dy);
  const { svg, g } = createSvgWithZoom(container, bounds, root, IDS);

  attachSvgExport({
    svg, g, downloadBtnId: IDS.downloadSvg,
    data: data.tree, personName: data.tree.name || '',
    contributorName: data.contributor_a || '',
    titleText: t('compare_title'),
    filePrefix: 'compare',
  });

  appendLinks(g, root);

  const node = g.append('g')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-width', 3)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`)
      .attr('cursor', 'pointer')
      .on('click', (event, d) => showDetail(detail, d.data, data));

  decorate(node);
}

// Coloured dot (by status) + name + birth info; a small ⚠ on conflict nodes.
function decorate(selection) {
  selection.append('circle')
      .attr('fill', d => STATUS_COLOR[d.data.status] || '#999')
      .attr('r', 6);

  selection.filter(d => d.data.status === 'conflict')
    .append('text')
      .attr('x', 10).attr('y', -6)
      .attr('font-size', '13px')
      .text('⚠');

  const nameText = selection.append('text')
      .attr('dy', '-0.8em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('font-weight', 'bold')
      .attr('fill', d => STATUS_COLOR[d.data.status] || '#333')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '));
  nameText.clone(true).lower().attr('stroke', 'white');

  const infoText = selection.append('text')
      .attr('dy', '1.4em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '12px');
  infoText.each(function (d) {
    const el = d3.select(this);
    const b = d.data.date_of_birth || '';
    const p = d.data.place_of_birth ? d.data.place_of_birth.split(',')[0].trim() : '';
    if (b) el.append('tspan').attr('x', 0).text(b);
    if (p) el.append('tspan').attr('x', 0).attr('dy', b ? '1.2em' : '0').text(p);
  });
  infoText.clone(true).lower().attr('stroke', 'white');
}

// Side-by-side field comparison for the clicked node, with differing values
// highlighted. only_a / only_b nodes show the single present side.
function showDetail(detail, node, data) {
  if (!detail) return;
  const a = node.a;
  const b = node.b;
  const aName = escapeHtml(baseContributorName(data.contributor_a || ''));
  const bName = escapeHtml(baseContributorName(data.contributor_b || ''));
  const diffs = new Set(node.field_diffs || []);

  let statusText;
  if (node.status === 'only_a') statusText = `${t('compare_only_in')} ${aName}`;
  else if (node.status === 'only_b') statusText = `${t('compare_only_in')} ${bName}`;
  else statusText = t(node.status === 'conflict' ? 'compare_conflict' : 'compare_agree');

  const rows = DETAIL_FIELDS.map(([f, labelKey]) => {
    const va = a ? (a[f] || '') : '';
    const vb = b ? (b[f] || '') : '';
    if (!va && !vb) return '';
    const aCell = (a && b && diffs.has(f)) ? highlightDifferences(va, vb) : escapeHtml(va);
    const bCell = (a && b && diffs.has(f)) ? highlightDifferences(vb, va) : escapeHtml(vb);
    return `<tr><th>${t(labelKey)}</th><td>${aCell}</td><td>${bCell}</td></tr>`;
  }).join('');

  const conf = node.confidence != null
    ? `<span class="compare-detail-conf">${t('col_confidence')}: <strong>${Math.round(node.confidence * 100)}%</strong></span>`
    : '';

  detail.innerHTML = `
    <div class="compare-detail-head">
      <span class="compare-detail-status">
        <span class="compare-swatch" style="background:${STATUS_COLOR[node.status]}"></span>
        ${escapeHtml(statusText)}
      </span>
      ${conf}
      <button type="button" class="compare-detail-close" title="${t('collapse_all')}">&times;</button>
    </div>
    <table class="compare-detail-table">
      <thead><tr><th></th><th>${aName}</th><th>${bName}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  detail.style.display = 'block';
  detail.querySelector('.compare-detail-close')?.addEventListener('click', () => {
    detail.style.display = 'none';
  });
}
