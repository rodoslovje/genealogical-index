import { API_BASE_URL } from '../config.js';
import { currentParams, toUnicodeHref } from '../lib/url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import {
  escapeHtml, ensureD3, highlightDifferences, baseContributorName,
  formatExportFilename, isPrivate,
} from '../lib/utils.js';
import { csvCell, csvRow, csvFooter, downloadCsv } from '../lib/csv.js';
import { formatLinks } from '../lib/links.js';
import { authFetch } from '../auth.js';
import { computeBounds, createSvgWithZoom, appendLinks, attachSvgExport } from './shared.js';

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
// `minor` = secondary fields differ (amber); `conflict` = an identity field
// (name/surname/birth date) differs, so it may not be the same person (red).
const STATUS_COLOR = {
  agree:    '#2e7d32',
  minor:    '#f5a623',
  conflict: '#d32f2f',
  only_a:   '#0097a7',  // teal
  only_b:   '#8e44ad',  // purple
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

const collator = new Intl.Collator('sl', { sensitivity: 'base' });

// Last rendered comparison, kept so a language switch can re-translate the
// chrome/legend/detail in place (no re-fetch, no tree rebuild → view preserved).
let compareState = null;     // { data, ctx, view, detail }
let openDetailNode = null;   // merged node whose detail panel is currently open

// Close any open legend "jump to person" list on an outside click or Escape.
// Chips and list items stop propagation on their own clicks, so this only fires
// for genuine outside interactions. Registered once at module load.
const closeCompareLists = () =>
  document.querySelectorAll('.compare-list').forEach(dd => { dd.style.display = 'none'; });
document.addEventListener('click', closeCompareLists);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCompareLists(); });

// Title string, mirroring the match page by including the genealogist pair
// ("A × B") once the data has loaded; before then it's just the person.
function compareTitleText(ctx, data) {
  const suffix = formatTitleSuffix(t('compare_title'));
  const pair = data
    ? `${baseContributorName(data.contributor_a || '')} × ${baseContributorName(data.contributor_b || '')}`
    : '';
  const base = ctx.personName ? `${ctx.personName} - ${suffix}` : t('compare_title');
  return pair ? `${base} - ${pair}` : base;
}

// Page heading + browser-tab title.
function setCompareTitle(ctx, data) {
  const pageTitle = compareTitleText(ctx, data);
  const titleEl = document.getElementById(IDS.pageTitle);
  if (titleEl) titleEl.textContent = pageTitle;
  document.title = `${pageTitle} | ${t('site_title')}`;
}

export function renderComparePage() {
  const params = currentParams();
  // Each side is a stable (contributor, ext_id) pair: ca/a for A, cb/b for B.
  const ca = params.get('ca') || '';
  const a = params.get('a') || '';
  const cb = params.get('cb') || '';
  const b = params.get('b') || '';
  const personName = params.get('pn') || '';
  const dir = params.get('dir') === 'descendants' ? 'descendants' : 'ancestors';
  const ctx = { ca, a, cb, b, personName, dir };

  setCompareTitle(ctx, null);

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
  compareState = null;
  openDetailNode = null;
  // The minimap lives in the wrapper (sibling of the container), so clearing the
  // container alone leaves a stale minimap behind when the new direction has no
  // results and never re-runs createSvgWithZoom. Remove it up front.
  document.getElementById(IDS.wrapper)
    ?.querySelectorAll('.tree-minimap').forEach(el => el.remove());
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  if (!ca || !a || !cb || !b) {
    container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
    return;
  }

  const apiParams = new URLSearchParams({ ca, a, cb, b, max_generations: '0' });
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
      setCompareTitle(ctx, data);
      renderLegend(legend, data, ctx);
      const view = renderTree(data, container, detail, ctx);
      wireLegendList(legend, view, detail, data);
      compareState = { data, ctx, view, detail };
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

// Re-translate the compare view in place after a language switch — without
// re-fetching or rebuilding the D3 tree, so the current zoom/pan is preserved.
// Covers the page title, control tooltips, the legend + jump-to-person list,
// and any open differences panel. No-op until a comparison has loaded.
export function relocalizeCompare() {
  if (!compareState) return;
  const { data, ctx, view, detail } = compareState;

  setCompareTitle(ctx, data);

  const setTitle = (id, key) => { const el = document.getElementById(id); if (el) el.title = t(key); };
  setTitle(IDS.zoomIn, 'tree_zoom_in');
  setTitle(IDS.zoomOut, 'tree_zoom_out');
  setTitle(IDS.downloadSvg, 'tree_download_svg');
  setTitle(IDS.downloadCsv, 'tree_download_csv');

  const legend = document.getElementById(IDS.legend);
  renderLegend(legend, data, ctx);
  wireLegendList(legend, view, detail, data);

  if (openDetailNode && detail) showDetail(detail, openDetailNode, data);
}

// Direction toggle + legend with status counts. `data` is null while loading
// (the toggle still renders so the user can switch before results arrive).
function renderLegend(legend, data, ctx) {
  if (!legend) return;
  const a = escapeHtml(baseContributorName((data && data.contributor_a) || ''));
  const b = escapeHtml(baseContributorName((data && data.contributor_b) || ''));
  const s = (data && data.summary) || {};

  const toggleLink = (dir, label) => {
    const href = toUnicodeHref({
      t: 'compare', ca: ctx.ca, a: ctx.a, cb: ctx.cb, b: ctx.b, pn: ctx.personName, dir,
    });
    const active = ctx.dir === dir ? ' compare-toggle-active' : '';
    return `<a class="compare-toggle-btn${active}" href="${href}" data-spa-nav>${label}</a>`;
  };
  const toggle = `<div class="compare-toggle">
      ${toggleLink('ancestors', t('tree_ancestors_title'))}
      ${toggleLink('descendants', t('tree_descendants_title'))}
    </div>`;

  // Groups with people are clickable dropdowns (jump-to-person); a pill outline
  // + caret signals that, empty groups stay plain text.
  const swatch = (status, label, count) => {
    const clickable = typeof count === 'number' && count > 0;
    const cls = 'compare-legend-item' + (clickable ? ' compare-legend-clickable' : '');
    const caret = clickable ? '<span class="compare-caret">▾</span>' : '';
    return `<span class="${cls}" data-compare-status="${status}">
      <span class="compare-swatch" style="background:${STATUS_COLOR[status]}"></span>
      ${label}${count != null ? ` <strong>(${count})</strong>` : ''}${caret}
    </span>`;
  };

  const counts = data ? `<div class="compare-legend-row">
      ${swatch('agree', t('compare_agree'), s.agree)}
      ${swatch('minor', t('compare_minor'), s.minor)}
      ${swatch('conflict', t('compare_conflict'), s.conflict)}
      ${swatch('only_a', `${t('compare_only_in')} ${a}`, s.only_a)}
      ${swatch('only_b', `${t('compare_only_in')} ${b}`, s.only_b)}
    </div>` : '';

  legend.innerHTML = toggle + counts;
}

// Make each legend status chip clickable: it opens a dropdown listing that
// group's people; choosing one pans the diagram to that node, pulses it, and
// closes the list. `view` is renderTree's { root, panToNode, highlightNode }.
function wireLegendList(legend, view, detail, data) {
  if (!legend || !view) return;
  const { root, panToNode, highlightNode } = view;

  const byStatus = {};
  root.descendants().forEach(d => {
    if (d.data.is_family) return;
    (byStatus[d.data.status] ||= []).push(d);
  });

  legend.style.position = 'relative';
  let dropdown = legend.querySelector('.compare-list');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'compare-list';
    dropdown.addEventListener('click', (e) => e.stopPropagation());
    legend.appendChild(dropdown);
  }
  dropdown.style.display = 'none';
  const close = () => { dropdown.style.display = 'none'; dropdown.dataset.status = ''; };

  const fullName = d => [d.data.surname, d.data.name].filter(Boolean).join(' ');
  const isPriv = d => isPrivate(d.data.name) || isPrivate(d.data.surname);

  legend.querySelectorAll('.compare-legend-item[data-compare-status]').forEach(item => {
    const status = item.dataset.compareStatus;
    const nodes = (byStatus[status] || []).slice().sort((a, b) => {
      // Private records sink to the bottom; the rest sort by surname then name.
      const pa = isPriv(a), pb = isPriv(b);
      if (pa !== pb) return pa ? 1 : -1;
      return collator.compare(fullName(a), fullName(b));
    });
    if (!nodes.length) return;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.style.display !== 'none' && dropdown.dataset.status === status) { close(); return; }

      dropdown.innerHTML = nodes.map((d, i) => {
        const label = [d.data.name, d.data.surname].filter(Boolean).join(' ') || '?';
        const dob = d.data.date_of_birth
          ? `<span class="compare-list-dob">${escapeHtml(d.data.date_of_birth)}</span>` : '';
        return `<button type="button" class="compare-list-item" data-idx="${i}"><span class="compare-list-name">${escapeHtml(label)}</span>${dob}</button>`;
      }).join('');
      dropdown.dataset.status = status;
      // Anchor under the chip, clamped so a right-edge chip's list stays on-screen.
      dropdown.style.left = Math.max(0, Math.min(item.offsetLeft, legend.clientWidth - 280)) + 'px';
      dropdown.style.top = (item.offsetTop + item.offsetHeight + 6) + 'px';
      dropdown.style.display = 'block';
      dropdown.scrollTop = 0;

      dropdown.querySelectorAll('.compare-list-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const d = nodes[+btn.dataset.idx];
          panToNode(d);
          highlightNode(d);
          showDetail(detail, d.data, data);
          close();
        });
      });
    });
  });
}

function renderTree(data, container, detail, ctx) {
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
  // Colour the minimap dots/rings by comparison status (not sex) so the overview
  // matches the main view's agree/minor/conflict/only-A/only-B palette.
  const { svg, g, panToNode } = createSvgWithZoom(container, bounds, root, IDS, {
    nodeColor: d => STATUS_COLOR[d.data.status] || '#999',
  });

  attachSvgExport({
    svg, g, downloadBtnId: IDS.downloadSvg,
    data: data.tree,
    personName: (ctx && ctx.personName) || data.tree.name || '',
    contributorName: data.contributor_a || '',
    // Both genealogists in the footer "Source:" line, each linked to its
    // contributor page.
    sourceContributors: [
      baseContributorName(data.contributor_a || ''),
      baseContributorName(data.contributor_b || ''),
    ],
    titleText: compareTitleText(ctx || {}, data),
    filePrefix: `compare-${data.direction}`,
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

  // Briefly pulse a ring around a node so the user spots where the view jumped.
  function highlightNode(d) {
    node.filter(x => x === d).each(function () {
      const ring = d3.select(this).append('circle')
          .attr('r', 9).attr('fill', 'none')
          .attr('stroke', '#222').attr('stroke-width', 2.5).attr('opacity', 0.9);
      ring.transition().duration(1300).attr('r', 26).attr('opacity', 0).remove();
    });
  }

  return { root, panToNode, highlightNode };
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
  else statusText = t(STATUS_KEY[node.status] || 'compare_agree');

  const rows = DETAIL_FIELDS.map(([f, labelKey]) => {
    const va = a ? (a[f] || '') : '';
    const vb = b ? (b[f] || '') : '';
    if (!va && !vb) return '';
    const aCell = (a && b && diffs.has(f)) ? highlightDifferences(va, vb) : escapeHtml(va);
    const bCell = (a && b && diffs.has(f)) ? highlightDifferences(vb, va) : escapeHtml(vb);
    return `<tr><th>${t(labelKey)}</th><td>${aCell}</td><td>${bCell}</td></tr>`;
  }).join('');

  // Source-document links as icons, each side highlighting the links the other
  // lacks (formatLinks does the diffing). Shown only when a side has any.
  const aLinks = formatLinks(a ? a.links : [], b ? b.links : []);
  const bLinks = formatLinks(b ? b.links : [], a ? a.links : []);
  const linksRow = (aLinks || bLinks)
    ? `<tr><th>${t('col_links')}</th><td class="compare-detail-links">${aLinks}</td><td class="compare-detail-links">${bLinks}</td></tr>`
    : '';

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
      <tbody>${rows}${linksRow}</tbody>
    </table>`;
  detail.style.display = 'block';
  openDetailNode = node;  // remembered so a language switch can re-render it
  detail.querySelector('.compare-detail-close')?.addEventListener('click', () => {
    detail.style.display = 'none';
    openDetailNode = null;
  });
}

// --- CSV export of the differences ------------------------------------------

const STATUS_KEY = { agree: 'compare_agree', minor: 'compare_minor', conflict: 'compare_conflict' };
// CSV sort order for the status column (matches the legend order).
const STATUS_ORDER = { agree: 0, minor: 1, conflict: 2, only_a: 3, only_b: 4 };

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
  // Sort by generation, then by status (legend order); the stable sort keeps the
  // tree's natural within-group order.
  rows.sort((x, y) =>
    (x.gen - y.gen) ||
    ((STATUS_ORDER[x.node.status] ?? 9) - (STATUS_ORDER[y.node.status] ?? 9)));

  const header = [t('col_generation'), t('col_confidence'), t('compare_status')];
  DETAIL_FIELDS.forEach(([, labelKey]) => {
    header.push(`${t(labelKey)} (${A})`, `${t(labelKey)} (${B})`);
  });
  header.push(`${t('col_links')} (${A})`, `${t('col_links')} (${B})`);
  header.push(t('compare_diff_fields'));

  const linksToStr = (l) => (Array.isArray(l) ? l.join(' ') : (l || ''));

  const statusText = (st) => {
    if (st === 'only_a') return `${t('compare_only_in')} ${A}`;
    if (st === 'only_b') return `${t('compare_only_in')} ${B}`;
    return t(STATUS_KEY[st] || 'compare_agree');
  };

  const body = rows.map(({ gen, node }) => {
    const a = node.a || {};
    const b = node.b || {};
    const cells = [gen, node.confidence != null ? Math.round(node.confidence * 100) + '%' : '', statusText(node.status)];
    DETAIL_FIELDS.forEach(([f]) => { cells.push(a[f] || '', b[f] || ''); });
    cells.push(linksToStr(a.links), linksToStr(b.links));
    cells.push((node.field_diffs || []).map(f => t(`col_${f}`)).join('; '));
    return csvRow(cells);
  });

  // Standard footer block (site + timestamp + URL via csvFooter) preceded by a
  // subject block naming the compared person, direction, and the two sources.
  const dirLabel = t(ctx.dir === 'descendants' ? 'tree_descendants_title' : 'tree_ancestors_title');
  const subject = [csvCell(`${t('compare_title')} – ${dirLabel}`)];
  if (ctx.personName) subject.push(csvRow([t('col_name'), ctx.personName]));
  subject.push(csvRow([t('tree_source'), `${A}, ${B}`]));

  const filename = formatExportFilename(`compare-${ctx.dir}-${ctx.personName || ctx.dir}`, 'csv');
  downloadCsv([csvRow(header), ...body, '', ...csvFooter(subject)], filename);
}
