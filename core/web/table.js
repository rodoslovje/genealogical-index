import { t } from './i18n.js';
import { formatLinks } from './links.js';
import { isPrivate, cmp, getExpandCollapseIcon, baseContributorName, matriculaIndicatorHtml, altSurnameIconHtml, baptismIconHtml, notesIconHtml, isMatriculaContributor, escapeHtml, highlightDifferences, downloadBlob } from './utils.js';
import { childYearOf, parseDateForSort } from './dates.js';
import { PARAM_MAP_REVERSE, toUnicodeHref } from './url.js';
import siteConfig from '@site-config';

export function exportToCSV(data, columns, filename) {
  if (!data || !data.length) return;
  const headers = columns.map(col => `"${t('col_' + col).replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => {
    return columns.map(col => {
      let val = '';
      if (col === 'parents') {
        const parseP = (jsonStr, label) => {
          if (!jsonStr) return '';
          try {
            const arr = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
            if (!arr.length) return '';
            const f = arr[0] || {}; const m = arr[1] || {};
            const fy = childYearOf(f); const my = childYearOf(m);
            const fStr = `${f.name||''} ${f.surname||''} ${fy ? '*'+fy : ''}`.trim();
            const mStr = `${m.name||''} ${m.surname||''} ${my ? '*'+my : ''}`.trim();
            const inner = [fStr, mStr].filter(Boolean).join(', ');
            return label ? `${label}: ${inner}` : inner;
          } catch(e) { return ''; }
        };
        if (row.parents_list) {
          val = parseP(row.parents_list, '');
        } else {
          const hp = parseP(row.husband_parents, t('label_husband'));
          const wp = parseP(row.wife_parents, t('label_wife'));
          val = [hp, wp].filter(Boolean).join(' | ');
        }
      } else if (col === 'children' && row.children_list) {
        try {
          const arr = typeof row.children_list === 'string' ? JSON.parse(row.children_list) : row.children_list;
          val = arr.map(c => {
             if (isPrivate(c.name)) return c.name;
             let d = c.name || '';
             if (c.surname && c.surname !== row.husband_surname) d += ' ' + c.surname;
             const childYear = childYearOf(c);
             if (childYear) d += ' *' + childYear;
             return d;
          }).join(', ');
        } catch(e) { val = row[col] || ''; }
      } else if (col === 'partners' && row.partners_list) {
        const parts = [];
        try {
          const arr = typeof row.partners_list === 'string' ? JSON.parse(row.partners_list) : row.partners_list;
          arr.forEach(p => {
            let d = p.name || '';
            if (p.surname) d += ' ' + p.surname;
            const py = childYearOf(p);
            if (py) d += ' *' + py;
            const label = p.sex === 'm' ? t('label_husband') : p.sex === 'f' ? t('label_wife') : '';
            parts.push(label ? `${label}: ${d.trim()}` : d.trim());
          });
        } catch(e) {}
        val = parts.join(' | ');
      } else if (col === 'matches') {
        val = row.matches_count || '';
        if (Number(val) === 0) val = '';
      } else {
        val = row[col] != null ? row[col] : '';
        if (col === 'total_links' && Number(val) === 0) val = '';
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
  const altIcon = col === surField ? altSurnameIconHtml(row[altField], t('icon_alt_surname')) : '';
  const val = row[col];
  if (!val) return `<td>${altIcon}</td>`;
  const safeDisplay = escapeHtml(val);
  if (isPrivate(row[nameField]) || isPrivate(row[surField])) {
    return `<td>${safeDisplay}${altIcon}</td>`;
  }
  const params = new URLSearchParams();
  params.set('t', 'person');
  if (row[nameField]) params.set('n',  row[nameField]);
  if (row[surField])  params.set('sn', row[surField]);
  params.set('ex', '1');
  return `<td><a href="${toUnicodeHref(params)}" class="name-link" data-spa-nav>${safeDisplay}</a>${altIcon}</td>`;
}

function getValue(row, col) {
  if (col === 'parents') {
    if (row._parents_count !== undefined) return row._parents_count;
    const countPair = (v) => {
      if (!v) return 0;
      try {
        const arr = typeof v === 'string' ? JSON.parse(v) : v;
        const f = arr[0] || {};
        const m = arr[1] || {};
        let c = 0;
        if (f.name || f.surname || f.date_of_birth || f.year) c++;
        if (m.name || m.surname || m.date_of_birth || m.year) c++;
        return c;
      } catch(e) { return 0; }
    };
    let count = 0;
    if (row.husband_parents || row.wife_parents) {
      count = countPair(row.husband_parents) + countPair(row.wife_parents);
    } else if (row.parents_list) {
      count = countPair(row.parents_list);
    }
    row._parents_count = count;
    return count;
  }
  if (col === 'partners') {
    if (row._partners_count !== undefined) return row._partners_count;
    const countList = (v) => {
      if (!v) return 0;
      try {
        const arr = typeof v === 'string' ? JSON.parse(v) : v;
        return arr.length;
      } catch(e) { return 0; }
    };
    const count = countList(row.partners_list);
    row._partners_count = count;
    return count;
  }
  if (col === 'children') {
    if (row._children_count !== undefined) return row._children_count;
    let count = 0;
    if (row.children_list) {
      try {
        const arr = typeof row.children_list === 'string' ? JSON.parse(row.children_list) : row.children_list;
        count = arr.length;
      } catch(e) { }
    }
    row._children_count = count;
    return count;
  }
  if (col === 'links') {
    if (!row.links) return 0;
    if (Array.isArray(row.links)) return row.links.length;
    try { return JSON.parse(row.links).length; } catch { return 0; }
  }
  if (col === 'matches') return Number(row.matches_count || 0);
  if (RIGHT_COLUMNS.has(col)) return parseDateForSort(row[col]);
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
function wrapPersonAnchor(name, surname, innerHtml) {
  if (isPrivate(name) || isPrivate(surname)) return innerHtml;
  if (!name && !surname) return innerHtml;
  const p = new URLSearchParams();
  p.set('t', 'person');
  if (name) p.set('n', name);
  if (surname) p.set('sn', surname);
  p.set('ex', '1');
  return `<a href="${toUnicodeHref(p)}" class="name-link" data-spa-nav>${innerHtml}</a>`;
}

function renderParentPair(parentsJson, labelKey, rootPerson = null, otherParentsJson) {
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
    const mName = mother.name || '';
    const mSur = mother.surname || '';
    const mYear = childYearOf(mother);

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
    if (fName || fSur) htmlStr += `${wrapPersonAnchor(fName, fSur, fInner)}<br>`;
    if (mName || mSur) htmlStr += `${wrapPersonAnchor(mName, mSur, mInner)}`;
    htmlStr += `</div>`;
    return { html: htmlStr, count };
  } catch(e) {
    return { html: '', count: 0 };
  }
}

export function formatSpecialCell(col, row, otherRow) {
  const diffMode = otherRow !== undefined;

  if (col === 'children' && row.children_list) {
    let formattedList = [];
    let count = 0;

    const otherChildren = diffMode ? parseList(otherRow?.children_list) : [];

    try {
      const pList = typeof row.children_list === 'string' ? JSON.parse(row.children_list) : row.children_list;
      count = pList.length;
      formattedList = pList.map(c => {
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
          params.set('ex', '1');
          entry = `<a href="${toUnicodeHref(params)}" data-spa-nav>${innerHtml}</a>`;
        }

        if (noMatch) entry = diffWrap(entry);
        return entry;
      });
    } catch (e) {
      console.error("Failed to parse JSON for children", e);
    }

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

    if (count === 0) return '';
    return `<details class="expandable-cell">
            <summary>${count}${treeBtn}</summary>
            <div class="expanded-content">${formattedList.join('<br>')}</div>
          </details>`;
  }

  if (col === 'parents' && row.parents_list) {
    const otherParents = diffMode ? (otherRow?.parents_list ?? null) : undefined;
    const { html, count } = renderParentPair(row.parents_list, null, null, otherParents);
    if (count > 0) {
      const treeBtn = row.id ? treeButton({
        kind: 'ancestors',
        n: row.name,
        sn: row.surname,
        dob: row.date_of_birth || childYearOf(row),
        contributor: row.contributor,
        extId: row.ext_id,
      }) : '';
      return `<details class="expandable-cell">
            <summary>${count}${treeBtn}</summary>
            <div class="expanded-content">${html}</div>
          </details>`;
    }
    return '';
  }

  if (col === 'parents' && (row.husband_parents || row.wife_parents)) {
    const otherHusbandParents = diffMode ? (otherRow?.husband_parents ?? null) : undefined;
    const otherWifeParents    = diffMode ? (otherRow?.wife_parents ?? null)    : undefined;
    const husband = renderParentPair(row.husband_parents, 'label_husband', {
      name: row.husband_name,
      surname: row.husband_surname,
      date_of_birth: row.husband_birth,
      contributor: row.contributor
    }, otherHusbandParents);
    const wife = renderParentPair(row.wife_parents, 'label_wife', {
      name: row.wife_name,
      surname: row.wife_surname,
      date_of_birth: row.wife_birth,
      contributor: row.contributor
    }, otherWifeParents);
    const count = husband.count + wife.count;
    if (count > 0) {
      return `<details class="expandable-cell">
            <summary>${count}</summary>
            <div class="expanded-content">${husband.html}${wife.html}</div>
          </details>`;
    }
    return '';
  }

  if (col === 'partners' && row.partners_list) {
    let formattedList = [];
    let count = 0;
    const treeBtn = row.id ? treeButton({
      kind: 'descendants',
      n: row.name,
      sn: row.surname,
      dob: row.date_of_birth || childYearOf(row),
      contributor: row.contributor,
      extId: row.ext_id,
    }) : '';
    const otherPartners = diffMode ? parseList(otherRow?.partners_list) : [];
    try {
      const pList = typeof row.partners_list === 'string' ? JSON.parse(row.partners_list) : row.partners_list;
      pList.forEach(p => {
        count++;
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
        formattedList.push(entry);
      });
    } catch (e) {
      console.error("Failed to parse JSON for partners", e);
    }
    if (count > 0) {
      return `<details class="expandable-cell">
            <summary>${count}${treeBtn}</summary>
            <div class="expanded-content">${formattedList.join('<br>')}</div>
          </details>`;
    }
    return '';
  }

  return null;
}

function buildArrowIndicator(col, state) {
  if (state?.primary?.column === col)   return state.primary.ascending   ? '&nbsp;▲' : '&nbsp;▼';
  if (state?.secondary?.column === col) return state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';
  return '';
}

// Builds the per-row `<tr>` HTML. Used both for initial render and for the
// in-place sort re-render (which replaces only `<tbody>` so the surrounding
// `<thead>` listeners and toolbar buttons survive).
function renderRowsHtml(data, columns) {
  let html = '';
  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      if (col === 'links') {
        const icons = formatLinks(row.links);
        html += icons ? `<td class="link-cell">${icons}</td>` : '<td></td>';
      } else if (col === 'matches') {
        const count = row.matches_count || 0;
        html += `<td class="col-center">${count > 0 ? count : ''}</td>`;
      } else if (col === 'confidence') {
        const val = row[col] != null ? `${row[col]}%` : '—';
        html += `<td class="col-center">${val}</td>`;
      } else if (col === 'contributor_ID') {
        const name = row[col] || '';
        const display = baseContributorName(name);
        const indicator = matriculaIndicatorHtml(name, t('icon_matricula_index'));
        const internalHref = row._match_href || row._contributor_href || '';
        const externalUrl = row._url || '';
        if (internalHref) {
          html += `<td class="col-center"><a href="${internalHref}" data-spa-nav>${display}</a>${indicator}</td>`;
        } else if (externalUrl) {
          html += `<td class="col-center"><a href="${externalUrl}" target="_blank" rel="noopener">${display}</a>${indicator}</td>`;
        } else {
          html += `<td class="col-center">${display}${indicator}</td>`;
        }
      } else if (col === 'contributor') {
        const name = row[col] || '';
        if (name) {
          const display = baseContributorName(name);
          const indicator = matriculaIndicatorHtml(name, t('icon_matricula_index'));
          html += `<td><a href="${toUnicodeHref({ t: 'contributors', c: display })}" data-spa-nav>${display}</a>${indicator}</td>`;
        } else {
          html += `<td></td>`;
        }
      } else if (CENTERED_COLUMNS.has(col)) {
        let val = NUMERIC_COLUMNS.has(col) && row[col] != null ? Number(row[col]).toLocaleString() : (row[col] || '');
        if (col === 'total_links' && Number(row[col] || 0) === 0) val = '';
        html += `<td class="col-center">${val}</td>`;
      } else if (RIGHT_COLUMNS.has(col)) {
        const raw = escapeHtml(row[col]);
        const extra = col === 'date_of_birth'
          ? baptismIconHtml(row.date_of_baptism, row.place_of_baptism, t('icon_baptism'))
          : '';
        html += `<td class="col-right">${raw}${extra}</td>`;
      } else if (col === 'husband_name' || col === 'husband_surname') {
        html += renderPersonNameCell(col, row, 'husband', 'husband_alt_surname');
      } else if (col === 'wife_name' || col === 'wife_surname') {
        html += renderPersonNameCell(col, row, 'wife', 'wife_alt_surname');
      } else if ((col === 'name' || col === 'surname') && row.husband_name === undefined) {
        html += renderPersonNameCell(col, row, '', 'alt_surname');
      } else if (col === 'children' || col === 'parents' || col === 'partners') {
        const inner = formatSpecialCell(col, row);
        html += `<td>${inner || ''}</td>`;
      } else {
        const raw = escapeHtml(row[col]);
        const extra = (col === 'place_of_birth' || col === 'place_of_marriage')
          ? notesIconHtml(row.notes, t('icon_notes'))
          : '';
        html += `<td>${raw}${extra}</td>`;
      }
    });
    html += '</tr>';
  });
  return html;
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

  const isFamilyTable = containerId.includes('famil');
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
      const prefix = siteConfig.filePrefix || 'sgi';
      exportToCSV(data, columns, `${prefix}-${containerId.replace('table-', '')}.csv`);
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
