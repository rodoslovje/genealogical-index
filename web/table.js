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

function compareValues(a, b, col, ascending) {
  const dir = ascending ? 1 : -1;
  const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage';
  const isNumeric = ['total_births', 'total_families', 'total'].includes(col);

  let va, vb;
  if (isGedcomDate) {
    va = parseDateForSort(a[col]);
    vb = parseDateForSort(b[col]);
  } else if (isNumeric) {
    va = Number(a[col] || 0);
    vb = Number(b[col] || 0);
  } else {
    va = String(a[col] || '').toLowerCase();
    vb = String(b[col] || '').toLowerCase();
  }

  if (va < vb) return -1 * dir;
  if (va > vb) return 1 * dir;
  return 0;
}

export function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true) {
  const container = document.getElementById(containerId);
  if (data.length === 0) {
    container.innerHTML = `<p>${t('no_results')}</p>`;
    return;
  }

  if (!container._sortState || (container._sortState.column === null && defaultSortColumn)) {
    container._sortState = { column: defaultSortColumn, ascending: defaultSortAscending };
  }

  if (container._sortState.column) {
    data.sort((a, b) => compareValues(a, b, container._sortState.column, container._sortState.ascending));
  }

  let html = '<table><thead><tr>';
  columns.forEach(col => {
    const header = t(`col_${col}`);
    const indicator = container._sortState.column === col
      ? (container._sortState.ascending ? ' ▲' : ' ▼')
      : '';
    html += `<th data-col="${col}" class="sortable">${header}${indicator}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => html += `<td>${row[col] || ''}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (container._sortState.column === col) {
        container._sortState.ascending = !container._sortState.ascending;
      } else {
        container._sortState.column = col;
        container._sortState.ascending = true;
      }
      data.sort((a, b) => compareValues(a, b, container._sortState.column, container._sortState.ascending));
      renderTable(data, containerId, columns);
    });
  });
}
