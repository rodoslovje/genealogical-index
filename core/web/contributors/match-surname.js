import { t } from '../i18n.js';
import { API_BASE_URL } from '../config.js';
import { escapeHtml, inputWithClear } from '../lib/utils.js';
import { currentParams, toUnicodeSearch } from '../lib/url.js';
import { updateCurrentKey } from '../lib/view-cache.js';

// The matches summary carries two filters that read similarly but answer
// different questions, so they're deliberately built to look and behave
// differently:
//
//   `qms` (lib/table-filter.js)  — the header bar's small inline filter.
//     Narrows the list by *genealogist* name, client-side, hiding rows.
//   `ms`  (this module)          — a search field in the section body.
//     Narrows it by *surname*, server-side, re-scoping the counts and adding
//     a per-surname column. Answers "who matches me on Pezdirc?", which with
//     a hundred matched genealogists is otherwise unanswerable without
//     opening every pair.
//
// The added column is what makes the difference legible without explanation:
// the genealogist filter only makes rows disappear, this one changes what the
// numbers count.

export const MATCH_SURNAME_PARAM = 'ms';

// Suggestions come from the contributor's own surnames — the same data the
// page's surname cloud renders, so its cached entry is reused server-side.
// Deeper than the cloud's 80 because this list is scanned by typing, not by
// eye.
const SUGGESTION_LIMIT = 400;

const FILTER_DEBOUNCE_MS = 500;

/** Split on commas only — *not* on whitespace the way `normalizeQuery` does,
 *  since a surname can legitimately contain a space ("Von Berg") and would
 *  otherwise be torn into two surnames that match nothing. Case is preserved
 *  for display; the API folds both sides before comparing. */
export function parseSurnames(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const s = part.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Active surname scope from the URL, as an array. */
export function readMatchSurnames() {
  return parseSurnames(currentParams().get(MATCH_SURNAME_PARAM) || '');
}

/** Mirrors the scope into the URL under `ms`, keeping other params untouched.
 *  Same replaceState + `updateCurrentKey` idiom as lib/table-filter.js — see
 *  its `syncParamToUrl` for why the view cache has to be told. */
function syncParamToUrl(surnames) {
  const u = new URL(window.location.href);
  if (surnames.length) u.searchParams.set(MATCH_SURNAME_PARAM, surnames.join(','));
  else u.searchParams.delete(MATCH_SURNAME_PARAM);
  const search = toUnicodeSearch(u.searchParams);
  const newUrl = u.pathname + (search ? '?' + search : '');
  history.replaceState(null, '', newUrl);
  updateCurrentKey(newUrl);
}

let suggestionsPromise = null;
let suggestionsFor = null;

/** Loads the source's surnames for the <datalist>, once per source. Failure is
 *  silent: suggestions are a convenience, typing still works without them. */
async function loadSuggestions(sourceName) {
  if (suggestionsFor !== sourceName) {
    suggestionsFor = sourceName;
    suggestionsPromise = fetch(
      `${API_BASE_URL}/api/stats/top_surnames?contributors=${encodeURIComponent(sourceName)}&limit=${SUGGESTION_LIMIT}`
    )
      .then(res => (res.ok ? res.json() : []))
      .then(data => data.map(d => d.surname).filter(Boolean))
      .catch(() => []);
  }
  return suggestionsPromise;
}

/**
 * Renders the surname-scope search box (and its active-surname chips) into
 * `mountEl`, and keeps `ms` in the URL in sync.
 *
 * Idempotent in the same sense as `mountTableFilter`: re-rendering the table
 * must not rebuild the input, or it would steal focus mid-typing. Only the
 * chip row is redrawn on a re-render.
 *
 * @param {HTMLElement} mountEl     Container to render into.
 * @param {string} sourceName       Contributor whose surnames feed suggestions.
 * @param {(surnames: string[]) => void} onChange  Called when the scope changes.
 * @returns {string[]} the current scope.
 */
export function mountSurnameScope({ mountEl, sourceName, onChange }) {
  if (!mountEl) return [];

  let surnames = readMatchSurnames();

  const renderChips = () => {
    const chipsEl = mountEl.querySelector('.match-surname-chips');
    if (!chipsEl) return;
    chipsEl.innerHTML = surnames.map(s =>
      `<button type="button" class="match-surname-chip" data-surname="${escapeHtml(s)}" title="${escapeHtml(t('match_surname_remove'))}">${escapeHtml(s)}<span aria-hidden="true">&times;</span></button>`
    ).join('');
    chipsEl.style.display = surnames.length ? '' : 'none';
  };

  // Re-render path: input already mounted, so only refresh the chips.
  let input = mountEl.querySelector('.match-surname-input input');
  if (input) {
    surnames = readMatchSurnames();
    renderChips();
    return surnames;
  }

  const listId = 'match-surname-options';
  mountEl.innerHTML = `
    <div class="match-surname-scope">
      <label class="match-surname-label" for="match-surname-q">${escapeHtml(t('match_surname_label'))}</label>
      <div class="match-surname-input">${inputWithClear({
        id: 'match-surname-q',
        placeholder: t('match_surname_placeholder'),
        value: surnames.join(', '),
        title: t('match_surname_tip'),
      })}</div>
      <datalist id="${listId}"></datalist>
      <div class="match-surname-chips" style="display: none;"></div>
    </div>`;

  const wrapper = mountEl.querySelector('.input-wrapper');
  input = wrapper.querySelector('input');
  input.setAttribute('list', listId);
  const clearBtn = wrapper.querySelector('.clear-btn');
  clearBtn.style.display = input.value ? 'block' : 'none';

  renderChips();

  const apply = (raw) => {
    const next = parseSurnames(raw);
    // Skip no-op applies (debounce firing on an unchanged value, chip removal
    // that already rewrote the input) so the table isn't refetched for nothing.
    if (next.join(',').toLowerCase() === surnames.join(',').toLowerCase()) return;
    surnames = next;
    syncParamToUrl(surnames);
    renderChips();
    onChange(surnames);
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(timer);
    timer = setTimeout(() => apply(input.value), FILTER_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    apply(input.value);
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    input.focus();
    clearTimeout(timer);
    apply('');
  });

  // Populate suggestions on first focus rather than at page load — most
  // visitors never open this control, and the list is only useful once the
  // caret is in the field.
  input.addEventListener('focus', async () => {
    const datalist = mountEl.querySelector(`#${listId}`);
    if (!datalist || datalist.dataset.loaded) return;
    datalist.dataset.loaded = '1';
    const names = await loadSuggestions(sourceName);
    datalist.innerHTML = names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
  }, { once: false });

  mountEl.querySelector('.match-surname-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.match-surname-chip');
    if (!chip) return;
    const drop = chip.dataset.surname.toLowerCase();
    const next = surnames.filter(s => s.toLowerCase() !== drop);
    input.value = next.join(', ');
    clearBtn.style.display = input.value ? 'block' : 'none';
    clearTimeout(timer);
    apply(input.value);
  });

  return surnames;
}
