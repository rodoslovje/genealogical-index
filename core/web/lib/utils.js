import siteConfig from '@site-config';

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
// flag only the differing token(s) instead of the whole field.
export function highlightDifferences(val, otherVal) {
  if (!val) return '';
  const valStr = String(val);
  if (!otherVal) return `<span class="match-diff">${escapeHtml(valStr)}</span>`;

  if (valStr.toLowerCase() === String(otherVal).toLowerCase()) {
    return escapeHtml(valStr);
  }

  const otherWords = new Set(String(otherVal).toLowerCase().match(/[\p{L}\d]+/gu) || []);
  if (otherWords.size === 0) return `<span class="match-diff">${escapeHtml(valStr)}</span>`;

  const tokens = valStr.split(/([\p{L}\d]+)/u);
  return tokens.map(token => {
    if (/^[\p{L}\d]+$/u.test(token) && !otherWords.has(token.toLowerCase())) {
      return `<span class="match-diff">${escapeHtml(token)}</span>`;
    }
    return escapeHtml(token);
  }).join('');
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