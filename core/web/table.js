import { t } from './i18n.js';
import { formatLinks } from './links.js';
import { isPrivate, cmp, getExpandCollapseIcon, baseContributorName, matriculaIndicatorHtml, altSurnameIconHtml, baptismIconHtml, notesIconHtml, isMatriculaContributor, escapeHtml, highlightDifferences, downloadBlob, formatExportFilename } from './utils.js';
import { childYearOf, parseDateForSort } from './dates.js';
import { PARAM_MAP_REVERSE, toUnicodeHref } from './url.js';
import siteConfig from '@site-config';

export function exportToCSV(data, columns, filename) {
  if (!data || !data.length) return;
  const headers = columns.map(col => `"${t('col_' + col).replace(/"/g, '""')}"`).join(',');
  // Renders a parent pair as plain text, optionally prefixed with a side label
  // (husband/wife) when both pairs are concatenated into one cell.
  const formatParentPair = (jsonOrArr, label) => {
    const arr = parseList(jsonOrArr);
    if (!arr.length) return '';
    const parts = [arr[0], arr[1]].filter(Boolean).map(p => personInlineText(p, '')).filter(Boolean);
    if (!parts.length) return '';
    const inner = parts.join(', ');
    return label ? `${label}: ${inner}` : inner;
  };

  const rows = data.map(row => {
    return columns.map(col => {
      let val = '';
      if (col === 'parents') {
        if (row.parents_list) {
          val = formatParentPair(row.parents_list);
        } else {
          const hp = formatParentPair(row.husband_parents, t('label_husband'));
          const wp = formatParentPair(row.wife_parents,    t('label_wife'));
          val = [hp, wp].filter(Boolean).join(' | ');
        }
      } else if (col === 'children' && row.children_list) {
        val = parseList(row.children_list)
          .map(c => personInlineText(c, row.husband_surname))
          .join(', ');
      } else if (col === 'partners' && row.partners_list) {
        val = parseList(row.partners_list).map(p => {
          const text = personInlineText(p, '').trim();
          const label = p.sex === 'm' ? t('label_husband') : p.sex === 'f' ? t('label_wife') : '';
          return label ? `${label}: ${text}` : text;
        }).join(' | ');
      } else if (col === 'matches') {
        val = row.matches_count || '';
        if (Number(val) === 0) val = '';
      } else {
        let cellVal = row[col] != null ? row[col] : '';
        if (col === 'total_links' && Number(cellVal) === 0) cellVal = '';

        // Append optional fields to match HTML table display
        if (col === 'surname' && row.alt_surname) {
          cellVal = `${cellVal} (${row.alt_surname})`.trim();
        } else if (col === 'husband_surname' && row.husband_alt_surname) {
          cellVal = `${cellVal} (${row.husband_alt_surname})`.trim();
        } else if (col === 'wife_surname' && row.wife_alt_surname) {
          cellVal = `${cellVal} (${row.wife_alt_surname})`.trim();
        } else if (col === 'date_of_birth' && (row.date_of_baptism || row.place_of_baptism)) {
          const b = [row.date_of_baptism, row.place_of_baptism].filter(Boolean).join(', ');
          cellVal = `${cellVal} (✝ ${b})`.trim();
        } else if ((col === 'place_of_birth' || col === 'place_of_marriage') && row.notes) {
          cellVal = `${cellVal} (🗒 ${row.notes})`.trim();
        }

        val = cellVal;
      }
      val = String(val).replace(/"/g, '""');
      return `"${val}"`;
    }).join(',');
  });

  const siteTitle = t('site_title').replace(/"/g, '""');
  const siteUrl = window.location.origin;
  const dateStr = new Date().toLocaleString();
  let csvContent = [headers, ...rows].join('\n') + `\n\n"${siteTitle}"\n"${siteUrl}"\n"${dateStr}"`;

  if (filename.includes('contributors')) {
    const persons = data.reduce((s, r) => s + (r.total_persons || 0), 0);
    const families = data.reduce((s, r) => s + (r.total_families || 0), 0);
    const links = data.reduce((s, r) => s + (r.total_links || 0), 0);
    const total = persons + families;
    const lastUpdate = data.reduce((max, r) => (r.last_modified && r.last_modified > max) ? r.last_modified : max, '');

    csvContent += `\n\n"${t('tab_contributors')}","${data.length}"`;
    csvContent += `\n"${t('col_total_persons')}","${persons}"`;
    csvContent += `\n"${t('col_total_families')}","${families}"`;
    csvContent += `\n"${t('col_total')}","${total}"`;
    csvContent += `\n"${t('col_total_links')}","${links}"`;
    csvContent += `\n"${t('col_last_modified')}","${lastUpdate}"`;
  } else {
    const params = new URLSearchParams(window.location.search);
    const activeFilters = [];

    for (const [k, v] of params.entries()) {
      if (k === 't') continue; // Skip the tab indicator

      let field = PARAM_MAP_REVERSE[k] || k;
      let label = field;

      if (field === 'q') {
        label = t('general_search_label');
      } else if (field === 'ex') {
        label = t('exact_search');
      } else if (field === 'hl' || field === 'has_link') {
        label = t('has_link');
      } else if (field === 'with') {
        label = t('filter_with');
      } else if (field === 'filter') {
        label = t('general_search_label');
      } else if (field.endsWith('_to')) {
        const baseField = field.replace('_to', '');
        const baseLabel = t('col_' + baseField) !== 'col_' + baseField ? t('col_' + baseField) : baseField;
        label = `${baseLabel} - ${t('date_to')}`;
      } else {
        label = t('col_' + field) !== 'col_' + field ? t('col_' + field) : field;
      }

      let val = v;
      if ((field === 'ex' || field === 'hl' || field === 'has_link') && v === '1') {
        val = '✓'; // Output a nice checkmark for boolean toggles
      }

      activeFilters.push(`"${String(label).replace(/"/g, '""')}","${String(val).replace(/"/g, '""')}"`);
    }

    if (activeFilters.length > 0) {
      csvContent += `\n\n"${t('tab_search').replace(/"/g, '""')}"`;
      csvContent += '\n' + activeFilters.join('\n');
      const fullUrl = window.location.href;
      csvContent += `\n"${t('col_url').replace(/"/g, '""')}","${fullUrl.replace(/"/g, '""')}"`;
    }
  }

  downloadBlob(new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }), filename);
}

const CENTERED_COLUMNS = new Set([
  'contributor', 'contributor_ID',
  'total_persons', 'total_families', 'total', 'total_links',
  'last_modified', 'links', 'matches', 'confidence',
]);

const RIGHT_COLUMNS = new Set([
  'date_of_birth', 'date_of_marriage', 'date_of_death', 'husband_birth', 'wife_birth',
]);

const NUMERIC_COLUMNS = new Set([
  'total_persons', 'total_families', 'total', 'total_links', 'confidence', 'matches',
]);

const MATCHES_CONTEXT_COLS = new Set(['contributor_ID', 'total_persons', 'total_families', 'total']);

// Renders the 🌳/🌿 tree button used in expandable parent/child/partner cells.
// Returns '' when the feature is gated, there's no name/surname to seed the
// tree, or the contributor is matricula (no stable IDs for tree nav).
function treeButton({ kind, n, sn, dob, contributor, extId }) {
  const feature  = kind === 'ancestors' ? 'ancestors' : 'descendants';
  const icon     = kind === 'ancestors' ? '🌳' : '🌿';
  const titleKey = kind === 'ancestors' ? 'tree_ancestors_title' : 'tree_descendants_title';
  if (siteConfig.gatedFeatures?.includes(feature)) return '';
  if (isMatriculaContributor(contributor)) return '';
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

function sortData(data, primary, secondary) {
  data.sort((a, b) => {
    const dir = primary.ascending ? 1 : -1;
    const r = cmp(getValue(a, primary.column), getValue(b, primary.column));
    if (r !== 0) return r * dir;
    if (secondary) {
      const sdir = secondary.ascending ? 1 : -1;
      return cmp(getValue(a, secondary.column), getValue(b, secondary.column)) * sdir;
    }
    return 0;
  });
}

// Canonicalizes a name/surname token for matching. All private-placeholder
// variants ('<private>', 'private', 'unknown') collapse to one key so they
// pair across sides regardless of which placeholder each side stores.
function matchToken(s) {
  const v = String(s || '').trim().toLowerCase();
  if (!v) return '';
  if (isPrivate(v)) return '<private>';
  return v;
}

// Pairs an entry on one match-side with its best counterpart on the other side
// for diff highlighting. Match quality: name+surname > surname only > name only.
// A matching year breaks ties between equally-strong name/surname matches —
// without this, duplicate-name children (e.g. two Ivanas) could pair to the
// wrong sibling and falsely flag the year as a diff.
function findBestMatch(p, otherList) {
  if (!p || !otherList?.length) return null;
  const name = matchToken(p.name);
  const sur  = matchToken(p.surname);
  if (!name && !sur) return null;
  const year = String(childYearOf(p) || '');

  let best = null, bestScore = -1;
  for (const o of otherList) {
    const oName = matchToken(o?.name);
    const oSur  = matchToken(o?.surname);
    const nameMatch = !!name && oName === name;
    const surMatch  = !!sur  && oSur  === sur;
    if (!nameMatch && !surMatch) continue;

    // Base score by match strength; year bonus (5) is smaller than the gap
    // between strength tiers (10), so it never overrides a stronger structural
    // match — only breaks ties within a tier.
    let score = nameMatch && surMatch ? 30 : surMatch ? 20 : 10;
    if (year && String(childYearOf(o) || '') === year) score += 5;

    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

const yearsDiffer = (a, b) => String(a || '') !== String(b || '');

function parseList(jsonOrArr) {
  if (!jsonOrArr) return [];
  if (Array.isArray(jsonOrArr)) return jsonOrArr;
  try {
    const v = typeof jsonOrArr === 'string' ? JSON.parse(jsonOrArr) : jsonOrArr;
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

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

// Plain-text "Name Surname *Year" rendering used by CSV export and any other
// non-HTML consumer. Mirrors the display format so exports stay in sync.
function personInlineText(p, hideSurnameIfEquals) {
  if (isPrivate(p.name) || isPrivate(p.surname)) return p.name || p.surname || '';
  let text = p.name || '';
  if (p.surname && p.surname !== hideSurnameIfEquals) text += ` ${p.surname}`;
  const year = childYearOf(p);
  if (year) text += ` *${year}`;
  return text;
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
function buildNameSurnameHtml(p, other, diffOn) {
  const name = p?.name || '';
  const sur  = p?.surname || '';
  const isPriv = isPrivate(name) || isPrivate(sur);
  if (!diffOn || isPriv || !other) {
    const label = isPriv ? (name || sur) : [name, sur].filter(Boolean).join(' ');
    return escapeHtml(label);
  }
  const otherName = other.name || '';
  const otherSur  = other.surname || '';
  const nameHtml = name ? highlightDifferences(name, otherName) : '';
  const surHtml  = sur  ? highlightDifferences(sur,  otherSur)  : '';
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

function renderParentPair(parentsJson, labelKey, rootPerson = null, otherParentsJson, contributor = null) {
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
    const fatherYearDiff = diffOn && yearsDiffer(childYearOf(father), childYearOf(otherFather));
    const motherYearDiff = diffOn && yearsDiffer(childYearOf(mother), childYearOf(otherMother));
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
    const fNameHtml = buildNameSurnameHtml(father, otherFather, diffOn);
    const mNameHtml = buildNameSurnameHtml(mother, otherMother, diffOn);
    const fInner = fNameHtml + (fYearTok ? ' ' + (fatherYearDiff ? diffWrap(escapeHtml(fYearTok)) : escapeHtml(fYearTok)) : '');
    const mInner = mNameHtml + (mYearTok ? ' ' + (motherYearDiff ? diffWrap(escapeHtml(mYearTok)) : escapeHtml(mYearTok)) : '');

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

export function formatSpecialCell(col, row, otherRow) {
  const diffMode = otherRow !== undefined;

  if (col === 'children' && row.children_list) {
    const otherChildren = diffMode ? parseList(otherRow?.children_list) : [];
    const pList = parseList(row.children_list);
    const count = pList.length;
    const formattedList = pList.map(c => {
        const cPriv = isPrivate(c.name) || isPrivate(c.surname);
        const showSurname = !cPriv && c.surname && c.surname !== row.husband_surname;
        const cy = childYearOf(c);
        const yearTok = cy ? `*${cy}` : '';

        const match = diffMode ? findBestMatch(c, otherChildren) : null;
        const noMatch = diffMode && !cPriv && !match && (c.name || c.surname);
        const yearDiff = !!match && yearsDiffer(cy, childYearOf(match));

        let labelHtml;
        if (cPriv || !diffMode || !match) {
          const label = cPriv ? (c.name || c.surname || '') : (c.name || '') + (showSurname ? ' ' + c.surname : '');
          labelHtml = escapeHtml(label.trim());
        } else {
          const nameHtml = c.name    ? highlightDifferences(c.name, match.name || '')       : '';
          const surHtml  = showSurname ? highlightDifferences(c.surname, match.surname || '') : '';
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

        if (noMatch) entry = diffWrap(entry);
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
    const { html, count } = renderParentPair(row.parents_list, null, null, otherParents, row.contributor);
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
    }, otherHusbandParents, row.contributor);
    const wife = renderParentPair(row.wife_parents, 'label_wife', {
      name: row.wife_name,
      surname: row.wife_surname,
      date_of_birth: row.wife_birth,
      contributor: row.contributor,
      ext_id: row.wife_ext_id
    }, otherWifeParents, row.contributor);
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

        const match = diffMode ? findBestMatch(p, otherPartners) : null;
        const noMatch = diffMode && !pPriv && !match && (p.name || p.surname);
        const yearDiff = !!match && yearsDiffer(py, childYearOf(match));

        let labelHtml;
        if (pPriv || !diffMode || !match) {
          const text = pPriv ? p.name : (p.name || '') + (p.surname ? ' ' + p.surname : '');
          labelHtml = escapeHtml(String(text || '').trim());
        } else {
          const nameHtml = p.name    ? highlightDifferences(p.name, match.name || '')       : '';
          const surHtml  = p.surname ? highlightDifferences(p.surname, match.surname || '') : '';
          labelHtml = [nameHtml, surHtml].filter(Boolean).join(' ');
        }

        const innerHtml = labelHtml +
          (yearTok ? ' ' + (yearDiff ? diffWrap(escapeHtml(yearTok)) : escapeHtml(yearTok)) : '');
        const label = isHusband ? t('label_husband') : (p.sex === 'f' ? t('label_wife') : '');
        let entry = `<a href="${toUnicodeHref(famParams)}" data-spa-nav${label ? ` title="${label}"` : ''}>${innerHtml}</a>`;
        if (noMatch) entry = diffWrap(entry);
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
    const indicator = showIndicator ? matriculaIndicatorHtml(name, t('icon_matricula_index')) : '';
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
    const indicator = matriculaIndicatorHtml(name, t('icon_matricula_index'));
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

export function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true, defaultSecondarySortColumn = null) {
  const container = document.getElementById(containerId);
  const headerEl = container.previousElementSibling;
  const isHeaderValid = headerEl && (headerEl.tagName === 'H2' || headerEl.classList.contains('totals-bar'));

  // Reset collapse state on a new render to ensure content isn't accidentally hidden
  container.style.display = '';
  if (isHeaderValid && headerEl.classList.contains('collapsed')) {
    headerEl.classList.remove('collapsed');
  }

  if (data.length === 0) {
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
  if (primary) sortData(data, primary, secondary);

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

  container.innerHTML = `<table>${theadHtml}<tbody>${renderRowsHtml(data, columns)}</tbody></table>`;

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
        expandBtn.title = labelText;
        expandBtn.dataset.allOpen = allOpen ? '1' : '0';
      };
      // Initial state reflects current details (typically all collapsed).
      const initialAllOpen = Array.from(expandables).every(d => d.open);
      setExpandLabel(initialAllOpen);
      expandBtn.addEventListener('click', () => {
        const targetOpen = expandBtn.dataset.allOpen !== '1';
        container.querySelectorAll('details.expandable-cell').forEach(d => { d.open = targetOpen; });
        setExpandLabel(targetOpen);
      });
    }

    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV`;
    btn.title = t('download_csv'); // Keeps the tooltip translation for accessibility
    btn.addEventListener('click', () => {
      const baseName = containerId.replace('table-', '');
      exportToCSV(data, columns, formatExportFilename(baseName, 'csv'));
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
      // Capture which <details> cells are currently open, keyed by row object
      // identity + column name. Row references survive the sortData() reorder,
      // so we can re-open the same cells in the new positions.
      const openMap = new Map();
      container.querySelectorAll('tbody tr').forEach((tr, rowIdx) => {
        const row = data[rowIdx];
        if (!row) return;
        Array.from(tr.children).forEach((td, colIdx) => {
          const det = td.querySelector('details.expandable-cell');
          if (!det?.open) return;
          if (!openMap.has(row)) openMap.set(row, new Set());
          openMap.get(row).add(columns[colIdx]);
        });
      });

      // Re-sort in place and swap only <tbody> + update <thead> arrows.
      // <thead> stays put so the click listeners survive; headerEl buttons
      // (CSV / expand-all) are outside `container` and untouched.
      sortData(data, state.primary, state.secondary);
      container.querySelectorAll('thead th.sortable').forEach(thNode => {
        const c = thNode.dataset.col;
        thNode.innerHTML = `${t(`col_${c}`)}${buildArrowIndicator(c, state)}`;
      });
      container.querySelector('tbody').innerHTML = renderRowsHtml(data, columns);

      // Restore open <details> in their new row positions.
      if (openMap.size) {
        container.querySelectorAll('tbody tr').forEach((tr, rowIdx) => {
          const openCols = openMap.get(data[rowIdx]);
          if (!openCols) return;
          Array.from(tr.children).forEach((td, colIdx) => {
            if (!openCols.has(columns[colIdx])) return;
            const det = td.querySelector('details.expandable-cell');
            if (det) det.open = true;
          });
        });
      }

      // Sync the expand-all toggle to reflect the (possibly restored) state.
      const allEls = container.querySelectorAll('details.expandable-cell');
      setExpandLabel(allEls.length > 0 && Array.from(allEls).every(d => d.open));
    });
  });
}
