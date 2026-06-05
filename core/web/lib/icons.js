// Shared inline SVG icons + the export-button factory. Previously the download
// glyph was copy-pasted into six different export sites; centralizing it keeps
// every CSV/SVG/GEDCOM button visually identical and one edit away from change.

/** Down-arrow-into-tray glyph used by every download/export button. */
export const DOWNLOAD_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;

/** Picture/landscape glyph used by image (SVG) exports. */
export const IMAGE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

/**
 * Builds a standard `.export-btn` (icon + label) and wires its click handler.
 * Used by the DOM-built export toolbars (search/contributors tables, surname
 * cloud, matricula books). Template-string call sites instead interpolate the
 * icon constants directly.
 *
 * @param {object}   opts
 * @param {string}   opts.label      Visible button text (e.g. 'CSV', 'SVG').
 * @param {string}  [opts.icon]      One of the icon constants; defaults to DOWNLOAD_ICON.
 * @param {string}  [opts.title]     Tooltip / accessible label.
 * @param {string}  [opts.className] Extra class(es) appended after `export-btn`.
 * @param {Function} opts.onClick    Click handler.
 * @returns {HTMLButtonElement}
 */
export function createExportButton({ label, icon = DOWNLOAD_ICON, title, className = '', onClick }) {
  const btn = document.createElement('button');
  btn.className = className ? `export-btn ${className}` : 'export-btn';
  btn.innerHTML = `${icon}${label}`;
  if (title) btn.title = title;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}
