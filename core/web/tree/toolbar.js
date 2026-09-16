import { t } from '../i18n.js';
import { DIRS, CHARTS } from './data.js';

// The direction / chart / generations toolbar, shared by the tree page
// (?t=tree) and the tree-comparison page (?t=compare) — both offer the same
// three directions and the same charts, they only differ in how a page URL is
// built. Also owns the URL → option parsing so the two pages read the same
// params the same way.

// The tree copes with any depth; the radial charts default to 6 generations
// (fan and circle share it so toggling between them keeps the same people).
export const DEFAULT_GENS = { tree: 0, fan: 6, circle: 6 };

// Generation choices: "All" (0) plus every limit from 3 up to the depth the
// fetched data actually has. A limit at or beyond that depth shows the whole
// tree, so listing it would just duplicate "All"; a hand-typed limit below 3 is
// kept so the select still reflects the URL.
function gensOptions(maxGen, gens) {
  const set = new Set([0]);
  for (let n = 3; n <= maxGen; n++) set.add(n);
  if (gens > 0 && gens < maxGen) set.add(gens);
  return [...set].sort((a, b) => a - b);
}

export const DIR_TITLE_KEY = {
  both: 'tree_dir_both',
  anc: 'tree_ancestors_title',
  desc: 'tree_descendants_title',
};
export const DIR_FILE_PREFIX = { both: 'bowtie', anc: 'ancestors', desc: 'descendants' };

// The compare page originally spelled its directions out in full (they doubled
// as API path segments); those links still work.
const DIR_ALIASES = { ancestors: 'anc', descendants: 'desc' };

export function readDir(params) {
  const raw = params.get('dir');
  const v = DIR_ALIASES[raw] || raw;
  return DIRS.includes(v) ? v : 'both';
}

// Circle has no meaning for a bowtie (each side already owns a half).
// Anything unknown falls back to the fan.
export function readChart(params, dir) {
  let chart = params.get('chart');
  if (!CHARTS.includes(chart)) chart = 'fan';
  if (chart === 'circle' && dir === 'both') chart = 'fan';
  return chart;
}

export function readGens(params, chart) {
  const raw = params.get('gens');
  if (raw == null || raw === '') return DEFAULT_GENS[chart];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GENS[chart];
}

// Renders the chart toggle (Fan / Tree) with the fan's Circle option, the
// direction toggle, and the generations limit into `bar`. Toggles are SPA links so
// they go through the router (history + back/forward); the option checkbox and
// generations select call `navigate` to push the URL and re-render in place.
//   maxGen                        → deepest generation the fetched data has,
//                                   which caps the generation choices (0 while
//                                   the data is still in flight)
//   hrefFor({ dir, chart, gens }) → href for that combination on this page
//   navigate({ dir, chart, gens }) → push + re-render
export function renderTreeToolbar(bar, { dir, chart, gens, maxGen = 0 }, { hrefFor, navigate }) {
  if (!bar) return;

  const seg = (items, active) => `<div class="compare-toggle tree-toggle">${items.map(([value, label, href]) =>
    `<a class="compare-toggle-btn${value === active ? ' compare-toggle-active' : ''}" href="${href}" data-spa-nav>${label}</a>`
  ).join('')}</div>`;

  // Switching direction keeps the chart family (tree/fan) and the generation
  // limit, dropping the option only when it no longer applies; switching
  // between tree and fan resets the limit to the new chart's default.
  const dirHref = d => hrefFor({ dir: d, chart: readChart(new URLSearchParams({ chart }), d), gens });
  const dirToggle = seg(DIRS.map(d => [d, t(DIR_TITLE_KEY[d]), dirHref(d)]), dir);

  const family = chart === 'fan' || chart === 'circle' ? 'fan' : 'tree';
  const chartToggle = seg([
    ['fan',  t('tree_chart_fan'),  hrefFor({ dir, chart: 'fan' })],
    ['tree', t('tree_chart_tree'), hrefFor({ dir, chart: 'tree' })],
  ], family);

  // Circle option for the fan (not in a bowtie, where each side is a half).
  let option = '';
  if (family === 'fan' && dir !== 'both') {
    option = `<label class="tree-opt"><input type="checkbox" id="tree-opt-toggle" data-on="circle" data-off="fan"${chart === 'circle' ? ' checked' : ''}> ${t('tree_chart_circle')}</label>`;
  }

  // A limit the list doesn't carry (a chart default deeper than the data, say)
  // prunes nothing, so it shows as "All".
  const options = gensOptions(maxGen, gens);
  const selected = options.includes(gens) ? gens : 0;
  const gensHtml = options.map(n =>
    `<option value="${n}"${n === selected ? ' selected' : ''}>${n === 0 ? t('tree_generations_all') : n}</option>`).join('');
  const gensSelect = `<label class="tree-opt">${t('tree_generations')} <select id="tree-gens-select">${gensHtml}</select></label>`;

  bar.innerHTML = chartToggle + dirToggle + option + gensSelect;

  // Fan ↔ circle is the same chart family: keep the chosen generation count.
  bar.querySelector('#tree-opt-toggle')?.addEventListener('change', (e) => {
    navigate({ dir, chart: e.target.checked ? e.target.dataset.on : e.target.dataset.off, gens });
  });
  bar.querySelector('#tree-gens-select')?.addEventListener('change', (e) => {
    navigate({ dir, chart, gens: parseInt(e.target.value, 10) });
  });
}
