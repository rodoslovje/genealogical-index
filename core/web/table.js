import { t, getCurrentLang } from './i18n.js';
import { PARAM_MAP_REVERSE, toUnicodeHref } from './url.js';

export function exportToCSV(data, columns, filename) {
  if (!data || !data.length) return;
  const headers = columns.map(col => `"${t('col_' + col).replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => {
    return columns.map(col => {
      let val = '';
      if (col === 'parents' && (row.father_name || row.father_surname || row.mother_name || row.mother_surname)) {
        const parts = [];
        const fStr = [row.father_name, row.father_surname].filter(Boolean).join(' ');
        const mStr = [row.mother_name, row.mother_surname].filter(Boolean).join(' ');
        if (fStr) parts.push(fStr);
        if (mStr) parts.push(mStr);
        val = parts.join(', ');
      } else if (col === 'parents') {
        const parseP = (jsonStr, label) => {
          if (!jsonStr) return '';
          try {
            const arr = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
            if (!arr.length) return '';
            const f = arr[0] || {}; const m = arr[1] || {};
            const fStr = `${f.name||''} ${f.surname||''} ${f.year ? '*'+f.year : ''}`.trim();
            const mStr = `${m.name||''} ${m.surname||''} ${m.year ? '*'+m.year : ''}`.trim();
            return `${label}: ${fStr}, ${mStr}`.replace(/\s+/g, ' ').trim();
          } catch(e) { return ''; }
        };
        const hp = parseP(row.husband_parents, t('label_husband'));
        const wp = parseP(row.wife_parents, t('label_wife'));
        val = [hp, wp].filter(Boolean).join(' | ');
      } else if (col === 'children' && row.children_list) {
        try {
          const arr = typeof row.children_list === 'string' ? JSON.parse(row.children_list) : row.children_list;
          val = arr.map(c => {
             if (c.name === 'private' || c.name === 'unknown') return c.name;
             let d = c.name || '';
             if (c.surname && c.surname !== row.husband_surname) d += ' ' + c.surname;
             if (c.year) d += ' *' + c.year;
             return d;
          }).join(', ');
        } catch(e) { val = row[col] || ''; }
      } else if (col === 'partners' && (row.husbands_list || row.wifes_list)) {
        const parts = [];
        const parseList = (jsonStr, label) => {
          if (!jsonStr) return;
          try {
            const arr = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
            arr.forEach(p => {
              let d = p.name || '';
              if (p.surname) d += ' ' + p.surname;
              if (p.year) d += ' *' + p.year;
              parts.push(`${label}: ${d.trim()}`);
            });
          } catch(e) {}
        };
        parseList(row.husbands_list, t('label_husband'));
        parseList(row.wifes_list, t('label_wife'));
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
    const births = data.reduce((s, r) => s + (r.total_births || 0), 0);
    const families = data.reduce((s, r) => s + (r.total_families || 0), 0);
    const deaths = data.reduce((s, r) => s + (r.total_deaths || 0), 0);
    const links = data.reduce((s, r) => s + (r.total_links || 0), 0);
    const total = births + families + deaths;
    const lastUpdate = data.reduce((max, r) => (r.last_modified && r.last_modified > max) ? r.last_modified : max, '');

    csvContent += `\n\n"${t('tab_contributors')}","${data.length}"`;
    csvContent += `\n"${t('col_total_births')}","${births}"`;
    csvContent += `\n"${t('col_total_families')}","${families}"`;
    csvContent += `\n"${t('col_total_deaths')}","${deaths}"`;
    csvContent += `\n"${t('col_total')}","${total}"`;
    csvContent += `\n"${t('col_total_links')}","${links}"`;
    csvContent += `\n"${t('col_last_update')}","${lastUpdate}"`;
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

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function parseDateForSort(dateStr) {
  if (!dateStr) return 0;
  let str = String(dateStr).toLowerCase();

  // Strip common genealogical modifiers
  str = str.replace(/(abt\.?|about|bef\.?|before|aft\.?|after|cal|est\.?)\s*/g, '').trim();

  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let year = 0, month = 0, day = 0;

  const yearMatch = str.match(/\b(\d{4})\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  const monthMatch = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (monthMatch) month = months[monthMatch[1]];

  const parts = str.split(/[\s\-.\/]+/);
  for (const part of parts) {
    if (/^\d{1,2}$/.test(part) && parseInt(part, 10) <= 31) {
      day = parseInt(part, 10);
      break;
    }
  }

  return year * 10000 + month * 100 + day;
}

const CENTERED_COLUMNS = new Set([
  'contributor', 'contributor_ID',
  'total_births', 'total_families', 'total_deaths', 'total', 'total_links',
  'last_modified', 'links', 'matches', 'confidence',
]);

const RIGHT_COLUMNS = new Set([
  'date_of_birth', 'date_of_marriage', 'date_of_death',
]);

function getValue(row, col) {
  if (col === 'parents') {
    if (row._parents_count !== undefined) return row._parents_count;
    let count = 0;
    if (row.husband_parents || row.wife_parents) {
      const countP = (v) => {
        if (!v) return 0;
        try {
          const arr = typeof v === 'string' ? JSON.parse(v) : v;
          const f = arr[0] || {};
          const m = arr[1] || {};
          if (!f.name && !m.name) return 0;
          let c = 0;
          if (f.name || f.surname || f.year) c++;
          if (m.name || m.surname || m.year) c++;
          return c;
        } catch(e) { return 0; }
      };
      count = countP(row.husband_parents) + countP(row.wife_parents);
    } else {
      if (row.father_name || row.father_surname) count++;
      if (row.mother_name || row.mother_surname) count++;
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
    const count = countList(row.husbands_list) + countList(row.wifes_list);
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
  const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage' || col === 'date_of_death';
  const isNumeric = ['total_births', 'total_families', 'total_deaths', 'total', 'total_links', 'confidence', 'matches'].includes(col);
  if (isGedcomDate) return parseDateForSort(row[col]);
  if (isNumeric) return Number(row[col] || 0);
  return String(row[col] || '').toLowerCase();
}

const collator = new Intl.Collator('sl', { sensitivity: 'base' });


function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a ?? ''), String(b ?? ''));
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

export function formatSpecialCell(col, row) {
  if (col === 'children' && row.children_list) {
    let formattedList = [];
    let count = 0;

    try {
      const pList = typeof row.children_list === 'string' ? JSON.parse(row.children_list) : row.children_list;
      count = pList.length;
      formattedList = pList.map(c => {
        if (c.name === 'private' || c.name === 'unknown') return c.name;

        const params = new URLSearchParams();
        params.set('t', 'birth');
        if (c.name) params.set('n', c.name);
        if (c.surname) params.set('sn', c.surname);
        if (c.year) params.set('dob', c.year);
        params.set('ex', '1');

        let childDisplay = c.name || '';
        if (c.surname && c.surname !== row.husband_surname) childDisplay += ` ${c.surname}`;
        if (c.year) childDisplay += ` *${c.year}`;

        return `<a href="${toUnicodeHref(params)}" data-spa-nav>${childDisplay}</a>`;
      });
    } catch (e) {
      console.error("Failed to parse JSON for children", e);
    }

    if (count === 0) return '';
    return `<details class="expandable-cell">
            <summary>${count}</summary>
            <div class="expanded-content">${formattedList.join('<br>')}</div>
          </details>`;
  }

  if (col === 'parents' && (row.father_name || row.father_surname || row.mother_name || row.mother_surname)) {
    const hasFather = row.father_name || row.father_surname;
    const hasMother = row.mother_name || row.mother_surname;
    const count = (hasFather ? 1 : 0) + (hasMother ? 1 : 0);

    const famParams = new URLSearchParams();
    famParams.set('t', 'family');
    if (row.father_name) famParams.set('hn', row.father_name);
    if (row.father_surname) famParams.set('hsn', row.father_surname);
    if (row.mother_name) famParams.set('wn', row.mother_name);
    if (row.mother_surname) famParams.set('wsn', row.mother_surname);
    famParams.set('ex', '1');

    const makeBirthLink = (name, surname) => {
      const display = [name, surname].filter(Boolean).join(' ');
      if (name === 'private' || name === 'unknown') return display;
      const p = new URLSearchParams();
      p.set('t', 'birth');
      if (name) p.set('n', name);
      if (surname) p.set('sn', surname);
      p.set('ex', '1');
      return `<a href="${toUnicodeHref(p)}" class="name-link" data-spa-nav>${display}</a>`;
    };

    let content = `<a href="${toUnicodeHref(famParams)}" class="name-link" data-spa-nav style="font-weight:600;">${t('col_parents')}: 👪</a>`;
    if (hasFather) content += `<br>${makeBirthLink(row.father_name, row.father_surname)}`;
    if (hasMother) content += `<br>${makeBirthLink(row.mother_name, row.mother_surname)}`;

    return `<details class="expandable-cell">
            <summary>${count}</summary>
            <div class="expanded-content">${content}</div>
          </details>`;
  }

  if (col === 'parents' && (row.husband_parents || row.wife_parents)) {
    let parentsCount = 0;
    const renderParents = (parentsJson, labelKey) => {
      if (!parentsJson) return '';
      try {
        const pList = typeof parentsJson === 'string' ? JSON.parse(parentsJson) : parentsJson;
        if (pList.length === 0) return '';

        const father = pList[0] || {};
        const mother = pList[1] || {};
        if (!father.name && !mother.name) return '';

        const fName = father.name === 'private' || father.name === 'unknown' ? father.name : father.name || '';
        const fSur = father.name === 'private' || father.name === 'unknown' ? '' : father.surname || '';
        const fYear = father.year ? ` *${father.year}` : '';

        const mName = mother.name === 'private' || mother.name === 'unknown' ? mother.name : mother.name || '';
        const mSur = mother.name === 'private' || mother.name === 'unknown' ? '' : mother.surname || '';
        const mYear = mother.year ? ` *${mother.year}` : '';

        const famParams = new URLSearchParams();
        famParams.set('t', 'family');
        if (fName && fName !== 'unknown' && fName !== 'private') famParams.set('hn', fName);
        if (fSur) famParams.set('hsn', fSur);
        if (mName && mName !== 'unknown' && mName !== 'private') famParams.set('wn', mName);
        if (mSur) famParams.set('wsn', mSur);
        famParams.set('ex', '1');

        const getBirthLink = (n, s, display) => {
          if (n === 'private' || n === 'unknown') return display;
          if (!n && !s) return display;
          const bParams = new URLSearchParams();
          bParams.set('t', 'birth');
          if (n) bParams.set('n', n);
          if (s) bParams.set('sn', s);
          bParams.set('ex', '1');
      return `<a href="${toUnicodeHref(bParams)}" class="name-link" data-spa-nav>${display}</a>`;
        };

        const fDisplay = [fName, fSur].filter(Boolean).join(' ') + fYear;
        const mDisplay = [mName, mSur].filter(Boolean).join(' ') + mYear;

        if (fDisplay) parentsCount++;
        if (mDisplay) parentsCount++;

        let htmlStr = `<div class="parent-group" style="margin-bottom: 8px;">
          <a href="${toUnicodeHref(famParams)}" class="name-link" data-spa-nav style="font-weight: 600;">${t(labelKey)}: 👪</a><br>`;
        if (fDisplay) htmlStr += `${getBirthLink(fName, fSur, fDisplay)}<br>`;
        if (mDisplay) htmlStr += `${getBirthLink(mName, mSur, mDisplay)}`;
        htmlStr += `</div>`;
        return htmlStr;
      } catch(e) { return ''; }
    };
    const combined = [renderParents(row.husband_parents, 'label_husband'), renderParents(row.wife_parents, 'label_wife')].filter(Boolean).join('');
    if (parentsCount > 0) {
      return `<details class="expandable-cell">
            <summary>${parentsCount}</summary>
            <div class="expanded-content">${combined}</div>
          </details>`;
    } else {
      return '';
    }
  }

  if (col === 'partners' && (row.husbands_list || row.wifes_list)) {
    let formattedList = [];
    let count = 0;
    const processPartners = (jsonStr, isHusband) => {
      if (!jsonStr) return;
      try {
        const pList = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        pList.forEach(p => {
          count++;
          const famParams = new URLSearchParams();
          famParams.set('t', 'family');
          if (isHusband) {
            if (p.name && p.name !== 'unknown' && p.name !== 'private') famParams.set('hn', p.name);
            if (p.surname) famParams.set('hsn', p.surname);
            if (row.name && row.name !== 'unknown' && row.name !== 'private') famParams.set('wn', row.name);
            if (row.surname) famParams.set('wsn', row.surname);
          } else {
            if (row.name && row.name !== 'unknown' && row.name !== 'private') famParams.set('hn', row.name);
            if (row.surname) famParams.set('hsn', row.surname);
            if (p.name && p.name !== 'unknown' && p.name !== 'private') famParams.set('wn', p.name);
            if (p.surname) famParams.set('wsn', p.surname);
          }
          famParams.set('ex', '1');
          let partnerDisplay = p.name || '';
          if (p.surname) partnerDisplay += ` ${p.surname}`;
          if (p.year) partnerDisplay += ` *${p.year}`;
          if (p.name === 'private' || p.name === 'unknown') partnerDisplay = p.name;
          const label = isHusband ? t('label_husband') : t('label_wife');
          formattedList.push(`<a href="${toUnicodeHref(famParams)}" data-spa-nav title="${label}">${partnerDisplay}</a>`);
        });
      } catch (e) { console.error("Failed to parse JSON for partners", e); }
    };
    processPartners(row.husbands_list, true);
    processPartners(row.wifes_list, false);
    if (count > 0) {
      return `<details class="expandable-cell">
            <summary>${count}</summary>
            <div class="expanded-content">${formattedList.join('<br>')}</div>
          </details>`;
    } else {
      return '';
    }
  }

  return null;
}

export function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true, defaultSecondarySortColumn = null, contributorUrlMap = {}) {
  const container = document.getElementById(containerId);
  const headerEl = container.previousElementSibling;
  const isHeaderValid = headerEl && (headerEl.tagName === 'H2' || headerEl.classList.contains('totals-bar'));

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

  let html = '<table><thead><tr>';
  columns.forEach(col => {
    let indicator = '';
    if (primary?.column === col) indicator = primary.ascending ? '&nbsp;▲' : '&nbsp;▼';
    else if (secondary?.column === col) indicator = secondary.ascending ? '&nbsp;△' : '&nbsp;▽';
    const cls = CENTERED_COLUMNS.has(col) ? ' class="sortable col-center"' : RIGHT_COLUMNS.has(col) ? ' class="sortable col-right"' : ' class="sortable"';
    html += `<th data-col="${col}"${cls}>${t(`col_${col}`)}${indicator}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      if (col === 'links') {
        let linksList = [];
        if (row.links) {
          if (Array.isArray(row.links)) {
            linksList = row.links;
          } else {
            try { linksList = JSON.parse(row.links); } catch(e) { linksList = [row.links]; }
          }
        }
        if (linksList.length) {
          const icons = linksList.map(url => {
            let icon = '📜';
            let titleText = t('icon_matricula');

            if (url.includes('familysearch.org')) {
              icon = '🌳';
              titleText = t('icon_familysearch');
            } else if (url.includes('geneanet.org') || url.includes('findagrave.com') || url.includes('billiongraves.com')) {
              icon = '🪦';
              titleText = t('icon_grave');
            } else if (url.includes('sistory.si/ww')) {
              icon = '🎖︎';
              titleText = t('icon_military');
            } else if (url.includes('sistory.si') && url.includes('popisi')) {
              icon = '📋';
              titleText = t('icon_census');
            } else if (url.includes('dlib.si')) {
              icon = '📰';
              titleText = t('icon_dlib');
            }

            try {
              const domain = new URL(url).hostname.replace(/^www\./, '');
              titleText = `${titleText} - ${domain}`;
            } catch (e) {}

            const href = url.includes('matricula-online.eu')
              ? url.replace(/\/(en|sl)\//, `/${getCurrentLang()}/`)
              : url;
            return `<a href="${href}" target="_blank" rel="noopener" title="${titleText}">${icon}</a>`;
          }).join(' ');
          html += `<td class="link-cell">${icons}</td>`;
        } else {
          html += '<td></td>';
        }
      } else if (col === 'matches') {
        const count = row.matches_count || 0;
        const cell = count > 0 ? count : '';
        html += `<td class="col-center">${cell}</td>`;
      } else if (col === 'confidence') {
        const val = row[col] != null ? `${row[col]}%` : '—';
        html += `<td class="col-center">${val}</td>`;
      } else if (col === 'contributor_ID') {
        const name = row[col] || '';
        const internalHref = row._match_href || row._contributor_href || '';
        const externalUrl = row._url || '';
        if (internalHref) {
          html += `<td class="col-center"><a href="${internalHref}" data-spa-nav>${name}</a></td>`;
        } else if (externalUrl) {
          html += `<td class="col-center"><a href="${externalUrl}" target="_blank" rel="noopener">${name}</a></td>`;
        } else {
          html += `<td class="col-center">${name}</td>`;
        }
      } else if (col === 'contributor') {
        const name = row[col] || '';
        if (name) {
          html += `<td><a href="${toUnicodeHref({ t: 'contributors', contributor: name })}" data-spa-nav>${name}</a></td>`;
        } else {
          html += `<td></td>`;
        }
      } else if (CENTERED_COLUMNS.has(col)) {
        const isNumeric = ['total_births', 'total_families', 'total_deaths', 'total', 'total_links', 'confidence', 'matches'].includes(col);
        let val = isNumeric && row[col] != null ? Number(row[col]).toLocaleString() : (row[col] || '');
        if (col === 'total_links' && Number(row[col] || 0) === 0) val = '';
        html += `<td class="col-center">${val}</td>`;
      } else if (RIGHT_COLUMNS.has(col)) {
        html += `<td class="col-right">${row[col] || ''}</td>`;
      } else if ((col === 'husband_name' || col === 'husband_surname') && row[col]) {
        const params = new URLSearchParams();
        params.set('t', 'birth');
        if (row.husband_name) params.set('n', row.husband_name);
        if (row.husband_surname) params.set('sn', row.husband_surname);
        params.set('ex', '1');
        html += `<td><a href="${toUnicodeHref(params)}" class="name-link" data-spa-nav>${row[col]}</a></td>`;
      } else if ((col === 'wife_name' || col === 'wife_surname') && row[col]) {
        const params = new URLSearchParams();
        params.set('t', 'birth');
        if (row.wife_name) params.set('n', row.wife_name);
        if (row.wife_surname) params.set('sn', row.wife_surname);
        params.set('ex', '1');
        html += `<td><a href="${toUnicodeHref(params)}" class="name-link" data-spa-nav>${row[col]}</a></td>`;
      } else if ((col === 'name' || col === 'surname') && row[col] && row.date_of_death !== undefined) {
        const params = new URLSearchParams();
        params.set('t', 'birth');
        if (row.name) params.set('n', row.name);
        if (row.surname) params.set('sn', row.surname);
        params.set('ex', '1');
        html += `<td><a href="${toUnicodeHref(params)}" class="name-link" data-spa-nav>${row[col]}</a></td>`;
      } else if (col === 'children' || col === 'parents' || col === 'partners') {
        const inner = formatSpecialCell(col, row);
        html += `<td>${inner || ''}</td>`;
      } else {
        html += `<td>${row[col] || ''}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  if (isHeaderValid) {
    let btn = headerEl.querySelector('.export-btn');
    if (btn) btn.remove();

    btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV`;
    btn.title = t('download_csv'); // Keeps the tooltip translation for accessibility
    btn.addEventListener('click', () => exportToCSV(data, columns, `sgi-${containerId.replace('table-', '')}.csv`));

    if (headerEl.classList.contains('totals-bar')) {
      headerEl.appendChild(btn);
    } else {
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
      renderTable(data, containerId, columns, null, true, null, contributorUrlMap);
    });
  });
}
