import { t } from './i18n.js';
import { PARAM_MAP_REVERSE } from './url.js';

function exportToCSV(data, columns, filename) {
  if (!data || !data.length) return;
  const headers = columns.map(col => `"${t('col_' + col).replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row => {
    return columns.map(col => {
      let val = row[col] != null ? row[col] : '';
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
  'last_modified',
]);

const RIGHT_COLUMNS = new Set([
  'date_of_birth', 'date_of_marriage', 'date_of_death',
]);

function getValue(row, col) {
  const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage' || col === 'date_of_death';
  const isNumeric = ['total_births', 'total_families', 'total_deaths', 'total', 'total_links'].includes(col);
  if (isGedcomDate) return parseDateForSort(row[col]);
  if (isNumeric) return Number(row[col] || 0);
  return String(row[col] || '').toLowerCase();
}

function sortData(data, primary, secondary) {
  data.sort((a, b) => {
    const va = getValue(a, primary.column);
    const vb = getValue(b, primary.column);
    const dir = primary.ascending ? 1 : -1;
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    if (secondary) {
      const sa = getValue(a, secondary.column);
      const sb = getValue(b, secondary.column);
      const sdir = secondary.ascending ? 1 : -1;
      if (sa < sb) return -1 * sdir;
      if (sa > sb) return 1 * sdir;
    }
    return 0;
  });
}

export function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true, defaultSecondarySortColumn = null) {
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
    if (col === 'link') {
      html += `<th>${t('col_link')}</th>`;
    } else {
      const header = t(`col_${col}`);
      let indicator = '';
      if (primary?.column === col) indicator = primary.ascending ? ' ▲' : ' ▼';
      else if (secondary?.column === col) indicator = secondary.ascending ? ' △' : ' ▽';
      const cls = CENTERED_COLUMNS.has(col) ? ' class="sortable col-center"' : RIGHT_COLUMNS.has(col) ? ' class="sortable col-right"' : ' class="sortable"';
      html += `<th data-col="${col}"${cls}>${header}${indicator}</th>`;
    }
  });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => {
      if (col === 'link') {
        html += row.link
          ? `<td class="link-cell"><a href="${row.link}" target="_blank" rel="noopener" title="${row.link}">🔗</a></td>`
          : '<td></td>';
      } else if (CENTERED_COLUMNS.has(col)) {
        const isNumeric = ['total_births', 'total_families', 'total_deaths', 'total', 'total_links'].includes(col);
        const val = isNumeric && row[col] != null ? Number(row[col]).toLocaleString() : (row[col] || '');
        html += `<td class="col-center">${val}</td>`;
      } else if (RIGHT_COLUMNS.has(col)) {
        html += `<td class="col-right">${row[col] || ''}</td>`;
      } else if (col === 'children' && row[col]) {
        const childrenList = row[col].split(', ');
        const formattedChildren = childrenList.map(c => {
          if (c === 'private' || c === 'unknown') return c;

          let namePart = c;
          let yearPart = '';
          const starIdx = c.lastIndexOf('*');
          if (starIdx !== -1) {
            namePart = c.substring(0, starIdx).trim();
            yearPart = c.substring(starIdx + 1).trim();
          }

          const params = new URLSearchParams();
          params.set('t', 'birth');
          if (namePart) params.set('n', namePart);
          const surname = row.husband_surname || row.wife_surname || '';
          if (surname) params.set('sn', surname);
          if (yearPart) params.set('dob', yearPart);
          params.set('ex', '1');

          return `<a href="?${params.toString()}" target="_blank" rel="noopener">${c}</a>`;
        });
        html += `<td>
          <details class="expandable-cell">
            <summary>${childrenList.length}</summary>
            <div class="expanded-content">${formattedChildren.join('<br>')}</div>
          </details>
        </td>`;
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
      renderTable(data, containerId, columns);
    });
  });
}
