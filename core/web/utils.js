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
const MATRICULA_INDICATOR = '⛪';

/** Returns the base contributor name (strips trailing -matricula), Unicode-normalized. */
export function baseContributorName(name) {
  if (!name) return name;
  const normalized = name.normalize('NFC');
  return normalized.endsWith(MATRICULA_SUFFIX)
    ? normalized.slice(0, -MATRICULA_SUFFIX.length)
    : normalized;
}

export function isMatriculaContributor(name) {
  if (!name) return false;
  return name.normalize('NFC').endsWith(MATRICULA_SUFFIX);
}

/** Returns the HTML for the matricula indicator (with tooltip), or '' if not matricula. */
export function matriculaIndicatorHtml(name, tooltip) {
  if (!isMatriculaContributor(name)) return '';
  const safe = escapeHtml(tooltip || '');
  return ` <span class="matricula-indicator" title="${safe}" aria-label="${safe}">${MATRICULA_INDICATOR}</span>`;
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