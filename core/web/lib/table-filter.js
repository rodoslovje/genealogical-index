import { inputWithClear } from './utils.js';
import { currentParams, toUnicodeSearch } from './url.js';
import { updateCurrentKey } from './view-cache.js';

// Generic per-table text filter, used by every table on the site (contributors
// list, search results, matches summary, Matricula/Geneanet stats tables).
// Each table gets its own URL param so multiple tables on the same page filter
// independently and a shared link reproduces the exact filtered view.
// `match-detail.js` keeps its own bespoke per-section filter (tightly coupled
// to its rebuild pipeline, with its own short `mqp`/`mqf` params) — this
// module is for every other table.

/** Short URL codes for each table's filter slug, mirroring match-detail.js's
 *  `mqp`/`mqf` so shared links stay as compact for every table as they
 *  already are on the Matches page. Falls back to `q_<slug>` for any table
 *  not listed here. */
const SHORT_PARAM_MAP = {
  'contributors':         'qc',
  'general-persons':      'qgp',
  'general-families':     'qgf',
  'person-results':       'qpr',
  'family-results':       'qfr',
  'matches-summary':      'qms',
  'matricula-books':      'qmb',
  'geneanet-cemeteries':  'qgc',
};

/** Every short URL code a per-table text filter can use — table-csv.js reads
 *  this so these show up in the CSV's search-criteria footer as a plain
 *  "Filter" row instead of the raw param code. Includes match-detail.js's
 *  own `mqp`/`mqf`, which predate and aren't part of `SHORT_PARAM_MAP`. */
export const TABLE_FILTER_PARAM_KEYS = new Set([...Object.values(SHORT_PARAM_MAP), 'mqp', 'mqf']);

/** Mirrors `value` into the URL under `paramKey` via replaceState, keeping
 *  other params untouched — the same idiom used by match-detail.js's own
 *  per-section filter. */
function syncParamToUrl(paramKey, value) {
  const u = new URL(window.location.href);
  if (value) u.searchParams.set(paramKey, value);
  else u.searchParams.delete(paramKey);
  const search = toUnicodeSearch(u.searchParams);
  const newUrl = u.pathname + (search ? '?' + search : '');
  history.replaceState(null, '', newUrl);
  // This view typically stays mounted across the edit — keep the view
  // cache's idea of "where this view lives" in sync, or a later cache write
  // (e.g. navigating away and back) would store it under the pre-filter URL
  // and a Back navigation to the post-filter URL would miss the cache.
  updateCurrentKey(newUrl);
}

// Each keystroke would otherwise trigger a full table re-render; wait for a
// typing pause instead (mirrors match-detail.js's per-section filter).
const FILTER_DEBOUNCE_MS = 250;

/**
 * Mounts (or, on a re-render, reuses) a debounced text-filter input inside
 * `headerEl`, synced to the URL under a short param resolved from `slug`
 * (see `SHORT_PARAM_MAP`). Returns the current (trimmed, lowercased) query
 * string.
 *
 * Idempotent: a second call with the same `headerEl`/`slug` finds the
 * existing input instead of rebuilding it, so a table re-render never steals
 * focus or resets the value mid-typing. Every call re-syncs the URL to the
 * input's current value, so the URL stays correct even after some other code
 * path (e.g. a fresh search) has rewritten it without this param.
 */
export function mountTableFilter({ headerEl, paramKey: slug, placeholder, title, onChange }) {
  if (!headerEl) return '';

  const paramKey = SHORT_PARAM_MAP[slug] || `q_${slug}`;
  let input = headerEl.querySelector(`input[data-filter-param="${paramKey}"]`);
  if (input) {
    syncParamToUrl(paramKey, input.value.trim().toLowerCase());
    return input.value.trim().toLowerCase();
  }

  const initial = (currentParams().get(paramKey) || '').trim().toLowerCase();
  const wrapperHtml = inputWithClear({ id: `tf-${paramKey}`, placeholder, value: initial, title });
  const template = document.createElement('div');
  template.innerHTML = wrapperHtml;
  const wrapperEl = template.firstElementChild;
  wrapperEl.classList.add('table-filter-wrapper');
  input = wrapperEl.querySelector('input');
  input.dataset.filterParam = paramKey;
  const clearBtn = wrapperEl.querySelector('.clear-btn');

  headerEl.appendChild(wrapperEl);

  let timer = null;
  const apply = (rawValue) => {
    const q = rawValue.trim().toLowerCase();
    syncParamToUrl(paramKey, q);
    onChange(q);
  };

  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(timer);
    timer = setTimeout(() => apply(input.value), FILTER_DEBOUNCE_MS);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    input.focus();
    clearTimeout(timer);
    apply('');
  });

  // Auto-focus the *first* filter on a freshly rendered page (initial load
  // or right after a search), so the user can start narrowing results
  // without an extra click — this is also exactly the moment a search
  // input still holds focus from the just-submitted query, so deliberately
  // steal it rather than checking document.activeElement first. Scoped to
  // the active tab (not the whole document) since cached, hidden tabs from
  // earlier navigation keep their old filter inputs in the DOM.
  //
  // Deferred rather than decided here: on pages with two tables (general
  // search's persons + families), each renders independently and their
  // mount order isn't guaranteed to match their on-screen order (families
  // can finish mounting before persons). Waiting a tick and then picking
  // whichever filter is *first in DOM order* — not first to be created —
  // reliably lands on the visually-first table either way; re-running it
  // from every newly-created filter is harmless since they all converge on
  // the same element.
  const scope = headerEl.closest('.tab-content') || document;
  setTimeout(() => scope.querySelector('input[data-filter-param]')?.focus(), 0);

  syncParamToUrl(paramKey, initial);
  return initial;
}

/** Keeps `container`'s `--thead-offset` CSS var in sync with `headerEl`'s
 *  rendered height, so a table's sticky `<th>` row (style.css) sits flush
 *  under the sticky header bar above it instead of at a hardcoded offset —
 *  the bar can wrap to two lines depending on viewport width and content.
 *  Desktop-only (≥769px); narrower viewports fall back to the plain
 *  `var(--nav-height)` default in style.css (no sticky header bar there). */
export function observeStickyHeader(headerEl, container) {
  if (!headerEl || !container || !window.ResizeObserver) return;

  const update = () => {
    if (window.innerWidth <= 768) {
      container.style.removeProperty('--thead-offset');
      return;
    }
    const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 0;
    container.style.setProperty('--thead-offset', `${navHeight + headerEl.offsetHeight}px`);
  };

  if (!headerEl._stickyHeaderObserver) {
    headerEl._stickyHeaderObserver = new ResizeObserver(update);
    headerEl._stickyHeaderObserver.observe(headerEl);
    window.addEventListener('resize', update);
  }
  update();
}
