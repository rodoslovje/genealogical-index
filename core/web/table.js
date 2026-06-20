import { t } from './i18n.js';
import { formatLinks } from './lib/links.js';
import { isPrivate, cmp, getExpandCollapseIcon, baseContributorName, matriculaIndicatorHtml, geneanetIndicatorHtml, altSurnameIconHtml, baptismIconHtml, notesIconHtml, isSpecialContributor, escapeHtml, highlightDifferences, formatExportFilename, parseList, pairRelatives } from './lib/utils.js';
import { childYearOf, parseDateForSort } from './lib/dates.js';
import { toUnicodeHref } from './lib/url.js';
import { createExportButton } from './lib/icons.js';
import { exportToCSV } from './table-csv.js';
import { mountTableFilter, observeStickyHeader } from './lib/table-filter.js';
import siteConfig from '@site-config';

// Re-exported so existing importers (`contributors/*`, surname cloud) can keep
// importing the CSV export from './table.js'; the implementation now lives in
// table-csv.js.
export { exportToCSV };

const CENTERED_COLUMNS = new Set([
  'contributor', 'contributor_ID',
  'total_persons', 'total_families', 'total', 'total_links',
  'last_modified', 'links', 'matches', 'confidence',
]);

const RIGHT_COLUMNS = new Set([
  'date_of_birth', 'date_of_marriage', 'date_of_death', 'date_of_burial', 'husband_birth', 'wife_birth',
]);

const NUMERIC_COLUMNS = new Set([
  'total_persons', 'total_families', 'total', 'total_links', 'confidence', 'matches',
]);

const MATCHES_CONTEXT_COLS = new Set(['contributor_ID', 'total_persons', 'total_families', 'total']);

// Columns holding structured/rendered data (JSON lists, link icons) rather
// than plain text — skipped by the generic per-table filter below.
const FILTER_SKIP_COLUMNS = new Set(['children', 'parents', 'partners', 'links']);

// Above this row count, the table is rendered "virtualized": fixed column
// widths + per-row `content-visibility:auto` so the browser skips layout/paint
// of off-screen rows. Keeps large search/matches result sets fast to render and
// re-sort without holding thousands of laid-out rows. Below the threshold the
// table renders exactly as before (auto layout, no extra measuring pass).
const VIRTUAL_ROW_THRESHOLD = 150;
// Rows sampled (auto layout) to measure natural column widths before locking
// them for fixed layout. Small enough to render instantly, large enough to be
// representative; outlier-long cells in later rows just wrap instead of clip.
const VIRTUAL_SAMPLE_ROWS = 40;

// Above this row count a sort takes long enough to be worth a busy indicator.
// Below it the sort is instant, so we run synchronously and skip the spinner
// (which would otherwise add a frame of latency and a visible flicker).
const BUSY_SPINNER_ROW_THRESHOLD = 2000;

// Toggles a shared, centered spinner overlay. Used while a large table sorts or
// streams rows in: the spinner's CSS rotate animation is composited, so it keeps
// spinning even while the main thread is blocked — unlike a CSS `cursor` change,
// which most browsers only re-evaluate on the next mouse move. Calls are counted
// so overlapping busy sessions (e.g. a progressive row load plus a queued sort)
// don't hide the spinner early; it clears when the last session ends.
let _busyCount = 0;
export function setTableBusy(busy) {
  _busyCount = Math.max(0, _busyCount + (busy ? 1 : -1));
  let el = document.getElementById('table-busy-spinner');
  if (_busyCount > 0 && !el) {
    el = document.createElement('div');
    el.id = 'table-busy-spinner';
    el.innerHTML = '<div class="srd-spinner"></div>';
    document.body.appendChild(el);
  }
  if (el) el.classList.toggle('active', _busyCount > 0);
}

// Runs `work` behind the busy spinner when `heavy` is true, deferring two frames
// so the spinner actually paints before the (blocking) work runs. Otherwise runs
// synchronously. Shared by sort and expand/collapse-all across the tables.
//
// Re-entrant calls while an op is pending coalesce to the *latest* work — the
// right semantics for impatient repeat clicks: each handler mutates its state
// synchronously at click time, and the single deferred run reads that final
// state (e.g. two quick sort clicks toggle direction twice, then one reorder
// applies the net result).
let _pendingBusyWork = null;
export function runWithBusy(heavy, work) {
  if (!heavy) { work(); return; }
  if (_pendingBusyWork) { _pendingBusyWork = work; return; }
  _pendingBusyWork = work;
  setTableBusy(true);
  const step = () => {
    const job = _pendingBusyWork;
    try { job(); }
    catch (err) { console.error('table op failed', err); }
    if (_pendingBusyWork !== job) {
      // Newer work arrived while this ran — keep the spinner up and run it.
      requestAnimationFrame(() => requestAnimationFrame(step));
    } else {
      _pendingBusyWork = null;
      setTableBusy(false);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(step));
}

// Re-measures and re-locks a virtualized table's column widths against its
// current content. Used after expand/collapse-all: the colgroup was first
// measured while expandable cells were collapsed (just a count, hence narrow),
// so expanded content would otherwise be crammed into too-narrow fixed columns.
// The .virtual-table class is kept (content-visibility stays on), so the brief
// auto-layout measure only reflows the visible rows, not the whole table.
export function remeasureVirtualColumns(table) {
  if (!table || !table.classList.contains('virtual-table')) return;
  table.querySelector('colgroup')?.remove();
  table.style.tableLayout = 'auto';
  table.style.removeProperty('--vt-natural-width');
  const widths = Array.from(table.querySelectorAll('thead th'), th => th.offsetWidth);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const colgroup = document.createElement('colgroup');
  colgroup.innerHTML = widths.map(w => `<col style="width:${((w / total) * 100).toFixed(3)}%">`).join('');
  table.insertBefore(colgroup, table.firstChild);
  // Re-pin the natural width (applied as min-width at the mobile breakpoint so
  // phones pan via the .table-responsive wrapper instead of squeezing columns).
  table.style.setProperty('--vt-natural-width', `${Math.round(total)}px`);
  table.style.tableLayout = '';
}

// Renders the 🌳/🌿 tree button used in expandable parent/child/partner cells.
// Returns '' when the feature is gated, there's no name/surname to seed the
// tree, or the contributor is matricula (no stable IDs for tree nav).
function treeButton({ kind, n, sn, dob, contributor, extId }) {
  const feature  = kind === 'ancestors' ? 'ancestors' : 'descendants';
  const icon     = kind === 'ancestors' ? '🌳' : '🌿';
  const titleKey = kind === 'ancestors' ? 'tree_ancestors_title' : 'tree_descendants_title';
  if (siteConfig.gatedFeatures?.includes(feature)) return '';
  if (isSpecialContributor(contributor)) return '';
  if (!n && !sn) return '';
  const p = new URLSearchParams();
  p.set('t', kind);
  if (n)   p.set('n', n);
  if (sn)  p.set('sn', sn);
  if (dob) p.set('dob', dob);
  if (contributor) p.set('c', contributor);
  if (extId)       p.set('id', extId);
  return `<a href="${toUnicodeHref(p)}" data-spa-nav class="tree-link-btn" title="${t(titleKey)}">${icon}</a>`;
}

// Renders a name/surname cell — used by husband_*, wife_*, and plain name/surname
// columns. The three originally had ~20 lines of duplicated logic each.
function renderPersonNameCell(col, row, namePrefix, altField) {
  const nameField = namePrefix ? `${namePrefix}_name`    : 'name';
  const surField  = namePrefix ? `${namePrefix}_surname` : 'surname';
  const extField  = namePrefix ? `${namePrefix}_ext_id`  : 'ext_id';
  const isPriv    = isPrivate(row[nameField]) || isPrivate(row[surField]);
  const altIcon   = (col === surField && !isPriv) ? altSurnameIconHtml(row[altField], t('icon_alt_surname')) : '';
  const val = row[col];
  if (!val) return `<td>${altIcon}</td>`;
  const safeDisplay = escapeHtml(val);
  if (isPriv) {
    return `<td>${safeDisplay}${altIcon}</td>`;
  }
  const params = new URLSearchParams();
  params.set('t', 'person');
  if (row[nameField]) params.set('n',  row[nameField]);
  if (row[surField])  params.set('sn', row[surField]);
  if (row[extField]) {
    params.set('id', row[extField]);
    if (row.contributor) params.set('c', row.contributor);
  }
  params.set('ex', '1');
  return `<td><a href="${toUnicodeHref(params)}" class="name-link" data-spa-nav>${safeDisplay}</a>${altIcon}</td>`;
}

// A parent-pair has up to two entries (father, mother). Each "filled" if any
// identifying field is set.
function countParentPair(jsonOrArr) {
  const arr = parseList(jsonOrArr);
  if (!arr.length) return 0;
  const isFilled = (p) => !!(p && (p.name || p.surname || p.date_of_birth || p.year));
  return (isFilled(arr[0]) ? 1 : 0) + (isFilled(arr[1]) ? 1 : 0);
}

function getValue(row, col) {
  if (col === 'parents') {
    return memoCount(row, 'parents', () => (row.husband_parents || row.wife_parents)
      ? countParentPair(row.husband_parents) + countParentPair(row.wife_parents)
      : countParentPair(row.parents_list));
  }
  if (col === 'partners') return memoCount(row, 'partners', () => parseList(row.partners_list).length);
  if (col === 'children') return memoCount(row, 'children', () => parseList(row.children_list).length);
  if (col === 'links')    return parseList(row.links).length;
  if (col === 'matches')  return Number(row.matches_count || 0);
  if (RIGHT_COLUMNS.has(col))   return parseDateForSort(row[col]);
  if (NUMERIC_COLUMNS.has(col)) return Number(row[col] || 0);
  return String(row[col] || '').toLowerCase();
}

// Generic substring match for the per-table text filter: true if `query`
// appears in any non-skipped column's raw value.
function rowMatchesQuery(row, columns, query) {
  for (const col of columns) {
    if (FILTER_SKIP_COLUMNS.has(col)) continue;
    const val = row[col];
    if (val != null && String(val).toLowerCase().includes(query)) return true;
  }
  return false;
}

function sortData(data, primary, secondary) {
  // Decorate-sort: precompute each row's sort key(s) once (O(n)) instead of
  // recomputing getValue() inside the comparator (O(n log n)). getValue does
  // real work per call (toLowerCase, date parsing, JSON list counting), so on
  // a 20k-row table this is the difference between snappy and multi-second.
  const pKey = new Map();
  const sKey = secondary ? new Map() : null;
  for (const row of data) {
    pKey.set(row, getValue(row, primary.column));
    if (sKey) sKey.set(row, getValue(row, secondary.column));
  }
  const dir = primary.ascending ? 1 : -1;
  const sdir = secondary && secondary.ascending ? 1 : -1;
  data.sort((a, b) => {
    const r = cmp(pKey.get(a), pKey.get(b));
    if (r !== 0) return r * dir;
    if (sKey) return cmp(sKey.get(a), sKey.get(b)) * sdir;
    return 0;
  });
}

const yearsDiffer = (a, b) => String(a || '') !== String(b || '');

// Counts derived from children/parents/partners lists are looked up many times
// per sort. Cache off-row so we don't mutate caller-owned data with `_*_count`
// fields.
const rowCountCache = new WeakMap();
function memoCount(row, key, compute) {
  let cache = rowCountCache.get(row);
  if (cache && key in cache) return cache[key];
  if (!cache) { cache = {}; rowCountCache.set(row, cache); }
  cache[key] = compute();
  return cache[key];
}

// Wraps the count + tree button + body in the standard <details> shell used
// for parents/children/partners cells.
function wrapExpandable(count, treeBtn, innerHtml) {
  if (!count) return '';
  return `<details class="expandable-cell">
            <summary>${count}${treeBtn || ''}</summary>
            <div class="expanded-content">${innerHtml}</div>
          </details>`;
}

const diffWrap = (html) => `<span class="match-diff">${html}</span>`;

// Builds the "name surname" portion of a person entry with word-level diff
// against the matched other-side entry. Private entries (where name/surname is
// a placeholder like '<private>'/'unknown') skip the diff — comparing them
// would just flag the placeholder text itself.
function buildNameSurnameHtml(p, other, diffOn, markAdd = true, emptyOtherIsDiff = false) {
  const name = p?.name || '';
  const sur  = p?.surname || '';
  const isPriv = isPrivate(name) || isPrivate(sur);
  if (!diffOn || isPriv || !other) {
    const label = isPriv ? (name || sur) : [name, sur].filter(Boolean).join(' ');
    return escapeHtml(label);
  }
  const otherName = other.name || '';
  const otherSur  = other.surname || '';
  const nameHtml = name ? highlightDifferences(name, otherName, markAdd, emptyOtherIsDiff) : '';
  const surHtml  = sur  ? highlightDifferences(sur,  otherSur,  markAdd, emptyOtherIsDiff) : '';
  return [nameHtml, surHtml].filter(Boolean).join(' ');
}

// Wraps already-HTML-safe inner content in a person-search anchor, unless the
// person is private or has no name — in which case the inner HTML is returned
// as-is. Caller is responsible for escaping/wrapping `innerHtml`.
function wrapPersonAnchor(name, surname, innerHtml, extId, contributor) {
  if (isPrivate(name) || isPrivate(surname)) return innerHtml;
  if (!name && !surname) return innerHtml;
  const p = new URLSearchParams();
  p.set('t', 'person');
  if (name) p.set('n', name);
  if (surname) p.set('sn', surname);
  if (extId) {
    p.set('id', extId);
    if (contributor) p.set('c', contributor);
  }
  p.set('ex', '1');
  return `<a href="${toUnicodeHref(p)}" class="name-link" data-spa-nav>${innerHtml}</a>`;
}

function renderParentPair(parentsJson, labelKey, rootPerson = null, otherParentsJson, contributor = null, isB = false) {
  if (!parentsJson) return { html: '', count: 0 };
  try {
    const pList = typeof parentsJson === 'string' ? JSON.parse(parentsJson) : parentsJson;
    if (!pList || pList.length === 0) return { html: '', count: 0 };

    const father = pList[0] || {};
    const mother = pList[1] || {};

    // Positional diff: father vs other's father, mother vs other's mother.
    // undefined => diff mode off; any defined value (even null) enables it.
    // We compare name & surname separately (via highlightDifferences) and the
    // year separately too — so partial diffs highlight just the part that
    // actually changed (e.g. only the surname).
    const diffOn = otherParentsJson !== undefined;
    const oList = diffOn ? parseList(otherParentsJson) : [];
    const otherFather = oList[0] || {};
    const otherMother = oList[1] || {};
    // A parent that's entirely missing on the other side is "added" rather
    // than "different" — name/surname/year are highlighted green-only on B's
    // side (and plain on A's), never as a conflict.
    const fatherOnly = diffOn && !(otherFather.name || otherFather.surname) && (father.name || father.surname);
    const motherOnly = diffOn && !(otherMother.name || otherMother.surname) && (mother.name || mother.surname);
    const fatherYearDiff = diffOn && !fatherOnly && yearsDiffer(childYearOf(father), childYearOf(otherFather));
    const motherYearDiff = diffOn && !motherOnly && yearsDiffer(childYearOf(mother), childYearOf(otherMother));
    if (!father.name && !father.surname && !mother.name && !mother.surname) return { html: '', count: 0 };

    const fName = father.name || '';
    const fSur = father.surname || '';
    const fYear = childYearOf(father);
    const fExtId = father.id || '';
    const mName = mother.name || '';
    const mSur = mother.surname || '';
    const mYear = childYearOf(mother);
    const mExtId = mother.id || '';

    const fPriv = isPrivate(fName) || isPrivate(fSur);
    const mPriv = isPrivate(mName) || isPrivate(mSur);

    const famParams = new URLSearchParams();
    famParams.set('t', 'family');
    if (fName && !fPriv) famParams.set('hn', fName);
    if (fSur && !fPriv) famParams.set('hsn', fSur);
    if (mName && !mPriv) famParams.set('wn', mName);
    if (mSur && !mPriv) famParams.set('wsn', mSur);
    famParams.set('ex', '1');

    const fYearTok = fYear ? `*${fYear}` : '';
    const mYearTok = mYear ? `*${mYear}` : '';
    const fNameHtml = buildNameSurnameHtml(father, otherFather, diffOn, isB, !fatherOnly);
    const mNameHtml = buildNameSurnameHtml(mother, otherMother, diffOn, isB, !motherOnly);
    const fYearHtml = fYearTok
      ? (fatherOnly ? (isB ? `<span class="match-add">${escapeHtml(fYearTok)}</span>` : escapeHtml(fYearTok))
                    : (fatherYearDiff ? diffWrap(escapeHtml(fYearTok)) : escapeHtml(fYearTok)))
      : '';
    const mYearHtml = mYearTok
      ? (motherOnly ? (isB ? `<span class="match-add">${escapeHtml(mYearTok)}</span>` : escapeHtml(mYearTok))
                    : (motherYearDiff ? diffWrap(escapeHtml(mYearTok)) : escapeHtml(mYearTok)))
      : '';
    const fInner = fNameHtml + (fYearHtml ? ' ' + fYearHtml : '');
    const mInner = mNameHtml + (mYearHtml ? ' ' + mYearHtml : '');

    let count = 0;
    if (fName || fSur) count++;
    if (mName || mSur) count++;

    const headerLabel = labelKey ? t(labelKey) : t('col_parents');
    let htmlStr = `<div class="parent-group" style="margin-bottom: 8px;">`;
    const hasSearchFields = famParams.has('hn') || famParams.has('hsn') || famParams.has('wn') || famParams.has('wsn');

    // ext_id + contributor is the GEDCOM primary key, used for exact lookup.
    const treeBtn = rootPerson
      ? treeButton({
          kind: 'ancestors',
          n: rootPerson.name,
          sn: rootPerson.surname,
          dob: rootPerson.date_of_birth || childYearOf(rootPerson),
          contributor: rootPerson.contributor,
          extId: rootPerson.ext_id,
        })
      : '';

    if (hasSearchFields) {
      htmlStr += `<a href="${toUnicodeHref(famParams)}" class="name-link" data-spa-nav style="font-weight: 600;">${headerLabel}:</a>${treeBtn}<br>`;
    } else {
      htmlStr += `<span style="font-weight: 600;">${headerLabel}:</span>${treeBtn}<br>`;
    }
    if (fName || fSur) htmlStr += `${wrapPersonAnchor(fName, fSur, fInner, fExtId, contributor)}<br>`;
    if (mName || mSur) htmlStr += `${wrapPersonAnchor(mName, mSur, mInner, mExtId, contributor)}`;
    htmlStr += `</div>`;
    return { html: htmlStr, count };
  } catch(e) {
    return { html: '', count: 0 };
  }
}

export function formatSpecialCell(col, row, otherRow, isB = false) {
  const diffMode = otherRow !== undefined;

  if (col === 'children' && row.children_list) {
    const otherChildren = diffMode ? parseList(otherRow?.children_list) : [];
    const pList = parseList(row.children_list);
    const count = pList.length;
    const childMatches = diffMode ? pairRelatives(pList, otherChildren, true) : null;
    const formattedList = pList.map(c => {
        const cPriv = isPrivate(c.name) || isPrivate(c.surname);
        const showSurname = !cPriv && c.surname && c.surname !== row.husband_surname;
        const cy = childYearOf(c);
        const yearTok = cy ? `*${cy}` : '';

        const match = childMatches ? childMatches.get(c) : null;
        const noMatch = diffMode && !cPriv && !match && (c.name || c.surname);
        const yearDiff = !!match && yearsDiffer(cy, childYearOf(match));

        let labelHtml;
        if (cPriv || !diffMode || !match) {
          const label = cPriv ? (c.name || c.surname || '') : (c.name || '') + (showSurname ? ' ' + c.surname : '');
          labelHtml = escapeHtml(label.trim());
        } else {
          const nameHtml = c.name    ? highlightDifferences(c.name, match.name || '', isB, true)       : '';
          const surHtml  = showSurname ? highlightDifferences(c.surname, match.surname || '', isB, true) : '';
          labelHtml = [nameHtml, surHtml].filter(Boolean).join(' ');
        }

        const innerHtml = labelHtml +
          (yearTok ? ' ' + (yearDiff ? diffWrap(escapeHtml(yearTok)) : escapeHtml(yearTok)) : '');

        let entry;
        if (cPriv) {
          entry = innerHtml.trim();
        } else {
          const params = new URLSearchParams();
          params.set('t', 'person');
          if (c.name) params.set('n', c.name);
          if (c.surname) params.set('sn', c.surname);
          const dob = c.date_of_birth || cy;
          if (dob) params.set('dob', dob);
          if (c.id) {
            params.set('id', c.id);
            if (row.contributor) params.set('c', row.contributor);
          }
          params.set('ex', '1');
          entry = `<a href="${toUnicodeHref(params)}" data-spa-nav>${innerHtml}</a>`;
        }

        // A child only known to B is "added" (green), not a conflict.
        if (noMatch) entry = isB ? `<span class="match-add">${entry}</span>` : diffWrap(entry);
        return entry;
      });

    // Seed the descendants tree from whichever spouse has a usable name.
    let treeBtn = '';
    if (row.id && count > 0) {
      const useHusband = row.husband_name && !isPrivate(row.husband_name);
      const useWife    = !useHusband && row.wife_name && !isPrivate(row.wife_name);
      if (useHusband || useWife) {
        treeBtn = treeButton({
          kind: 'descendants',
          n:    useHusband ? row.husband_name    : row.wife_name,
          sn:   useHusband ? row.husband_surname : row.wife_surname,
          dob:  useHusband ? row.husband_birth   : row.wife_birth,
          contributor: row.contributor,
          extId: useHusband ? row.husband_ext_id : row.wife_ext_id,
        });
      }
    }

    return wrapExpandable(count, treeBtn, formattedList.join('<br>'));
  }

  if (col === 'parents' && row.parents_list) {
    const otherParents = diffMode ? (otherRow?.parents_list ?? null) : undefined;
    const { html, count } = renderParentPair(row.parents_list, null, null, otherParents, row.contributor, isB);
    const treeBtn = (count > 0 && row.id) ? treeButton({
      kind: 'ancestors',
      n: row.name,
      sn: row.surname,
      dob: row.date_of_birth || childYearOf(row),
      contributor: row.contributor,
      extId: row.ext_id,
    }) : '';
    return wrapExpandable(count, treeBtn, html);
  }

  if (col === 'parents' && (row.husband_parents || row.wife_parents)) {
    const otherHusbandParents = diffMode ? (otherRow?.husband_parents ?? null) : undefined;
    const otherWifeParents    = diffMode ? (otherRow?.wife_parents ?? null)    : undefined;
    const husband = renderParentPair(row.husband_parents, 'label_husband', {
      name: row.husband_name,
      surname: row.husband_surname,
      date_of_birth: row.husband_birth,
      contributor: row.contributor,
      ext_id: row.husband_ext_id
    }, otherHusbandParents, row.contributor, isB);
    const wife = renderParentPair(row.wife_parents, 'label_wife', {
      name: row.wife_name,
      surname: row.wife_surname,
      date_of_birth: row.wife_birth,
      contributor: row.contributor,
      ext_id: row.wife_ext_id
    }, otherWifeParents, row.contributor, isB);
    return wrapExpandable(husband.count + wife.count, '', husband.html + wife.html);
  }

  if (col === 'partners' && row.partners_list) {
    const treeBtn = row.id ? treeButton({
      kind: 'descendants',
      n: row.name,
      sn: row.surname,
      dob: row.date_of_birth || childYearOf(row),
      contributor: row.contributor,
      extId: row.ext_id,
    }) : '';
    const otherPartners = diffMode ? parseList(otherRow?.partners_list) : [];
    const pList = parseList(row.partners_list);
    const partnerMatches = diffMode ? pairRelatives(pList, otherPartners) : null;
    const formattedList = pList.map(p => {
        const isHusband = p.sex === 'm';
        const famParams = new URLSearchParams();
        famParams.set('t', 'family');
        if (isHusband) {
          if (p.name && !isPrivate(p.name))     famParams.set('hn',  p.name);
          if (p.surname)                         famParams.set('hsn', p.surname);
          if (row.name && !isPrivate(row.name)) famParams.set('wn',  row.name);
          if (row.surname)                       famParams.set('wsn', row.surname);
        } else {
          if (row.name && !isPrivate(row.name)) famParams.set('hn',  row.name);
          if (row.surname)                       famParams.set('hsn', row.surname);
          if (p.name && !isPrivate(p.name))     famParams.set('wn',  p.name);
          if (p.surname)                         famParams.set('wsn', p.surname);
        }
        famParams.set('ex', '1');
        const py = childYearOf(p);
        const pPriv = isPrivate(p.name);
        const yearTok = py ? `*${py}` : '';

        const match = partnerMatches ? partnerMatches.get(p) : null;
        const noMatch = diffMode && !pPriv && !match && (p.name || p.surname);
        const yearDiff = !!match && yearsDiffer(py, childYearOf(match));

        let labelHtml;
        if (pPriv || !diffMode || !match) {
          const text = pPriv ? p.name : (p.name || '') + (p.surname ? ' ' + p.surname : '');
          labelHtml = escapeHtml(String(text || '').trim());
        } else {
          const nameHtml = p.name    ? highlightDifferences(p.name, match.name || '', isB, true)       : '';
          const surHtml  = p.surname ? highlightDifferences(p.surname, match.surname || '', isB, true) : '';
          labelHtml = [nameHtml, surHtml].filter(Boolean).join(' ');
        }

        let innerHtml = labelHtml +
          (yearTok ? ' ' + (yearDiff ? diffWrap(escapeHtml(yearTok)) : escapeHtml(yearTok)) : '');
        // A partner only known to B is "added" (green), not a conflict.
        if (noMatch && isB) innerHtml = `<span class="match-add">${innerHtml}</span>`;
        const label = isHusband ? t('label_husband') : (p.sex === 'f' ? t('label_wife') : '');
        let entry = `<a href="${toUnicodeHref(famParams)}" data-spa-nav${label ? ` title="${label}"` : ''}>${innerHtml}</a>`;
        if (noMatch && !isB) entry = diffWrap(entry);
        return entry;
    });
    return wrapExpandable(pList.length, treeBtn, formattedList.join('<br>'));
  }

  return null;
}

function buildArrowIndicator(col, state) {
  if (state?.primary?.column === col)   return state.primary.ascending   ? '&nbsp;▲' : '&nbsp;▼';
  if (state?.secondary?.column === col) return state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';
  return '';
}

// Renders a single `<td>` for one (col, row) pair. Extracted from
// renderRowsHtml so cell behavior can be reasoned about in isolation.
function renderCellHtml(col, row) {
  if (col === 'links') {
    const icons = formatLinks(row.links);
    return icons ? `<td class="link-cell">${icons}</td>` : '<td></td>';
  }
  if (col === 'matches') {
    const count = row.matches_count || 0;
    return `<td class="col-center">${count > 0 ? count : ''}</td>`;
  }
  if (col === 'confidence') {
    return `<td class="col-center">${row[col] != null ? `${row[col]}%` : '—'}</td>`;
  }
  if (col === 'contributor_ID') {
    const name = row[col] || '';
    const display = baseContributorName(name);
    const showIndicator = !row.hasOwnProperty('_tree');
    const indicator = showIndicator
      ? matriculaIndicatorHtml(name, t('icon_matricula_index')) + geneanetIndicatorHtml(name, t('icon_geneanet_index'))
      : '';
    const internalHref = row._match_href || row._contributor_href || '';
    const externalUrl = row._url || '';
    if (internalHref) return `<td class="col-center"><a href="${internalHref}" data-spa-nav>${display}</a>${indicator}</td>`;
    if (externalUrl)  return `<td class="col-center"><a href="${externalUrl}" target="_blank" rel="noopener">${display}</a>${indicator}</td>`;
    return `<td class="col-center">${display}${indicator}</td>`;
  }
  if (col === 'contributor') {
    const name = row[col] || '';
    if (!name) return `<td></td>`;
    const display = baseContributorName(name);
    const indicator = matriculaIndicatorHtml(name, t('icon_matricula_index')) + geneanetIndicatorHtml(name, t('icon_geneanet_index'));
    return `<td><a href="${toUnicodeHref({ t: 'contributors', c: display })}" data-spa-nav>${display}</a>${indicator}</td>`;
  }
  if (CENTERED_COLUMNS.has(col)) {
    let val = NUMERIC_COLUMNS.has(col) && row[col] != null ? Number(row[col]).toLocaleString() : (row[col] || '');
    if (col === 'total_links' && Number(row[col] || 0) === 0) val = '';
    return `<td class="col-center">${val}</td>`;
  }
  if (RIGHT_COLUMNS.has(col)) {
    const raw = escapeHtml(row[col]);
    const extra = col === 'date_of_birth'
      ? baptismIconHtml(row.date_of_baptism, row.place_of_baptism, t('icon_baptism'))
      : '';
    return `<td class="col-right">${raw}${extra}</td>`;
  }
  if (col === 'husband_name' || col === 'husband_surname') return renderPersonNameCell(col, row, 'husband', 'husband_alt_surname');
  if (col === 'wife_name'    || col === 'wife_surname')    return renderPersonNameCell(col, row, 'wife',    'wife_alt_surname');
  if (col === 'name' || col === 'surname') {
    return renderPersonNameCell(col, row, '', 'alt_surname');
  }
  if (col === 'children' || col === 'parents' || col === 'partners') {
    return `<td>${formatSpecialCell(col, row) || ''}</td>`;
  }
  const raw = escapeHtml(row[col]);
  const extra = (col === 'place_of_birth' || col === 'place_of_marriage')
    ? notesIconHtml(row.notes, t('icon_notes'))
    : '';
  return `<td>${raw}${extra}</td>`;
}

// Builds the per-row `<tr>` HTML. Used both for initial render and for the
// in-place sort re-render (which replaces only `<tbody>` so the surrounding
// `<thead>` listeners and toolbar buttons survive).
function renderRowsHtml(data, columns) {
  return data.map(row =>
    '<tr>' + columns.map(col => renderCellHtml(col, row)).join('') + '</tr>'
  ).join('');
}

// Rows appended per async batch while progressively mounting a large table.
// Big enough that a 20k-row table needs ~20 batches, small enough that each
// batch's HTML build + parse stays well under a frame budget.
const PROGRESSIVE_CHUNK_ROWS = 1000;

// Mounts the table HTML into the container, then calls `onRowsReady` once every
// row is in the DOM. Small tables render in one shot (auto layout) and the
// callback runs synchronously. Large tables get the virtualized treatment:
// a small sample is rendered first to measure natural column widths, those are
// locked as percentages via a <colgroup> (fixed layout + content-visibility,
// `.virtual-table` in style.css), the first chunk of rows renders synchronously,
// and the rest stream in on setTimeout batches behind the busy spinner — first
// paint is bounded by the chunk size, not the result count. Interactive wiring
// (sort listeners, expand toggle) belongs in onRowsReady so it never sees a
// half-populated tbody.
function mountTableHtml(container, data, columns, theadHtml, onRowsReady) {
  if (data.length <= VIRTUAL_ROW_THRESHOLD) {
    container.innerHTML = `<table>${theadHtml}<tbody>${renderRowsHtml(data, columns)}</tbody></table>`;
    onRowsReady();
    return;
  }

  // Pass 1: thead + a representative sample, auto layout, to measure widths.
  const sampleHtml = renderRowsHtml(data.slice(0, VIRTUAL_SAMPLE_ROWS), columns);
  container.innerHTML = `<table>${theadHtml}<tbody>${sampleHtml}</tbody></table>`;
  const widths = Array.from(container.querySelectorAll('thead th'), (th) => th.offsetWidth);
  const total = widths.reduce((a, b) => a + b, 0) || 1;
  const colgroup =
    '<colgroup>' +
    widths.map((w) => `<col style="width:${((w / total) * 100).toFixed(3)}%">`).join('') +
    '</colgroup>';

  // Pass 2: first chunk with widths locked + virtualization class; any
  // remaining rows stream in asynchronously below. --vt-natural-width records
  // the measured natural width; the mobile breakpoint applies it as min-width
  // so on phones the columns stop squeezing and the .table-responsive wrapper
  // pans horizontally instead (headers and cells stay readable). Desktop keeps
  // width:100% + sticky headers, which an always-on min-width would break by
  // forcing the clip-overflow wrapper to cut the table off.
  const firstChunk = renderRowsHtml(data.slice(0, PROGRESSIVE_CHUNK_ROWS), columns);
  container.innerHTML =
    `<table class="virtual-table" style="--vt-natural-width:${Math.round(total)}px">${colgroup}${theadHtml}<tbody>${firstChunk}</tbody></table>`;
  if (data.length <= PROGRESSIVE_CHUNK_ROWS) {
    onRowsReady();
    return;
  }

  const tbody = container.querySelector('tbody');
  let next = PROGRESSIVE_CHUNK_ROWS;
  setTableBusy(true);
  const appendChunk = () => {
    // A newer render replaced the table, or the user navigated away — stop.
    // onRowsReady is deliberately skipped: its wiring would target dead nodes.
    if (!tbody.isConnected) {
      setTableBusy(false);
      return;
    }
    tbody.insertAdjacentHTML(
      'beforeend',
      renderRowsHtml(data.slice(next, next + PROGRESSIVE_CHUNK_ROWS), columns)
    );
    next += PROGRESSIVE_CHUNK_ROWS;
    if (next < data.length) {
      setTimeout(appendChunk, 0);
    } else {
      setTableBusy(false);
      onRowsReady();
    }
  };
  setTimeout(appendChunk, 0);
}

export function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true, defaultSecondarySortColumn = null) {
  const container = document.getElementById(containerId);
  const headerEl = container.previousElementSibling;
  const isHeaderValid = headerEl && (headerEl.tagName === 'H2' || headerEl.classList.contains('totals-bar'));

  // Reset collapse state on a new render to ensure content isn't accidentally hidden
  container.style.display = '';
  if (isHeaderValid && headerEl.classList.contains('collapsed')) {
    headerEl.classList.remove('collapsed');
  }

  // Full unfiltered set, kept across filter-only re-renders (see `query` below)
  // so typing in the filter doesn't need the caller to re-fetch/re-supply data.
  container._allData = data;

  let query = '';
  if (isHeaderValid) {
    query = mountTableFilter({
      headerEl,
      paramKey: containerId.replace(/^table-/, ''),
      placeholder: t('table_filter_placeholder'),
      title: t('tip_table_filter'),
      onChange: () => renderTable(container._allData, containerId, columns, defaultSortColumn, defaultSortAscending, defaultSecondarySortColumn),
    });
    observeStickyHeader(headerEl, container);
  }
  const rows = query ? data.filter(row => rowMatchesQuery(row, columns, query)) : data;

  if (rows.length === 0) {
    container.innerHTML = `<p>${t('no_results')}</p>`;
    if (isHeaderValid) {
      let btn = headerEl.querySelector('.export-btn');
      if (btn) btn.remove();
    }
    return;
  }

  if (!container._sortState) {
    container._sortState = {
      primary: defaultSortColumn ? { column: defaultSortColumn, ascending: defaultSortAscending } : null,
      secondary: defaultSecondarySortColumn ? { column: defaultSecondarySortColumn, ascending: true } : null,
    };
  }

  const { primary, secondary } = container._sortState;
  if (primary) sortData(rows, primary, secondary);

  // Detect family vs. person table by the presence of husband-side columns;
  // the matches-summary table is identified by its container id.
  const isFamilyTable = columns.includes('husband_name') || columns.includes('husband_surname');
  const isMatchesSummary = containerId === 'matches-summary';

  let theadHtml = '<thead><tr>';
  columns.forEach(col => {
    const cls = CENTERED_COLUMNS.has(col) ? ' class="sortable col-center"' : RIGHT_COLUMNS.has(col) ? ' class="sortable col-right"' : ' class="sortable"';
    let tipKey;
    if (col === 'parents') {
      tipKey = isFamilyTable ? 'tip_parents_family' : 'tip_parents_person';
    } else if (isMatchesSummary && MATCHES_CONTEXT_COLS.has(col)) {
      tipKey = `tip_${col}_matches`;
    } else {
      tipKey = `tip_${col}`;
    }
    const tipText = t(tipKey);
    const titleAttr = tipText && tipText !== tipKey ? ` title="${tipText.replace(/"/g, '&quot;')}"` : '';
    theadHtml += `<th data-col="${col}"${cls}${titleAttr}>${t(`col_${col}`)}${buildArrowIndicator(col, container._sortState)}</th>`;
  });
  theadHtml += '</tr></thead>';

  // All interactive wiring waits for the (possibly progressive) mount to finish
  // so it never operates on a half-populated tbody — sort headers and toolbar
  // buttons appear once every row is in the DOM (spinner covers the meantime).
  mountTableHtml(container, rows, columns, theadHtml, () => {
    // Map each row object to its freshly-rendered <tr>. Sorting then reorders
    // these existing nodes (see the sort handler) instead of regenerating the
    // whole <tbody> — no cell HTML is rebuilt and open <details> survive because
    // the same nodes move. The map is rebuilt on every full render, when the
    // tbody row order still matches `rows`.
    const rowTrs = new Map();
    {
      const trs = container.querySelector('tbody').children;
      for (let i = 0; i < rows.length; i++) rowTrs.set(rows[i], trs[i]);
    }

    // Hoisted so the sort handler can reset the expand toggle after a re-render
    // (rebuilt <tbody> always starts with all <details> collapsed).
    let expandBtn = null;
    let setExpandLabel = () => {};

    if (isHeaderValid) {
      if (headerEl.tagName === 'H2' && !headerEl.classList.contains('collapsible-header')) {
        headerEl.classList.add('collapsible-header');
        headerEl.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('a')) return;
          const isCollapsed = container.style.display === 'none';
          // Clicking into the filter input should never collapse an already-
          // open table (it's just placing a text cursor) — only expand a
          // collapsed one, since you'd want to see the rows you're filtering.
          if (e.target.closest('input') && !isCollapsed) return;
          container.style.display = isCollapsed ? '' : 'none';
          headerEl.classList.toggle('collapsed', !isCollapsed);
        });
      }

      headerEl.querySelectorAll('.export-btn, .expand-toggle-btn').forEach(b => b.remove());

      // Expand/collapse-all toggle — only show when the rendered table actually
      // has expandable cells (parents/partners/children).  Skipping it on tables
      // that don't keeps the header uncluttered.
      const expandables = container.querySelectorAll('details.expandable-cell');
      if (expandables.length) {
        expandBtn = document.createElement('button');
        expandBtn.className = 'export-btn expand-toggle-btn';
        setExpandLabel = (allOpen) => {
          const labelText = t(allOpen ? 'collapse_all' : 'expand_all');
          expandBtn.innerHTML = `${getExpandCollapseIcon(allOpen)}${labelText}`;
          expandBtn.title = t(allOpen ? 'tip_collapse_all' : 'tip_expand_all');
          expandBtn.dataset.allOpen = allOpen ? '1' : '0';
        };
        // Initial state reflects current details (typically all collapsed).
        const initialAllOpen = Array.from(expandables).every(d => d.open);
        setExpandLabel(initialAllOpen);
        expandBtn.addEventListener('click', () => {
          const targetOpen = expandBtn.dataset.allOpen !== '1';
          runWithBusy(rows.length > BUSY_SPINNER_ROW_THRESHOLD, () => {
            container.querySelectorAll('details.expandable-cell').forEach(d => { d.open = targetOpen; });
            // Expanded cells need more width than the collapsed-state colgroup
            // allotted, so re-lock column widths against the new content.
            remeasureVirtualColumns(container.querySelector('table.virtual-table'));
            setExpandLabel(targetOpen);
          });
        });
      }

      const btn = createExportButton({
        label: 'CSV',
        title: t('download_csv'), // Keeps the tooltip translation for accessibility
        onClick: () => {
          const baseName = containerId.replace('table-', '');
          exportToCSV(rows, columns, formatExportFilename(baseName, 'csv'));
        },
      });

      if (headerEl.classList.contains('totals-bar')) {
        if (expandBtn) headerEl.appendChild(expandBtn);
        headerEl.appendChild(btn);
      } else {
        // Prepended in reverse order so the visible left-to-right order is: CSV, Expand
        if (expandBtn) headerEl.insertBefore(expandBtn, headerEl.firstChild);
        headerEl.insertBefore(btn, headerEl.firstChild);
      }
    }

    container.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        const state = container._sortState;
        if (state.primary?.column === col) {
          // Toggle direction on already-primary column
          state.primary.ascending = !state.primary.ascending;
        } else {
          // Clicked column becomes primary; old primary becomes secondary
          state.secondary = state.primary;
          state.primary = { column: col, ascending: true };
        }
        // Re-sort in place, update <thead> arrows, then reorder the existing <tr>
        // nodes to match. <thead> stays put so the click listeners survive;
        // headerEl buttons (CSV / expand-all) are outside `container` and
        // untouched.
        const applySort = () => {
          sortData(rows, state.primary, state.secondary);
          container.querySelectorAll('thead th.sortable').forEach(thNode => {
            const c = thNode.dataset.col;
            thNode.innerHTML = `${t(`col_${c}`)}${buildArrowIndicator(c, state)}`;
          });

          // Move the existing rows into the new order via one fragment append,
          // instead of rebuilding the <tbody> HTML. appendChild relocates the live
          // nodes, so no cells are re-rendered and any open <details> stay open —
          // which is why the old capture/restore dance is gone.
          const tbody = container.querySelector('tbody');
          const frag = document.createDocumentFragment();
          for (const row of rows) {
            const tr = rowTrs.get(row);
            if (tr) frag.appendChild(tr);
          }
          tbody.appendChild(frag);

          // Sync the expand-all toggle to reflect the (preserved) state.
          const allEls = container.querySelectorAll('details.expandable-cell');
          setExpandLabel(allEls.length > 0 && Array.from(allEls).every(d => d.open));
        };

        // For large tables the sort blocks the main thread long enough to feel
        // unresponsive, so run it behind the spinner (deferred so it paints first).
        runWithBusy(rows.length > BUSY_SPINNER_ROW_THRESHOLD, applySort);
      });
    });
  });
}
