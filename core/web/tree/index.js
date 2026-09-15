import { API_BASE_URL } from '../config.js';
import { toUnicodeHref, toUnicodeSearch, currentParams } from '../lib/url.js';
import { t, formatTitleSuffix } from '../i18n.js';
import { escapeHtml, ensureD3 } from '../lib/utils.js';
import { authFetch } from '../auth.js';
import { createSvgWithZoom, attachSvgExport, attachCsvExport, attachGedExport, createGedcomModel } from './shared.js';
import { pruneGenerations, buildHierarchy, DIRS, CHARTS } from './data.js';
import { layoutTree } from './layout-tree.js';
import { layoutFan } from './layout-fan.js';
import { buildAncestorRows, addAncestorsToGedcom } from './ancestors.js';
import { buildDescendantRows, addDescendantsToGedcom } from './descendants.js';

// The tree page (?t=tree). One page for every direction and chart:
//   dir   = both (bowtie: ancestors left, descendants right — the default)
//         | anc | desc
//   chart = tree (compact tidy tree — default) | fan (half circle) | circle
//           (full circle)
//   gens  = generation limit (0 = all); defaults depend on the chart because
//           the fan can't cope with unbounded depth the way the tree can.
// The person is identified like before (n, sn, dob, c, id). Data is fetched per
// side from the existing ancestors / descendants endpoints and cached in module
// state, so switching direction / chart / generations re-renders without a
// refetch; a language switch re-renders the same way.

const IDS = {
  pageTitle:   'tree-page-title',
  toolbar:     'tree-toolbar',
  container:   'tree-container',
  controls:    'tree-controls',
  source:      'tree-source',
  wrapper:     'tree-wrapper',
  zoomIn:      'btn-tree-zoom-in',
  zoomOut:     'btn-tree-zoom-out',
  downloadSvg: 'btn-tree-download-svg',
  downloadCsv: 'btn-tree-download-csv',
  downloadGed: 'btn-tree-download-ged',
};

const LAYOUTS = {
  tree:   (sides, o) => layoutTree(sides, o),
  fan:    (sides, o) => layoutFan(sides, { ...o, arc: 180 }),
  circle: (sides, o) => layoutFan(sides, { ...o, arc: 360 }),
};

// The tree copes with any depth; the radial charts default to 6 generations
// (fan and circle share it so toggling between them keeps the same people).
const DEFAULT_GENS = { tree: 0, fan: 6, circle: 6 };
const GENS_OPTIONS = [0, 3, 4, 5, 6, 7, 8, 10, 12];

const TITLE_KEY = { both: 'tree_title', anc: 'tree_ancestors_title', desc: 'tree_descendants_title' };
const FILE_PREFIX = { both: 'bowtie', anc: 'ancestors', desc: 'descendants' };

// Sides a direction needs.
const sidesFor = dir => (dir === 'both' ? ['anc', 'desc'] : [dir]);

let state = null;     // { personKey, person, data: { anc?, desc? }, pending: {}, dir, chart, gens }
let renderSeq = 0;    // bumps per renderTreePage call so stale fetches don't render

// --- URL → options -----------------------------------------------------------

function readDir(params) {
  const v = params.get('dir');
  return DIRS.includes(v) ? v : 'both';
}

// Circle has no meaning for a bowtie (each side already owns a half).
// Anything unknown falls back to the tree.
function readChart(params, dir) {
  let chart = params.get('chart');
  if (!CHARTS.includes(chart)) chart = 'tree';
  if (chart === 'circle' && dir === 'both') chart = 'fan';
  return chart;
}

function readGens(params, chart) {
  const raw = params.get('gens');
  if (raw == null || raw === '') return DEFAULT_GENS[chart];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GENS[chart];
}

// URL params for this person with the given options. Defaults are omitted so
// shared links stay short; `gens` is only carried when explicitly set.
function pageParams({ dir, chart, gens }) {
  const p = new URLSearchParams();
  p.set('t', 'tree');
  const { n, sn, dob, c, id } = state.person;
  if (n) p.set('n', n);
  if (sn) p.set('sn', sn);
  if (dob) p.set('dob', dob);
  if (c) p.set('c', c);
  if (id) p.set('id', id);
  if (dir !== 'both') p.set('dir', dir);
  if (chart !== 'tree') p.set('chart', chart);
  if (gens != null && gens !== DEFAULT_GENS[chart]) p.set('gens', String(gens));
  return p;
}

// HTML-escaped href for a toolbar link.
const pageHref = opts => toUnicodeHref(pageParams(opts));

// --- Entry point ------------------------------------------------------------

export function renderTreePage() {
  const params = currentParams();
  const person = {
    n: params.get('n') || '',
    sn: params.get('sn') || '',
    dob: params.get('dob') || '',
    c: params.get('c') || '',
    id: params.get('id') || '',
  };
  person.name = [person.n, person.sn].filter(Boolean).join(' ');
  const personKey = JSON.stringify(person);

  const dir = readDir(params);
  const chart = readChart(params, dir);
  const gens = readGens(params, chart);

  if (!state || state.personKey !== personKey) {
    state = { personKey, person, data: {}, pending: {} };
  }
  Object.assign(state, { dir, chart, gens });
  const seq = ++renderSeq;

  setTitle();
  wireButtonTitles();
  renderToolbar();

  const container = document.getElementById(IDS.container);
  const controls = document.getElementById(IDS.controls);
  const sourceEl = document.getElementById(IDS.source);

  const missing = sidesFor(dir).filter(side => !(side in state.data));
  if (!missing.length) {
    renderChart();
    return;
  }

  controls.style.display = 'none';
  if (sourceEl) sourceEl.style.display = 'none';
  clearMinimap();
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  // Kick off D3 alongside the API call(s) so the script lands while the tree
  // data is in flight. In a bowtie the faster side is drawn as soon as it
  // arrives; the full chart replaces it once the other side lands.
  const d3Promise = ensureD3().catch(() => {});
  const fetches = missing.map(side => fetchSide(side).then(() => {
    if (seq !== renderSeq) return;
    const stillMissing = sidesFor(state.dir).filter(s => !(s in state.data));
    if (stillMissing.length) d3Promise.then(() => { if (seq === renderSeq) renderChart(); });
  }));

  Promise.all([...fetches, d3Promise])
    .then(() => { if (seq === renderSeq) renderChart(); })
    .catch(err => {
      console.error(err);
      if (seq === renderSeq) container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

// Fetches one side for the current person (deduplicated while in flight).
// Stores null for "no result" so the side counts as fetched.
function fetchSide(side) {
  if (state.pending[side]) return state.pending[side];
  const { n, sn, dob, c, id } = state.person;
  const apiParams = new URLSearchParams();
  if (n) apiParams.set('n', n);
  if (sn) apiParams.set('sn', sn);
  if (dob) apiParams.set('dob', dob);
  if (c) apiParams.set('c', c);
  if (id) apiParams.set('id', id);
  // 0 = all generations (the API stops once the tree is fully expanded). The
  // generation limit, where a chart has one, is applied client side.
  apiParams.set('max_generations', '0');
  const path = side === 'anc' ? 'ancestors' : 'descendants';
  const s = state;
  const p = authFetch(`${API_BASE_URL}/api/${path}?${apiParams}`)
    .then(r => (r.ok ? r.json() : null))
    .then(data => { s.data[side] = data || null; })
    .catch(err => { s.data[side] = null; throw err; })
    .finally(() => { delete s.pending[side]; });
  s.pending[side] = p;
  return p;
}

// --- Chrome -----------------------------------------------------------------

function titleText() {
  const base = t(TITLE_KEY[state.dir]);
  return state.person.name ? `${state.person.name} - ${formatTitleSuffix(base)}` : base;
}

function setTitle() {
  const pageTitle = titleText();
  document.getElementById(IDS.pageTitle).textContent = pageTitle;
  document.title = `${pageTitle} | ${t('site_title')}`;
}

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
  set(IDS.downloadGed, null, t('tree_download_ged'));
}

// Direction toggle, chart toggle (Tree / Fan) with the fan's Circle option
// and the generations limit. Toggles are SPA links so they
// go through the router (history + back/forward); the option checkbox and
// generations select push the URL and re-render in place.
function renderToolbar() {
  const bar = document.getElementById(IDS.toolbar);
  if (!bar) return;
  const { dir, chart, gens } = state;

  const seg = (items, active) => `<div class="compare-toggle tree-toggle">${items.map(([value, label, href]) =>
    `<a class="compare-toggle-btn${value === active ? ' compare-toggle-active' : ''}" href="${href}" data-spa-nav>${label}</a>`
  ).join('')}</div>`;

  // Switching direction keeps the chart family (tree/fan) and the generation
  // limit, dropping the option only when it no longer applies; switching
  // between tree and fan resets the limit to the new chart's default.
  const dirHref = d => pageHref({ dir: d, chart: readChart(new URLSearchParams({ chart }), d), gens });
  const dirToggle = seg([
    ['anc',  t('tree_ancestors_title'),   dirHref('anc')],
    ['desc', t('tree_descendants_title'), dirHref('desc')],
    ['both', t('tree_dir_both'),          dirHref('both')],
  ], dir);

  const family = chart === 'fan' || chart === 'circle' ? 'fan' : 'tree';
  const chartToggle = seg([
    ['tree', t('tree_chart_tree'), pageHref({ dir, chart: 'tree' })],
    ['fan',  t('tree_chart_fan'),  pageHref({ dir, chart: 'fan' })],
  ], family);

  // Circle option for the fan (not in a bowtie, where each side is a half).
  let option = '';
  if (family === 'fan' && dir !== 'both') {
    option = `<label class="tree-opt"><input type="checkbox" id="tree-opt-toggle" data-on="circle" data-off="fan"${chart === 'circle' ? ' checked' : ''}> ${t('tree_chart_circle')}</label>`;
  }

  const gensOptions = GENS_OPTIONS.map(n =>
    `<option value="${n}"${n === gens ? ' selected' : ''}>${n === 0 ? t('tree_generations_all') : n}</option>`).join('');
  const gensSelect = `<label class="tree-opt">${t('tree_generations')} <select id="tree-gens-select">${gensOptions}</select></label>`;

  bar.innerHTML = dirToggle + chartToggle + option + gensSelect;

  // Fan ↔ circle is the same chart family: keep the chosen generation count.
  bar.querySelector('#tree-opt-toggle')?.addEventListener('change', (e) => {
    const next = e.target.checked ? e.target.dataset.on : e.target.dataset.off;
    navigateInPlace(pageParams({ dir, chart: next, gens }));
  });
  bar.querySelector('#tree-gens-select')?.addEventListener('change', (e) => {
    navigateInPlace(pageParams({ dir, chart, gens: parseInt(e.target.value, 10) }));
  });
}

// Push a new URL for the same person and re-render from cached data.
function navigateInPlace(params) {
  history.pushState(null, '', window.location.pathname + '?' + toUnicodeSearch(params));
  renderTreePage();
}

function clearMinimap() {
  document.getElementById(IDS.wrapper)?.querySelectorAll('.tree-minimap').forEach(el => el.remove());
}

// --- Chart -------------------------------------------------------------------

function renderChart() {
  const { dir, chart, gens, person, data } = state;
  const container = document.getElementById(IDS.container);
  const controls = document.getElementById(IDS.controls);
  const sourceEl = document.getElementById(IDS.source);

  clearMinimap();
  container.innerHTML = '';

  // Prune to the generation limit once; hierarchies and exports both use the
  // pruned trees so the downloads match what's on screen.
  const shown = {};
  if (dir !== 'desc' && data.anc) shown.anc = pruneGenerations(data.anc, 'anc', gens);
  if (dir !== 'anc' && data.desc) shown.desc = pruneGenerations(data.desc, 'desc', gens);
  const rootData = shown.anc || shown.desc;

  if (!rootData) {
    // Still loading the other side of a bowtie, or genuinely nothing.
    const loading = sidesFor(dir).some(s => !(s in data));
    container.innerHTML = `<p style="padding: 20px;">${t(loading ? 'tree_loading' : 'no_results')}</p>`;
    return;
  }
  if (typeof d3 === 'undefined') {
    container.innerHTML = `<p style="padding: 20px;">${t('tree_no_d3')}</p>`;
    return;
  }

  controls.style.display = 'flex';
  if (sourceEl && person.c) {
    sourceEl.innerHTML = `${t('tree_source')}: <a href="${toUnicodeHref({ t: 'contributors', c: person.c })}" data-spa-nav>${escapeHtml(person.c)}</a>`;
    sourceEl.style.display = 'block';
  }

  const sides = {
    anc: shown.anc ? buildHierarchy(shown.anc, 'anc') : null,
    desc: shown.desc ? buildHierarchy(shown.desc, 'desc') : null,
  };
  const view = LAYOUTS[chart](sides, { dir });
  const { svg, g } = createSvgWithZoom(container, view.bounds, view.anchorNode, IDS, {
    nodes: view.nodes,
    links: view.links,
    linkPath: view.linkPath,
    anchor: view.anchor,
  });
  view.draw(g, { contributorName: person.c });

  const filePrefix = FILE_PREFIX[dir];
  attachSvgExport({
    svg, g, downloadBtnId: IDS.downloadSvg,
    data: rootData, personName: person.name, contributorName: person.c,
    titleText: titleText(),
    filePrefix,
  });
  attachCsvExport({
    downloadBtnId: IDS.downloadCsv,
    buildRows: () => buildRows(shown),
    personName: person.name, contributorName: person.c,
    criteria: { name: person.n, surname: person.sn, dob: person.dob },
    filePrefix,
  });
  attachGedExport({
    downloadBtnId: IDS.downloadGed,
    buildModel: () => buildGedcom(shown),
    personName: person.name, contributorName: person.c,
    filePrefix,
  });
}

// --- Exports -------------------------------------------------------------------

// CSV rows for what's shown. A single direction keeps its usual 0..n
// generations. A bowtie numbers ancestors negatively (-1 parents, -2
// grandparents, …) and descendants positively, with the focus person's rows
// (one per marriage) taken from the descendants side.
function buildRows({ anc, desc }) {
  if (anc && desc) {
    const ancRows = buildAncestorRows(anc)
      .filter(r => r.generation > 0)
      .map(r => ({ ...r, generation: -r.generation }));
    return [...ancRows, ...buildDescendantRows(desc)];
  }
  if (anc) return buildAncestorRows(anc);
  return buildDescendantRows(desc);
}

// GEDCOM model for what's shown; the focus person is one individual shared by
// both walkers in a bowtie.
function buildGedcom({ anc, desc }) {
  const model = createGedcomModel();
  const rootIndi = model.addIndividual(anc || desc);
  if (anc) addAncestorsToGedcom(model, anc, rootIndi);
  if (desc) addDescendantsToGedcom(model, desc, rootIndi);
  return model;
}
