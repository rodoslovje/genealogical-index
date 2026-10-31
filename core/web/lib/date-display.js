// HTML for GEDCOM dates in tables and detail panels: the compact display form
// from splitGedcomDate(), with the original value and what its qualifier means
// in a tooltip (tappable on touch screens via lib/tap-tip.js).
import { t } from '../i18n.js';
import { escapeHtml, highlightDifferences } from './utils.js';
import { splitGedcomDate } from './dates.js';

// Exact dates stay bare text — only a qualified date gets the span, which keeps
// large result tables light.
function wrap(raw, kind, inner) {
  if (kind === 'exact') return inner;
  const tip = escapeHtml(`${String(raw).trim()} · ${t(`date_kind_${kind}`)}`);
  return `<span class="gdate" tabindex="0" role="button" title="${tip}" aria-label="${tip}">${inner}</span>`;
}

/** Display HTML for one date value. */
export function dateHtml(raw) {
  if (!raw) return '';
  const d = splitGedcomDate(raw);
  return wrap(raw, d.kind, escapeHtml(d.pre + d.core + d.post));
}

/** Like dateHtml, with highlightDifferences() against the other record's date.
 *  The dates themselves are compared word by word as before; a qualifier mark
 *  the other side lacks (~1850 against 1850) is highlighted on its own, since
 *  it carries no word for the token comparison to catch. */
export function dateDiffHtml(val, otherVal, markAdd = true) {
  if (!val) return '';
  const d = splitGedcomDate(val);
  if (!otherVal) return wrap(val, d.kind, highlightDifferences(d.pre + d.core + d.post, '', markAdd));
  const o = splitGedcomDate(otherVal);
  const mark = (s, other) => (s && s !== other ? `<span class="match-diff">${escapeHtml(s)}</span>` : escapeHtml(s));
  return wrap(val, d.kind, mark(d.pre, o.pre) + highlightDifferences(d.core, o.core, markAdd) + mark(d.post, o.post));
}
