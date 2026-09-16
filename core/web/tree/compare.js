import { API_BASE_URL } from '../config.js';
import { currentParams, toUnicodeHref, toUnicodeSearch } from '../lib/url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import {
  escapeHtml, ensureD3, highlightDifferences, baseContributorName,
  formatExportFilename, isPrivate,
} from '../lib/utils.js';
import { csvCell, csvRow, csvFooter, downloadCsv } from '../lib/csv.js';
import { formatLinks } from '../lib/links.js';
import { authFetch } from '../auth.js';
import {
  createSvgWithZoom, appendLinks, attachSvgExport,
  attachGedExport, createGedcomModel, orderSpouses,
} from './shared.js';
import { pruneGenerations, buildHierarchy, treeDepth } from './data.js';
import {
  DEFAULT_GENS, DIR_TITLE_KEY, DIR_FILE_PREFIX,
  readDir, readChart, readGens, renderTreeToolbar,
} from './toolbar.js';
import { layoutTree } from './layout-tree.js';
import { layoutFan } from './layout-fan.js';

// Tree comparison view (?t=compare). Superimposes two genealogists' trees
// rooted at a matched person pair into one merged tree, each node coloured by
// its comparison status. Driven by the same toolbar as the tree page:
//   dir   = both (bowtie: ancestors left, descendants right — the default)
//         | anc | desc
//   chart = fan (half circle — default) | tree (compact tidy tree) | circle
//   gens  = generation limit (0 = all), per-chart defaults
// Each side comes from its own /api/compare/<direction> call; the responses are
// cached in module state, so toolbar switches and language changes re-render
// without a refetch. Clicking a node opens a side-by-side field detail with
// differences highlighted; the differences can be exported to CSV. The layout /
// zoom / minimap / export chrome is the regular tree views', with the
// comparison-status palette swapped in for the sex colours.

const IDS = {
  pageTitle:   'compare-page-title',
  toolbar:     'compare-toolbar',
  container:   'compare-tree-container',
  controls:    'compare-tree-controls',
  legend:      'compare-legend',
  detail:      'compare-detail-panel',
  wrapper:     'compare-tree-wrapper',
  zoomIn:      'btn-compare-zoom-in',
  zoomOut:     'btn-compare-zoom-out',
  downloadSvg: 'btn-compare-download-svg',
  downloadCsv: 'btn-compare-download-csv',
  downloadGedA: 'btn-compare-download-ged-a',
  downloadGedB: 'btn-compare-download-ged-b',
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

// Tinted version of the same palette, for the fan / circle wedge fills (the
// wedge carries its own dark label text, so the fill has to stay light).
const STATUS_TINT = {
  agree:    '#d7e9d8',
  minor:    '#fdeccb',
  conflict: '#f7d8d8',
  only_a:   '#cfe8ec',
  only_b:   '#e4d6ef',
};

// Fan / circle wedges in comparison colours, with no outgoing links — a wedge
// opens the side-by-side detail panel instead of navigating away.
const COMPARE_DECOR = {
  // Descendant family bands carry a status of their own; the ancestor marriage
  // bands are synthetic and compare nothing, so they stay the neutral grey the
  // tree page uses.
  fill: d => STATUS_TINT[d.data.status] || (d.data.is_family ? '#f3f3f3' : '#ececec'),
  nameFill: d => STATUS_COLOR[d.data.status] || '#1f2d3d',
  href: () => null,
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

// Sides a direction needs; each is its own /api/compare/<direction> call.
const sidesFor = dir => (dir === 'both' ? ['anc', 'desc'] : [dir]);
const API_PATH = { anc: 'ancestors', desc: 'descendants' };

const collator = new Intl.Collator('sl', { sensitivity: 'base' });

// Raw API responses cached per person pair, so switching direction / chart /
// generations re-renders without refetching.
let state = null;            // { key, ctx, data: { anc?, desc? }, pending: {} }
let renderSeq = 0;           // bumps per renderComparePage call so stale fetches don't render
// Last rendered comparison, kept so a language switch can re-translate the
// chrome/legend/detail in place (no re-fetch, no tree rebuild → view preserved).
let compareState = null;     // { cmp, ctx, view, detail }
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
function compareTitleText(ctx, cmp) {
  const suffix = formatTitleSuffix(t('compare_title'));
  const pair = cmp
    ? `${baseContributorName(cmp.contributor_a || '')} × ${baseContributorName(cmp.contributor_b || '')}`
    : '';
  const base = ctx.personName ? `${ctx.personName} - ${suffix}` : t('compare_title');
  return pair ? `${base} - ${pair}` : base;
}

// Page heading + browser-tab title.
function setCompareTitle(ctx, cmp) {
  const pageTitle = compareTitleText(ctx, cmp);
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
  const dir = readDir(params);
  const chart = readChart(params, dir);
  const gens = readGens(params, chart);
  const ctx = { ca, a, cb, b, personName, dir, chart, gens };

  const key = JSON.stringify([ca, a, cb, b]);
  if (!state || state.key !== key) state = { key, data: {}, pending: {} };
  state.ctx = ctx;
  const seq = ++renderSeq;

  const container = document.getElementById(IDS.container);
  const detail = document.getElementById(IDS.detail);

  setCompareTitle(ctx, null);
  wireButtonTitles();
  renderToolbar();

  if (detail) { detail.innerHTML = ''; detail.style.display = 'none'; }
  compareState = null;
  openDetailNode = null;

  if (!ca || !a || !cb || !b) {
    resetChrome();
    container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
    return;
  }

  // Already fetched (a direction / chart / generations switch): re-render from
  // the cached responses.
  const missing = sidesFor(dir).filter(side => !(side in state.data));
  if (!missing.length) {
    renderChart();
    return;
  }

  resetChrome();
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  // Kick off D3 alongside the API call(s) so the script lands while the tree
  // data is in flight. In a bowtie the faster side is drawn as soon as it
  // arrives; the full chart replaces it once the other side lands.
  const d3Promise = ensureD3().catch(() => {});
  const fetches = missing.map(side => fetchSide(side).then(() => {
    if (seq !== renderSeq) return;
    if (sidesFor(state.ctx.dir).some(s => !(s in state.data))) {
      d3Promise.then(() => { if (seq === renderSeq) renderChart(); });
    }
  }));

  Promise.all([...fetches, d3Promise])
    .then(() => { if (seq === renderSeq) renderChart(); })
    .catch(err => {
      console.error(err);
      if (seq === renderSeq) container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

// Fetches one side for the current pair (deduplicated while in flight). Stores
// null for "no result" so the side still counts as fetched.
function fetchSide(side) {
  if (state.pending[side]) return state.pending[side];
  const { ca, a, cb, b } = state.ctx;
  // 0 = all generations; the limit, where a chart has one, is applied client side.
  const apiParams = new URLSearchParams({ ca, a, cb, b, max_generations: '0' });
  const s = state;
  const p = authFetch(`${API_BASE_URL}/api/compare/${API_PATH[side]}?${apiParams}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => { s.data[side] = (data && data.tree) ? data : null; })
    .catch(err => { s.data[side] = null; throw err; })
    .finally(() => { delete s.pending[side]; });
  s.pending[side] = p;
  return p;
}

// --- Chrome ------------------------------------------------------------------

function wireButtonTitles() {
  const set = (id, html, title) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (html != null) el.innerHTML = html;
    el.title = title;
  };
  set(IDS.zoomIn, '➕', t('tree_zoom_in'));
  set(IDS.zoomOut, '➖', t('tree_zoom_out'));
  set(IDS.downloadSvg, null, t('tree_download_svg'));
  set(IDS.downloadCsv, null, t('tree_download_csv'));
}

// Hides everything that only makes sense once a chart is on screen.
function resetChrome() {
  const controls = document.getElementById(IDS.controls);
  if (controls) controls.style.display = 'none';
  renderLegend(document.getElementById(IDS.legend), null);
  const csvBtn = document.getElementById(IDS.downloadCsv);
  if (csvBtn) { csvBtn.style.display = 'none'; csvBtn.onclick = null; }
  [IDS.downloadGedA, IDS.downloadGedB].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'none';
  });
  clearMinimap();
}

// The minimap lives in the wrapper (sibling of the container), so clearing the
// container alone leaves a stale one behind when the new options produce no
// results and never re-run createSvgWithZoom.
function clearMinimap() {
  document.getElementById(IDS.wrapper)?.querySelectorAll('.tree-minimap').forEach(el => el.remove());
}

// Rendered once up front (so the toggles work while the data is in flight) and
// again from renderChart(), when the fetched depth is known.
function renderToolbar() {
  const { dir, chart, gens } = state.ctx;
  const maxGen = Math.max(0, ...sidesFor(dir).map(side =>
    treeDepth(state.data[side] && state.data[side].tree, side)));
  renderTreeToolbar(document.getElementById(IDS.toolbar), { dir, chart, gens, maxGen }, {
    hrefFor: pageHref,
    navigate: navigateInPlace,
  });
}

// URL params for this pair with the given options. Defaults are omitted so
// shared links stay short.
function pageParams({ dir, chart, gens }) {
  const { ca, a, cb, b, personName } = state.ctx;
  const p = new URLSearchParams();
  p.set('t', 'compare');
  p.set('ca', ca);
  p.set('a', a);
  p.set('cb', cb);
  p.set('b', b);
  if (personName) p.set('pn', personName);
  if (dir !== 'both') p.set('dir', dir);
  if (chart !== 'fan') p.set('chart', chart);
  if (gens != null && gens !== DEFAULT_GENS[chart]) p.set('gens', String(gens));
  return p;
}

const pageHref = opts => toUnicodeHref(pageParams(opts));

// Push a new URL for the same pair and re-render from cached data.
function navigateInPlace(opts) {
  history.pushState(null, '', window.location.pathname + '?' + toUnicodeSearch(pageParams(opts)));
  renderComparePage();
}

// --- Chart -------------------------------------------------------------------

function renderChart() {
  const ctx = state.ctx;
  const { dir, chart, gens } = ctx;
  const container = document.getElementById(IDS.container);
  const legend = document.getElementById(IDS.legend);
  const detail = document.getElementById(IDS.detail);

  clearMinimap();
  container.innerHTML = '';
  // The data (and with it the depth the generations select can offer) may have
  // arrived since the toolbar was first drawn.
  renderToolbar();

  // Prune to the generation limit once; the hierarchies and the exports both
  // use the pruned trees so the downloads match what's on screen.
  const trees = {};
  if (dir !== 'desc' && state.data.anc) trees.anc = pruneGenerations(state.data.anc.tree, 'anc', gens);
  if (dir !== 'anc' && state.data.desc) trees.desc = pruneGenerations(state.data.desc.tree, 'desc', gens);

  if (!trees.anc && !trees.desc) {
    // Still loading the other side of a bowtie, or genuinely nothing.
    const loading = sidesFor(dir).some(s => !(s in state.data));
    resetChrome();
    container.innerHTML = `<p style="padding: 20px;">${t(loading ? 'tree_loading' : 'no_results')}</p>`;
    return;
  }
  if (typeof d3 === 'undefined') {
    resetChrome();
    container.innerHTML = `<p style="padding: 20px;">${t('tree_no_d3')}</p>`;
    return;
  }

  const src = state.data.anc || state.data.desc;
  const cmp = {
    dir,
    chart,
    trees,
    contributor_a: src.contributor_a,
    contributor_b: src.contributor_b,
    summary: summarizeTrees(trees),
  };

  document.getElementById(IDS.controls).style.display = 'flex';
  setCompareTitle(ctx, cmp);
  renderLegend(legend, cmp);
  const view = renderTree(cmp, container, detail);
  wireLegendList(legend, view, detail, cmp);
  compareState = { cmp, ctx, view, detail };

  const csvBtn = document.getElementById(IDS.downloadCsv);
  if (csvBtn) {
    csvBtn.style.display = '';
    csvBtn.onclick = () => exportDifferences(cmp, ctx);
  }
  wireGedExport(IDS.downloadGedA, cmp, ctx, 'a', cmp.contributor_a);
  wireGedExport(IDS.downloadGedB, cmp, ctx, 'b', cmp.contributor_b);
}

// Legend counts for what's actually drawn (so a generation limit narrows them
// too). Both trees are rooted at the focus person, so a bowtie counts it once.
function summarizeTrees({ anc, desc }) {
  const counts = { agree: 0, minor: 0, conflict: 0, only_a: 0, only_b: 0 };
  const walk = (node, skip) => {
    if (!skip && !node.is_family) counts[node.status] = (counts[node.status] || 0) + 1;
    (node.parents || []).forEach(c => walk(c, false));
    (node.children || []).forEach(c => walk(c, false));
  };
  if (anc) walk(anc, false);
  if (desc) walk(desc, !!anc);
  return counts;
}

// Re-translate the compare view in place after a language switch — without
// re-fetching or rebuilding the D3 tree, so the current zoom/pan is preserved.
// Covers the page title, control tooltips, the legend + jump-to-person list,
// and any open differences panel. No-op until a comparison has loaded.
export function relocalizeCompare() {
  if (!compareState) return;
  const { cmp, ctx, view, detail } = compareState;

  setCompareTitle(ctx, cmp);
  wireButtonTitles();
  renderToolbar();

  const gedABtn = document.getElementById(IDS.downloadGedA);
  const gedBBtn = document.getElementById(IDS.downloadGedB);
  if (gedABtn) gedABtn.title = `${t('tree_download_ged')} – ${baseContributorName(cmp.contributor_a || '')}`;
  if (gedBBtn) gedBBtn.title = `${t('tree_download_ged')} – ${baseContributorName(cmp.contributor_b || '')}`;

  const legend = document.getElementById(IDS.legend);
  renderLegend(legend, cmp);
  wireLegendList(legend, view, detail, cmp);

  if (openDetailNode && detail) showDetail(detail, openDetailNode, cmp);
}

// The legend's entries — swatch colour, label, count — in display order. Shared
// by the HTML legend and the SVG export's legend band, so the two can't drift.
// Translated on each call, so a language switch just re-runs it.
function legendEntries(cmp) {
  const a = baseContributorName((cmp && cmp.contributor_a) || '');
  const b = baseContributorName((cmp && cmp.contributor_b) || '');
  const s = (cmp && cmp.summary) || {};
  return [
    ['agree',    t('compare_agree'),                   s.agree],
    ['minor',    t('compare_minor'),                   s.minor],
    ['conflict', t('compare_conflict'),                s.conflict],
    ['only_a',   `${t('compare_only_in')} ${a}`,       s.only_a],
    ['only_b',   `${t('compare_only_in')} ${b}`,       s.only_b],
  ].map(([status, label, count]) => ({ status, color: STATUS_COLOR[status], label, count }));
}

// Status counts for what's drawn. `cmp` is null before results arrive, which
// empties the legend (the toolbar above it keeps the direction/chart toggles).
function renderLegend(legend, cmp) {
  if (!legend) return;

  // Groups with people are clickable dropdowns (jump-to-person); a pill outline
  // + caret signals that, empty groups stay plain text.
  const swatch = ({ status, color, label, count }) => {
    const clickable = typeof count === 'number' && count > 0;
    const cls = 'compare-legend-item' + (clickable ? ' compare-legend-clickable' : '');
    const caret = clickable ? '<span class="compare-caret">▾</span>' : '';
    return `<span class="${cls}" data-compare-status="${status}">
      <span class="compare-swatch" style="background:${color}"></span>
      ${escapeHtml(label)}${count != null ? ` <strong>(${count})</strong>` : ''}${caret}
    </span>`;
  };

  legend.innerHTML = cmp
    ? `<div class="compare-legend-row">${legendEntries(cmp).map(swatch).join('')}</div>`
    : '';
}

// Make each legend status chip clickable: it opens a dropdown listing that
// group's people; choosing one pans the diagram to that node, pulses it, and
// closes the list. `view` is renderTree's { nodes, panToNode, highlightNode }.
function wireLegendList(legend, view, detail, cmp) {
  if (!legend || !view) return;
  const { nodes: allNodes, panToNode, highlightNode } = view;

  const byStatus = {};
  allNodes.forEach(d => {
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
          showDetail(detail, d.data, cmp);
          close();
        });
      });
    });
  });
}

// The comparison charts reuse the tree page's layouts — they only differ in how
// the nodes are painted, so `tree` takes the layout's geometry and draws its own
// status-coloured nodes, while `fan`/`circle` hand the palette in as decor.
const LAYOUTS = {
  tree:   sides => layoutTree(sides, { dir: state.ctx.dir }),
  fan:    sides => layoutFan(sides, { dir: state.ctx.dir, arc: 180, decor: COMPARE_DECOR }),
  circle: sides => layoutFan(sides, { dir: state.ctx.dir, arc: 360, decor: COMPARE_DECOR }),
};

function renderTree(cmp, container, detail) {
  const ctx = state.ctx;
  const sides = {
    anc: cmp.trees.anc ? buildHierarchy(cmp.trees.anc, 'anc') : null,
    desc: cmp.trees.desc ? buildHierarchy(cmp.trees.desc, 'desc') : null,
  };
  const view = LAYOUTS[cmp.chart](sides);
  const rootData = cmp.trees.anc || cmp.trees.desc;

  // Colour the minimap dots/rings by comparison status (not sex) so the overview
  // matches the main view's agree/minor/conflict/only-A/only-B palette.
  const { svg, g, panToNode } = createSvgWithZoom(container, view.bounds, view.anchorNode, IDS, {
    nodes: view.nodes,
    links: view.links,
    linkPath: view.linkPath,
    anchor: view.anchor,
    nodeColor: d => STATUS_COLOR[d.data.status] || '#999',
  });

  attachSvgExport({
    svg, g, downloadBtnId: IDS.downloadSvg,
    data: rootData,
    personName: ctx.personName || rootData.name || '',
    contributorName: cmp.contributor_a || '',
    // Both genealogists in the footer "Source:" line, each linked to its
    // contributor page.
    sourceContributors: [
      baseContributorName(cmp.contributor_a || ''),
      baseContributorName(cmp.contributor_b || ''),
    ],
    titleText: compareTitleText(ctx, cmp),
    filePrefix: `compare-${DIR_FILE_PREFIX[cmp.dir]}`,
    // The status key, under the diagram — an exported comparison is unreadable
    // without it. Resolved on download, so it follows the current language.
    legendItems: () => legendEntries(cmp),
  });

  const node = cmp.chart === 'tree' ? drawCartesian(g, view) : view.draw(g, {});
  node.attr('cursor', 'pointer')
      .on('click', (event, d) => showDetail(detail, d.data, cmp));

  // Pulse a ring where the view jumped to, so the user spots the node. Drawn in
  // an overlay at the node's screen position rather than inside its group, which
  // keeps it working for the wedge layouts (whose groups carry no transform).
  const overlay = g.append('g').attr('pointer-events', 'none');
  function highlightNode(d) {
    overlay.append('circle')
        .attr('cx', d.y).attr('cy', d.x)
        .attr('r', 9).attr('fill', 'none')
        .attr('stroke', '#222').attr('stroke-width', 2.5).attr('opacity', 0.9)
      .transition().duration(1300)
        .attr('r', 26).attr('opacity', 0).remove();
  }

  return { nodes: view.nodes, panToNode, highlightNode };
}

// Tidy-tree drawing in comparison colours: the layout's own draw() paints nodes
// by sex and links them to the person/family search, neither of which applies
// here. Returns the node selection.
function drawCartesian(g, view) {
  appendLinks(g, view.links);

  const node = g.append('g')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-width', 3)
    .selectAll('g')
    .data(view.nodes)
    .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`);

  decorateFamilies(node.filter(d => d.data.is_family));
  decoratePersons(node.filter(d => !d.data.is_family));
  return node;
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
function showDetail(detail, node, cmp) {
  if (!detail) return;
  const a = node.a;
  const b = node.b;
  if (!a && !b) return; // nothing to show (e.g. unknown-partner family)
  const aName = escapeHtml(baseContributorName(cmp.contributor_a || ''));
  const bName = escapeHtml(baseContributorName(cmp.contributor_b || ''));
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

// --- GEDCOM export, one genealogist's tree only (not the merged comparison) ----

// Sets the button's visible label + tooltip to the contributor's name and wires
// the click handler to export just that side's tree.
function wireGedExport(btnId, cmp, ctx, side, contributorName) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const name = baseContributorName(contributorName || '');
  const label = btn.querySelector('.ged-side-label');
  if (label) label.textContent = `GEDCOM – ${name}`;
  btn.title = `${t('tree_download_ged')} – ${name}`;
  btn.style.display = '';
  attachGedExport({
    downloadBtnId: btnId,
    buildModel: () => buildCompareGedcom(cmp, side),
    personName: ctx.personName,
    contributorName: name,
    filePrefix: `compare-${DIR_FILE_PREFIX[cmp.dir]}-${name}`,
  });
}

// One genealogist's own tree (not the merged comparison), covering whichever
// sides are shown. In a bowtie the focus person is the single individual both
// walkers hang their side off.
function buildCompareGedcom(cmp, side) {
  const { anc, desc } = cmp.trees;
  const model = createGedcomModel();
  const rootIndi = model.addIndividual((anc || desc)[side]);
  if (anc) addCompareAncestors(model, anc, rootIndi, side);
  if (desc) addCompareDescendants(model, desc, rootIndi, side);
  return model;
}

// Adds one genealogist's ancestors from the merged comparison tree: walks
// `parents`, keeping only nodes present on `side`. A subtree that exists for
// just the other genealogist (status only_<otherSide>) has no data for `side`
// at any depth, so checking the immediate node is enough to prune it whole.
function addCompareAncestors(model, rootNode, rootIndi, side) {
  const walk = (node, indi) => {
    const parents = (node.parents || []).filter(p => p[side]);
    if (!parents.length) return;
    const parentIndis = parents.map(p => model.addIndividual(p[side]));

    let husband = null, wife = null;
    if (parentIndis.length === 2) {
      [husband, wife] = orderSpouses(parentIndis[0], parentIndis[1]);
    } else if (parentIndis[0].sex === 'f') {
      wife = parentIndis[0];
    } else {
      husband = parentIndis[0];
    }

    const fam = model.addFamily(husband, wife, node.parents_marriage);
    fam.children.push(indi.id);
    indi.famc = fam.id;

    parents.forEach((p, i) => walk(p, parentIndis[i]));
  };

  walk(rootNode, rootIndi);
}

// Same idea for descendants: walks the interleaved family/person `children`,
// keeping only the families and persons present on `side`.
function addCompareDescendants(model, rootNode, rootIndi, side) {
  const walk = (node, indi) => {
    const families = (node.children || []).filter(c => c.is_family && c[side]);
    families.forEach(fam => {
      const partnerIndi = model.addIndividual(fam[side]);

      let husband, wife;
      if (indi.sex === 'm') { husband = indi; wife = partnerIndi; }
      else if (indi.sex === 'f') { husband = partnerIndi; wife = indi; }
      else { [husband, wife] = orderSpouses(indi, partnerIndi); }

      const famRec = model.addFamily(husband, wife, fam.marriage);

      (fam.children || []).filter(c => !c.is_family && c[side]).forEach(child => {
        const childIndi = model.addIndividual(child[side]);
        childIndi.famc = famRec.id;
        famRec.children.push(childIndi.id);
        walk(child, childIndi);
      });
    });
  };

  walk(rootNode, rootIndi);
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

function exportDifferences(cmp, ctx) {
  const A = baseContributorName(cmp.contributor_a || '');
  const B = baseContributorName(cmp.contributor_b || '');

  // A single direction keeps its usual 0..n generations. A bowtie numbers
  // ancestors negatively (-1 parents, -2 grandparents, …) and descendants
  // positively, with the focus person's row taken from the descendants side.
  const { anc, desc } = cmp.trees;
  const rows = [];
  if (anc && desc) {
    const ancRows = [];
    collectRows(anc, 0, ancRows);
    rows.push(...ancRows.filter(r => r.gen > 0).map(r => ({ ...r, gen: -r.gen })));
    collectRows(desc, 0, rows);
  } else {
    collectRows(anc || desc, 0, rows);
  }
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
  const dirLabel = t(DIR_TITLE_KEY[cmp.dir]);
  const subject = [csvCell(`${t('compare_title')} – ${dirLabel}`)];
  if (ctx.personName) subject.push(csvRow([t('col_name'), ctx.personName]));
  subject.push(csvRow([t('tree_source'), `${A}, ${B}`]));

  const prefix = DIR_FILE_PREFIX[cmp.dir];
  const filename = formatExportFilename(`compare-${prefix}-${ctx.personName || prefix}`, 'csv');
  downloadCsv([csvRow(header), ...body, '', ...csvFooter(subject)], filename);
}
