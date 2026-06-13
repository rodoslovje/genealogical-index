import siteConfig from '@site-config';
import { parseLinksList, diffKey } from './links.js';
import { childYearOf } from './dates.js';

/**
 * Returns the HTML for an `<input type=text>` paired with a clear (×) button,
 * inside an `.input-wrapper`. Used by every search form input in search.js.
 * Pair with `wireClearableContainer()` (below) to hook up the listeners.
 */
export function inputWithClear({ id, placeholder = '', value = '', title = '', type = 'text' } = {}) {
  const safeId = escapeHtml(id);
  const safePlaceholder = escapeHtml(placeholder);
  const safeValue = escapeHtml(value);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const clearDisplay = value ? 'block' : 'none';
  return `<div class="input-wrapper">
    <input type="${type}" id="${safeId}" placeholder="${safePlaceholder}" value="${safeValue}"${titleAttr} />
    <button type="button" class="clear-btn" style="display:${clearDisplay}">&times;</button>
  </div>`;
}

/**
 * Adds clear-button + Enter-key + input-event wiring on a container that holds
 * one or more `inputWithClear()` outputs. Idempotent — call after each render.
 * @param {HTMLElement} container
 * @param {() => void} onEnter   Called on Enter inside any text input.
 */
export function wireClearableContainer(container, onEnter) {
  if (!container || container.dataset.clearableWired) return;
  container.dataset.clearableWired = '1';
  container.addEventListener('click', (event) => {
    if (event.target.matches('.clear-btn')) {
      const input = event.target.previousElementSibling;
      if (input) { input.value = ''; event.target.style.display = 'none'; input.focus(); }
    }
  });
  container.addEventListener('input', (event) => {
    if (event.target.matches('input[type="text"]')) {
      const clearBtn = event.target.nextElementSibling;
      if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = event.target.value ? 'block' : 'none';
    }
  });
  if (onEnter) {
    container.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.matches('input[type="text"]')) onEnter();
    });
  }
}

/**
 * Sets an input's value and syncs the adjacent `.clear-btn` visibility to match
 * (shown when non-empty, hidden when empty). Mirrors what the live `input`
 * listener does, for the cases where we set `.value` programmatically.
 */
export function setInputValue(input, value) {
  if (!input) return;
  input.value = value;
  const clearBtn = input.nextElementSibling;
  if (clearBtn?.matches('.clear-btn')) clearBtn.style.display = value ? 'block' : 'none';
}

/**
 * Wraps an existing `<input>` in an `.input-wrapper` with a clear (×) button and
 * wires up clear / Enter handling. Used for standalone sidebar filter inputs
 * that exist in the static HTML (vs. `inputWithClear()` which builds the markup
 * for dynamically-rendered forms).
 */
export function setupClearableInput(inputElement, onEnterCallback) {
  if (!inputElement) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'input-wrapper';
  inputElement.parentNode.insertBefore(wrapper, inputElement);
  wrapper.appendChild(inputElement);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'clear-btn';
  clearBtn.innerHTML = '&times;';
  wrapper.appendChild(clearBtn);

  const toggleClearBtn = () => {
    clearBtn.style.display = inputElement.value ? 'block' : 'none';
  };

  clearBtn.addEventListener('click', () => {
    inputElement.value = '';
    toggleClearBtn();
    inputElement.focus();
    inputElement.dispatchEvent(new Event('input'));
  });

  inputElement.addEventListener('input', toggleClearBtn);
  inputElement.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && onEnterCallback) onEnterCallback();
  });
  toggleClearBtn();
}

// --- CDN script loaders ------------------------------------------------------
// Chart.js (~90 kB gzipped) and D3 (~200 kB gzipped) are only needed on the
// contributors and ancestors/descendants views respectively. Loading them
// lazily keeps the initial bundle small for the common Search-only user.

const _scriptPromises = new Map();

/** Idempotent dynamic-script loader. Returns a promise that resolves once
 *  `src` has finished executing; concurrent callers share the same fetch. */
export function loadScript(src) {
  if (_scriptPromises.has(src)) return _scriptPromises.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      _scriptPromises.delete(src); // allow a retry on next call
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(s);
  });
  _scriptPromises.set(src, p);
  return p;
}

export const ensureChartJs = () => loadScript('https://cdn.jsdelivr.net/npm/chart.js');
export const ensureD3      = () => loadScript('https://cdn.jsdelivr.net/npm/d3@7');

/** Inject a stylesheet <link> once (idempotent). Used for libraries whose CSS
 *  must be present before their JS renders, e.g. Leaflet. */
export function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

/** Lazily load Leaflet (CSS + JS) for the Geneanet cemeteries map. Only the
 *  Geneanet index page pulls it in, so the common Search user never pays for it. */
export const ensureLeaflet = () => {
  loadCss('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css');
  return loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js');
};

/** Escapes a value for safe insertion into HTML text content / attribute. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Wraps each word in `val` that doesn't appear in `otherVal` in a diff-highlight
// span; equal strings return plain escaped text. Used by match-pair views to
// flag only the differing token(s) instead of the whole field. When the other
// side has nothing to compare against, `val` is new information rather than a
// conflicting one, so — if `markAdd` is true — it's marked with `match-add`
// instead of `match-diff`. `markAdd` should only be true for the "B" (second
// genealogist) side, so additions are shown only as data B could contribute.
// `emptyOtherIsDiff`: when `otherVal` is empty, normally that's treated as an
// addition (or plain, per `markAdd`). Pass true when the *containing* entity
// (e.g. a parent or partner) exists on both sides — so a missing field there
// is a difference, not new data, even though its own value is empty.
export function highlightDifferences(val, otherVal, markAdd = true, emptyOtherIsDiff = false) {
  if (!val) return '';
  const valStr = String(val);
  if (!otherVal) {
    if (emptyOtherIsDiff) return `<span class="match-diff">${escapeHtml(valStr)}</span>`;
    return markAdd ? `<span class="match-add">${escapeHtml(valStr)}</span>` : escapeHtml(valStr);
  }

  if (valStr.toLowerCase() === String(otherVal).toLowerCase()) {
    return escapeHtml(valStr);
  }

  const otherWords = new Set(String(otherVal).toLowerCase().match(/[\p{L}\d]+/gu) || []);
  if (otherWords.size === 0) return markAdd ? `<span class="match-add">${escapeHtml(valStr)}</span>` : escapeHtml(valStr);

  const tokens = valStr.split(/([\p{L}\d]+)/u);
  return tokens.map(token => {
    if (/^[\p{L}\d]+$/u.test(token) && !otherWords.has(token.toLowerCase())) {
      return `<span class="match-diff">${escapeHtml(token)}</span>`;
    }
    return escapeHtml(token);
  }).join('');
}

// Fields whose text is highlighted (diff'd) when comparing record_a vs record_b
// in the match-detail view. Shared with classifyMatchPair below so the per-pair
// "has additions / has differences" badges and filters agree with what's
// actually highlighted in the table.
export const HIGHLIGHTABLE = new Set([
  'name', 'surname', 'husband_name', 'husband_surname', 'wife_name', 'wife_surname',
  'date_of_birth', 'place_of_birth', 'date_of_death', 'place_of_death',
  'date_of_burial', 'place_of_burial',
  'date_of_marriage', 'place_of_marriage', 'husband_birth', 'wife_birth',
]);

// Text used for "does val appear in the other record" comparisons — mirrors the
// surname/alt_surname concatenation highlightDifferences relies on, so a value
// that wouldn't actually be highlighted isn't reported as a difference here.
function comparableText(rec, field) {
  let text = rec[field] || '';
  if (field.endsWith('surname')) {
    const altField = field === 'surname' ? 'alt_surname' : field.replace('surname', 'alt_surname');
    if (rec[altField]) text += ' ' + rec[altField];
  }
  return text;
}

// True if highlightDifferences(val, otherText) would mark at least one token of
// `val` as a difference (i.e. both sides have content but it doesn't match).
function fieldDiffers(val, otherText) {
  if (!val || !otherText) return false;
  const valStr = String(val);
  if (valStr.toLowerCase() === String(otherText).toLowerCase()) return false;
  const otherWords = new Set(String(otherText).toLowerCase().match(/[\p{L}\d]+/gu) || []);
  if (otherWords.size === 0) return false;
  const tokens = valStr.match(/[\p{L}\d]+/gu) || [];
  return tokens.some(tok => !otherWords.has(tok.toLowerCase()));
}

// True if a parents-list / partners-list entry has a usable name or surname.
function hasNameOrSurname(p) {
  return !!(p && (p.name || p.surname));
}

// Counts how many of the two slots (father/mother, or husband/wife) in a
// parents-pair list are present in `listB` but missing entirely from `listA`.
function countAddedParentPair(listA, listB) {
  const a = parseList(listA);
  const b = parseList(listB);
  let n = 0;
  if (hasNameOrSurname(b[0]) && !hasNameOrSurname(a[0])) n += 1;
  if (hasNameOrSurname(b[1]) && !hasNameOrSurname(a[1])) n += 1;
  return n;
}

// Canonicalizes a name/surname token for matching. All private-placeholder
// variants ('<private>', 'private', 'unknown') collapse to one key so they
// pair across sides regardless of which placeholder each side stores.
export function matchToken(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return '';
  if (isPrivate(v)) return '<private>';
  return v;
}

// Computes a one-to-one pairing between entries of `listA` and `listB` for
// diff highlighting / counting. Each entry is paired with at most one
// counterpart on the other side, picked globally by best match score — so
// e.g. two same-named siblings on one side don't both get matched to the
// single same-named sibling on the other side, leaving the genuinely new one
// mis-flagged as a "year diff" against an already-claimed counterpart.
// Match quality: name+surname > surname only > name only, with a small year
// bonus that only breaks ties between equally-strong matches.
// `requireName` disables surname-only matches — used for children, where
// every sibling shares the family surname, so a surname-only "match" would
// just pair an added child with an unrelated sibling.
// Returns a Map from entries of `listA` to their matched entry in `listB`.
export function pairRelatives(listA, listB, requireName = false) {
  const map = new Map();
  if (!listA?.length || !listB?.length) return map;

  const candidates = [];
  listA.forEach((a, i) => {
    const aName = matchToken(a?.name);
    const aSur  = matchToken(a?.surname);
    if (!aName && !aSur) return;
    if (requireName && !aName) return;
    const aYear = String(childYearOf(a) || '');

    listB.forEach((b, j) => {
      const bName = matchToken(b?.name);
      const bSur  = matchToken(b?.surname);
      const nameMatch = !!aName && aName === bName;
      const surMatch  = !!aSur  && aSur  === bSur;
      if (!nameMatch && !surMatch) return;
      if (requireName && !nameMatch) return;

      let score = nameMatch && surMatch ? 30 : surMatch ? 20 : 10;
      if (aYear && aYear === String(childYearOf(b) || '')) score += 5;
      candidates.push({ a, b, i, j, score });
    });
  });

  candidates.sort((x, y) => y.score - x.score || (x.i + x.j) - (y.i + y.j));
  const usedA = new Set(), usedB = new Set();
  for (const c of candidates) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j);
    map.set(c.a, c.b);
  }
  return map;
}

// Counts entries in `listB` (partners or children) that have no counterpart
// anywhere in `listA` — i.e. only known to B. `requireName` restricts matching
// to the first name only — used for children, where every sibling shares the
// family surname, so a surname-only "match" would pair an added child with an
// unrelated sibling and miss it as new data.
function countAddedRelatives(listA, listB, requireName = false) {
  const a = parseList(listA);
  const b = parseList(listB);
  const pairs = pairRelatives(a, b, requireName);
  const matchedB = new Set(pairs.values());
  let n = 0;
  for (const p of b) {
    if (hasNameOrSurname(p) && !matchedB.has(p)) n += 1;
  }
  return n;
}

/**
 * Classifies a match-detail record pair for the "has additions" / "has
 * differences" badges and filters, counting how many fields fall into
 * each category:
 *  - addCount:  `recB` has a value for that field that `recA` is missing —
 *    new information the second genealogist (B) contributes. Also covers
 *    parents/spouse-parents/partners/children that exist only on B's side.
 *  - linkAddCount: same, but specifically for `links` — counted separately
 *    so they can get their own indicator.
 *  - diffCount: a field is present on both sides with conflicting values
 *    (as flagged by highlightDifferences).
 * `fields` is the list of column keys for the section (person/family).
 */
export function classifyMatchPair(recA, recB, fields) {
  let addCount = 0;
  let diffCount = 0;
  let linkAddCount = 0;

  for (const f of fields) {
    if (f === 'links') {
      const linksA = parseLinksList(recA.links);
      const linksB = parseLinksList(recB.links);
      if (linksB.length) {
        const setA = new Set(linksA.map(diffKey));
        linkAddCount += linksB.filter(l => !setA.has(diffKey(l))).length;
      }
      continue;
    }
    if (f === 'parents') {
      addCount += countAddedParentPair(recA.parents_list, recB.parents_list);
      addCount += countAddedParentPair(recA.husband_parents, recB.husband_parents);
      addCount += countAddedParentPair(recA.wife_parents, recB.wife_parents);
      continue;
    }
    if (f === 'partners') {
      addCount += countAddedRelatives(recA.partners_list, recB.partners_list);
      continue;
    }
    if (f === 'children') {
      addCount += countAddedRelatives(recA.children_list, recB.children_list, true);
      continue;
    }
    if (!HIGHLIGHTABLE.has(f)) continue;

    const valA = recA[f] || '';
    const valB = recB[f] || '';
    if (!valA && !valB) continue;
    if (!valA && valB) { addCount += 1; continue; }
    if (!valB) continue;

    if (fieldDiffers(valA, comparableText(recB, f)) || fieldDiffers(valB, comparableText(recA, f))) {
      diffCount += 1;
    }
  }

  return { addCount, diffCount, linkAddCount };
}

/** Triggers a browser download for a Blob. Common shape used by CSV/SVG exports. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Formats a consistent filename for CSV and SVG exports */
export function formatExportFilename(baseName, extension) {
  const prefix = siteConfig.filePrefix || 'sgi';
  const safeBase = String(baseName)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric with hyphen
    .replace(/(^-|-$)/g, ''); // remove leading/trailing hyphens
  return `${prefix}-${safeBase}.${extension}`;
}

/** Parses a JSON array string (or passes through an array) to an array; [] on failure. */
export function parseList(jsonOrArr) {
  if (!jsonOrArr) return [];
  if (Array.isArray(jsonOrArr)) return jsonOrArr;
  try {
    const v = typeof jsonOrArr === 'string' ? JSON.parse(jsonOrArr) : jsonOrArr;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function isPrivate(val) {
  if (!val) return false;
  const v = String(val).toLowerCase();
  return v === 'private' || v === '<private>' || v === 'unknown';
}

const collator = new Intl.Collator('sl', { sensitivity: 'base' });

export function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

export function getExpandCollapseIcon(isOpen) {
  return isOpen
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
}

const MATRICULA_SUFFIX = '-matricula';
const GENEANET_SUFFIX = '-geneanet';
const SPECIAL_SUFFIXES = [MATRICULA_SUFFIX, GENEANET_SUFFIX];
const MATRICULA_INDICATOR = '⛪';
const GENEANET_INDICATOR = '🪦';

/** Returns the base contributor name (strips a trailing special-source suffix
 *  -matricula / -geneanet), Unicode-normalized. */
export function baseContributorName(name) {
  if (!name) return name;
  const normalized = name.normalize('NFC');
  for (const s of SPECIAL_SUFFIXES) {
    if (normalized.endsWith(s)) return normalized.slice(0, -s.length);
  }
  return normalized;
}

export function isMatriculaContributor(name) {
  if (!name) return false;
  return name.normalize('NFC').endsWith(MATRICULA_SUFFIX);
}

export function isGeneanetContributor(name) {
  if (!name) return false;
  return name.normalize('NFC').endsWith(GENEANET_SUFFIX);
}

/** True for any non-tree special source (matricula, geneanet). These have no
 *  stable per-person IDs for ancestor/descendant tree navigation. */
export function isSpecialContributor(name) {
  return isMatriculaContributor(name) || isGeneanetContributor(name);
}

/** Returns the HTML for the matricula indicator (with tooltip), or '' if not matricula. */
export function matriculaIndicatorHtml(name, tooltip) {
  if (!isMatriculaContributor(name)) return '';
  const safe = escapeHtml(tooltip || '');
  return ` <span class="matricula-indicator" title="${safe}" aria-label="${safe}">${MATRICULA_INDICATOR}</span>`;
}

/** Returns the HTML for the geneanet (grave) indicator, or '' if not geneanet. */
export function geneanetIndicatorHtml(name, tooltip) {
  if (!isGeneanetContributor(name)) return '';
  const safe = escapeHtml(tooltip || '');
  return ` <span class="geneanet-indicator" title="${safe}" aria-label="${safe}">${GENEANET_INDICATOR}</span>`;
}

// --- inline row icons for optional fields shown in result cells ---
const ALT_SURNAME_ICON = '🏷';
const BAPTISM_ICON     = '✝';
const NOTES_ICON       = '🗒';

function _inlineIcon(glyph, label, value) {
  const tooltip = label ? `${label}: ${value}` : String(value);
  const safe = escapeHtml(tooltip);
  return ` <span class="row-icon" title="${safe}" aria-label="${safe}">${glyph}</span>`;
}

export function altSurnameIconHtml(altSurname, label) {
  if (!altSurname || !String(altSurname).trim()) return '';
  return _inlineIcon(ALT_SURNAME_ICON, label, altSurname);
}

export function baptismIconHtml(date, place, label) {
  const d = String(date || '').trim();
  const p = String(place || '').trim();
  if (!d && !p) return '';
  return _inlineIcon(BAPTISM_ICON, label, [d, p].filter(Boolean).join(', '));
}

export function notesIconHtml(notes, label) {
  if (!notes || !String(notes).trim()) return '';
  return _inlineIcon(NOTES_ICON, label, notes);
}

export function shortenUrlLabel(urlStr) {
  try {
    const u = new URL(urlStr);
    const domain = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 1) {
      return `${domain}/${parts[0]}/...`;
    }
    return `${domain}${u.pathname !== '/' ? u.pathname : ''}`;
  } catch (e) {
    return urlStr;
  }
}