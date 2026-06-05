// Shared CSV building primitives. Before this module each export site
// (search/contributors table, ancestor/descendant trees, matricula books)
// re-implemented cell quoting, the BOM-prefixed Blob download, and the
// site/url/date footer independently — and they had drifted apart (raw BOM
// char vs. '﻿', date+time vs. date-only). Routing every CSV through here
// keeps quoting, the footer, and the export timestamp identical everywhere.

import { t } from '../i18n.js';
import { downloadBlob } from './utils.js';

/** Quotes a single CSV cell (RFC-4180: wrap in quotes, double embedded quotes). */
export function csvCell(val) {
  return `"${String(val ?? '').replace(/"/g, '""')}"`;
}

/** Joins an array of raw values into one quoted CSV row. */
export function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/**
 * Date-only export timestamp, localized to the page language. Used by both the
 * CSV footer and the tree SVG export footer so downloads agree on the format.
 */
export function exportDateStr() {
  return new Date().toLocaleDateString(document.documentElement.lang || 'en');
}

/**
 * Standard CSV footer block: site title, domain, export date, then any
 * `extraRows` (e.g. a search-criteria block) after a blank-line separator, and
 * finally the full page URL as the very last row. Including the page URL here
 * means every export carries it (callers must not also append their own
 * `col_url` row). Returns an array of lines.
 */
export function csvFooter(extraRows = []) {
  const rows = [
    csvCell(t('site_title')),
    csvCell(window.location.hostname), // domain only, no protocol
    csvCell(exportDateStr()),
  ];
  if (extraRows.length) rows.push('', ...extraRows);
  rows.push(csvRow([t('col_url'), window.location.href])); // always the last row
  return rows;
}

/**
 * Joins the given CSV lines, prepends a UTF-8 BOM (so Excel reads diacritics
 * correctly), and triggers the download. Callers build the line array as
 * `[header, ...body, '', ...csvFooter(extra)]`.
 */
export function downloadCsv(lines, filename) {
  const content = lines.join('\n');
  downloadBlob(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' }), filename);
}
