import { t } from './i18n.js';

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

function getValue(row, col) {
  const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage';
  const isNumeric = ['total_births', 'total_families', 'total', 'total_links'].includes(col);
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
  if (data.length === 0) {
    container.innerHTML = `<p>${t('no_results')}</p>`;
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
      html += `<th data-col="${col}" class="sortable">${header}${indicator}</th>`;
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
      } else {
        html += `<td>${row[col] || ''}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

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
