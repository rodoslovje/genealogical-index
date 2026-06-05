import { API_BASE_URL } from '../config.js';
import { currentParams, toUnicodeHref } from '../lib/url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import {
  escapeHtml, ensureD3, highlightDifferences, baseContributorName,
  downloadBlob, formatExportFilename,
} from '../lib/utils.js';
import { authFetch } from '../auth.js';
import { computeBounds, createSvgWithZoom, appendLinks, attachSvgExport } from './shared.js';
import siteConfig from '@site-config';

// Tree comparison view (Phase 2: ancestors + descendants). Superimposes two
// genealogists' trees rooted at a matched person pair into one merged tree,
// each node coloured by its comparison status. A toggle switches direction;
// clicking a node opens a side-by-side field detail with differences
// highlighted; the differences can be exported to CSV. Reuses the layout / zoom
// / minimap / SVG-export chrome from the regular tree views.

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
  downloadCsv: 'btn-compare-download-csv',
};

// Status → swatch colour. Kept in sync with the circle fill in decoratePersons().
const STATUS_COLOR = {
  agree:    '#2e7d32',
  conflict: '#f59e0b',
  only_a:   '#3498db',
  only_b:   '#e8590c',
};

// Fields shown in the side-by-side detail panel and the CSV export, in order.
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
  const dir = params.get('dir') === 'descendants' ? 'descendants' : 'ancestors';
  const ctx = { aId, bId, personName, dir };

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
  const svgBtn = document.getElementById(IDS.downloadSvg);
  if (svgBtn) svgBtn.title = t('tree_download_svg');
  const csvBtn = document.getElementById(IDS.downloadCsv);
  if (csvBtn) { csvBtn.title = t('tree_download_csv'); csvBtn.style.display = 'none'; csvBtn.onclick = null; }

  if (controls) controls.style.display = 'none';
  if (legend) renderLegend(legend, null, ctx);
  if (detail) { detail.innerHTML = ''; detail.style.display = 'none'; }
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  if (!aId || !bId) {
    container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
    return;
  }

  const apiParams = new URLSearchParams({ a_id: aId, b_id: bId, max_generations: '0' });
  const dataPromise = authFetch(`${API_BASE_URL}/api/compare/${dir}?${apiParams}`)
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
      renderLegend(legend, data, ctx);
      renderTree(data, container, detail);
      if (csvBtn) {
        csvBtn.style.display = '';
        csvBtn.onclick = () => exportDifferences(data, ctx);
      }
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

// Direction toggle + legend with status counts. `data` is null while loading
// (the toggle still renders so the user can switch before results arrive).
function renderLegend(legend, data, ctx) {
  if (!legend) return;
  const a = escapeHtml(baseContributorName((data && data.contributor_a) || ''));
  const b = escapeHtml(baseContributorName((data && data.contributor_b) || ''));
  const s = (data && data.summary) || {};

  const toggleLink = (dir, label) => {
    const href = toUnicodeHref({ t: 'compare', a: ctx.aId, b: ctx.bId, pn: ctx.personName, dir });
    const active = ctx.dir === dir ? ' compare-toggle-active' : '';
    return `<a class="compare-toggle-btn${active}" href="${href}" data-spa-nav>${label}</a>`;
  };
  const toggle = `<div class="compare-toggle">
      ${toggleLink('ancestors', t('tree_ancestors_title'))}
      ${toggleLink('descendants', t('tree_descendants_title'))}
    </div>`;

  const swatch = (status, label, count) =>
    `<span class="compare-legend-item">
      <span class="compare-swatch" style="background:${STATUS_COLOR[status]}"></span>
      ${label}${count != null ? ` <strong>(${count})</strong>` : ''}
    </span>`;

  const counts = data ? `<div class="compare-legend-row">
      ${swatch('agree', t('compare_agree'), s.agree)}
      ${swatch('conflict', t('compare_conflict'), s.conflict)}
      ${swatch('only_a', `${t('compare_only_in')} ${a}`, s.only_a)}
      ${swatch('only_b', `${t('compare_only_in')} ${b}`, s.only_b)}
    </div>
    <div class="compare-legend-hint">${t('compare_click_hint')}</div>` : '';

  legend.innerHTML = toggle + counts;
}

function renderTree(data, container, detail) {
  const dx = 120, dy = 250;
  const isDesc = data.direction === 'descendants';

  const root = d3.hierarchy(data.tree, d => isDesc ? d.children : d.parents);
  d3.tree().nodeSize([dx, dy])(root.sort((a, b) => {
    if (isDesc && a.data.is_family && b.data.is_family) return 0;
    const sexOrder = { m: 1, f: 2 };
    const aSex = sexOrder[a.data.sex] || 3;
    const bSex = sexOrder[b.data.sex] || 3;
    if (aSex !== bSex) return aSex - bSex;
    return d3.ascending(a.data.name || '', b.data.name || '');
  }));

  // Descendant trees interleave family nodes between generations; snap each
  // node to its generation column and pull families in towards their parent
  // (mirrors the regular descendants view).
  if (isDesc) {
    root.each(d => {
      let gen = 0, curr = d;
      while (curr.parent) {
        if (!curr.data.is_family) gen++;
        curr = curr.parent;
      }
      if (d.data.is_family) { d.y = gen * dy + 50; d.x = d.x + 35; }
      else { d.y = gen * dy; }
    });
  }

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

  if (isDesc) {
    decorateFamilies(node.filter(d => d.data.is_family));
    decoratePersons(node.filter(d => !d.data.is_family));
  } else {
    decoratePersons(node);
  }
}

// Coloured dot (by status) + name + birth info for a person-node selection.
function decoratePersons(selection) {
  selection.append('circle')
      .attr('fill', d => STATUS_COLOR[d.data.status] || '#999')
      .attr('r', 6);

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

// Marriage glyph (⚭, coloured by family status) + partner / marriage info.
function decorateFamilies(selection) {
  selection.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '16px')
      .attr('fill', d => STATUS_COLOR[d.data.status] || '#999')
      .text('⚭')
    .clone(true).lower()
      .attr('stroke', 'white')
      .attr('stroke-width', 3);

  const info = selection.append('text')
      .attr('dy', '0.3em')
      .attr('x', 14)
      .attr('text-anchor', 'start')
      .attr('font-size', '12px')
      .attr('fill', d => STATUS_COLOR[d.data.status] || '#555');
  info.each(function (d) {
    const el = d3.select(this);
    const p = d.data.partner || {};
    const m = d.data.marriage || {};
    const name = [p.name, p.surname].filter(Boolean).join(' ');
    const date = m.date || '';
    let first = true;
    if (name) { el.append('tspan').attr('x', 14).attr('font-weight', 'bold').text(name); first = false; }
    if (date) { el.append('tspan').attr('x', 14).attr('dy', first ? '0' : '1.2em').text(date); }
  });
  info.clone(true).lower().attr('stroke', 'white');
}

// Side-by-side field comparison for the clicked node, with differing values
// highlighted. only_a / only_b nodes show the single present side. Works for
// both person nodes and family (partner) nodes — both carry `a`/`b`.
function showDetail(detail, node, data) {
  if (!detail) return;
  const a = node.a;
  const b = node.b;
  if (!a && !b) return; // nothing to show (e.g. unknown-partner family)
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

  const partnerTag = node.is_family ? ` <span class="compare-detail-conf">(${t('col_partner')})</span>` : '';

  detail.innerHTML = `
    <div class="compare-detail-head">
      <span class="compare-detail-status">
        <span class="compare-swatch" style="background:${STATUS_COLOR[node.status]}"></span>
        ${escapeHtml(statusText)}${partnerTag}
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

// --- CSV export of the differences ------------------------------------------

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const STATUS_KEY = { agree: 'compare_agree', conflict: 'compare_conflict' };

// One row per person node. Family nodes don't get a row, but crossing one in a
// descendant tree advances the generation; crossing a person does too.
function collectRows(node, gen, rows) {
  if (!node.is_family) {
    rows.push({ gen, node });
  }
  (node.parents || []).forEach(c => collectRows(c, gen + 1, rows));
  (node.children || []).forEach(c => collectRows(c, node.is_family ? gen + 1 : gen, rows));
}

function exportDifferences(data, ctx) {
  const A = baseContributorName(data.contributor_a || '');
  const B = baseContributorName(data.contributor_b || '');

  const rows = [];
  collectRows(data.tree, 0, rows);

  const header = [t('col_generation'), t('col_confidence'), t('compare_status')];
  DETAIL_FIELDS.forEach(([, labelKey]) => {
    header.push(`${t(labelKey)} (${A})`, `${t(labelKey)} (${B})`);
  });
  header.push(t('compare_diff_fields'));

  const statusText = (st) => {
    if (st === 'only_a') return `${t('compare_only_in')} ${A}`;
    if (st === 'only_b') return `${t('compare_only_in')} ${B}`;
    return t(STATUS_KEY[st] || 'compare_agree');
  };

  const lines = [header.map(csvCell).join(',')];
  rows.forEach(({ gen, node }) => {
    const a = node.a || {};
    const b = node.b || {};
    const cells = [gen, node.confidence != null ? Math.round(node.confidence * 100) + '%' : '', statusText(node.status)];
    DETAIL_FIELDS.forEach(([f]) => { cells.push(a[f] || '', b[f] || ''); });
    cells.push((node.field_diffs || []).map(f => t(`col_${f}`)).join('; '));
    lines.push(cells.map(csvCell).join(','));
  });

  const prefix = siteConfig.filePrefix || 'sgi';
  const fname = formatExportFilename(`${prefix}-compare-${ctx.dir}-${ctx.aId}-${ctx.bId}`, 'csv');
  downloadBlob(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), fname);
}
