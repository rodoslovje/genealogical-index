import { t, formatTitleSuffix } from '../i18n.js';
import { API_BASE_URL } from '../config.js';
import { escapeHtml, baseContributorName, ensureChartJs, downloadBlob, formatExportFilename } from '../utils.js';
import { toUnicodeHref } from '../url.js';

let cachedStats = null;
let fetchPromise = null;

function fetchStats() {
  if (cachedStats) return Promise.resolve(cachedStats);
  if (!fetchPromise) {
    fetchPromise = fetch(`${API_BASE_URL}/api/matricula/stats`)
      .then(r => (r.ok ? r.json() : { books: [], top_contributors: [], top_parishes: [] }))
      .then(data => { cachedStats = data; return data; })
      .catch(() => ({ books: [], top_contributors: [], top_parishes: [] }));
  }
  return fetchPromise;
}

const collator = new Intl.Collator('sl', { sensitivity: 'base' });
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
  ? a - b
  : collator.compare(String(a ?? ''), String(b ?? ''));

const fmt = (n) => Number(n || 0).toLocaleString();

function typeLabel(type) {
  if (type === 'birth')    return t('book_type_birth');
  if (type === 'marriage') return t('book_type_marriage');
  if (type === 'death')    return t('book_type_death');
  return escapeHtml(type || '');
}

/** Wires up a sortable, collapsible table that renders rows from `data` with
 *  the given column definitions. Mounts into the `<tbody>` inside `tableId`
 *  and toggles content visibility from the header inside `headerSelector`. */
function setupSortableTable({ tableId, headerSelector, contentSelector, columns, data, initialSort, renderRow, fallbackSort }) {
  const tableEl = document.getElementById(tableId);
  if (!tableEl) return null;
  const tbody = tableEl.querySelector('tbody');
  if (!tbody) return null;

  const state = { ...initialSort };
  let sorted = data.slice();

  const renderRows = () => {
    const dir = state.ascending ? 1 : -1;
    sorted.sort((a, b) => {
      const col = columns.find(c => c.f === state.column);
      const r = cmp(col.sortVal ? col.sortVal(a) : (a[state.column] ?? ''),
                    col.sortVal ? col.sortVal(b) : (b[state.column] ?? '')) * dir;
      if (r !== 0) return r;
      return fallbackSort ? fallbackSort(a, b) : 0;
    });

    tbody.innerHTML = sorted.map(renderRow).join('');

    tableEl.querySelectorAll('thead th.sortable').forEach(th => {
      const colDef = columns.find(c => c.f === th.dataset.col);
      const baseLabel = colDef ? colDef.h : th.textContent;
      const indicator = th.dataset.col === state.column
        ? (state.ascending ? '&nbsp;▲' : '&nbsp;▼')
        : '';
      th.innerHTML = `${baseLabel}${indicator}`;
    });
  };

  renderRows();

  tableEl.querySelectorAll('thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.column === col) {
        state.ascending = !state.ascending;
      } else {
        state.column = col;
        state.ascending = !!columns.find(c => c.f === col)?.defaultDesc ? false : true;
      }
      renderRows();
    });
  });

  const header = document.querySelector(headerSelector);
  const content = document.querySelector(contentSelector);
  if (header && content) {
    header.classList.add('collapsible-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('a')) return;
      const isCollapsed = header.classList.contains('collapsed');
      content.style.display = isCollapsed ? '' : 'none';
      header.classList.toggle('collapsed', !isCollapsed);
    });
  }

  return {
    updateData: (newData) => {
      sorted = newData.slice();
      renderRows();
    }
  };
}

function buildThead(columns) {
  return columns.map(({ f, h, cls = '' }) =>
    `<th data-col="${f}" class="sortable${cls}">${h}</th>`
  ).join('');
}

function renderBooksSection(books) {
  const columns = [
    { f: 'parish',        h: t('col_book_parish'),   cls: ' col-center' },
    { f: 'type',          h: t('col_book_type'),     cls: ' col-center', sortVal: (b) => typeLabel(b.type).toLowerCase() },
    { f: 'date',          h: t('col_book_period'),   cls: ' col-center' },
    { f: 'count',         h: t('col_book_count'),    cls: ' col-center', sortVal: (b) => Number(b.count || 0), defaultDesc: true },
    { f: 'contributor',   h: t('col_contributor'),   cls: ' col-center' },
    { f: 'last_modified', h: t('col_last_modified'), cls: ' col-center' },
  ];

  const renderRow = (b) => {
    const date = escapeHtml(b.date || '');
    const dateCell = b.url
      ? `<a href="${b.url}" target="_blank" rel="noopener" title="${escapeHtml(b.name || '')}">${date}</a>`
      : date;
    const contrib = b.contributor ? baseContributorName(b.contributor) : '';
    const contribCell = contrib
      ? `<a href="${toUnicodeHref({ t: 'contributors', c: contrib })}" data-spa-nav>${escapeHtml(contrib)}</a>`
      : '';
    const lastMod = (b.last_modified || '').slice(0, 10);
    return `<tr>
      <td class="col-center">${escapeHtml(b.parish || '')}</td>
      <td class="col-center">${typeLabel(b.type)}</td>
      <td class="col-center">${dateCell}</td>
      <td class="col-center">${fmt(b.count)}</td>
      <td class="col-center">${contribCell}</td>
      <td class="col-center">${escapeHtml(lastMod)}</td>
    </tr>`;
  };

  return {
    html: `<div class="matricula-stats-section" style="margin-bottom: 24px;">
      <div class="matricula-allbooks-header section-bar section-bar--top">
        <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('matricula_section_books')} (<span id="matricula-books-count">${fmt(books.length)}</span>)</h3>
        <button class="export-btn matricula-allbooks-csv-btn" title="${t('download_csv')}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV
        </button>
      </div>
      <div class="matricula-allbooks-content">
        <div class="table-responsive">
          <table id="matricula-allbooks-table">
            <thead><tr>${buildThead(columns)}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`,
    setup: () => {
      let filteredBooks = books;

      const tableApi = setupSortableTable({
        tableId: 'matricula-allbooks-table',
        headerSelector: '.matricula-allbooks-header h3',
        contentSelector: '.matricula-allbooks-content',
        columns, data: books,
        initialSort: { column: 'parish', ascending: true },
        renderRow,
        fallbackSort: (a, b) => collator.compare(a.name || '', b.name || ''),
      });

      const applyFilters = () => {
        const query = document.getElementById('filter-matricula-books')?.value.toLowerCase().trim() || '';

        filteredBooks = books.filter(b => {
          if (!query) return true;
          const parish = (b.parish || '').toLowerCase();
          const type = typeLabel(b.type).toLowerCase();
          const date = (b.date || '').toLowerCase();
          const contrib = (baseContributorName(b.contributor) || '').toLowerCase();
          return parish.includes(query) || type.includes(query) || date.includes(query) || contrib.includes(query);
        });

        const countEl = document.getElementById('matricula-books-count');
        if (countEl) countEl.textContent = fmt(filteredBooks.length);
        if (tableApi) tableApi.updateData(filteredBooks);
      };

      const filterInput = document.getElementById('filter-matricula-books');
      if (filterInput) {
        filterInput.oninput = applyFilters;
        filterInput.onchange = applyFilters;
        if (filterInput.value) applyFilters();
      }

      const csvBtn = document.querySelector('.matricula-allbooks-csv-btn');
      if (csvBtn) {
        csvBtn.addEventListener('click', () => {
          exportBooksToCSV(filteredBooks, columns, formatExportFilename('matricula-books', 'csv'));
        });
      }
    },
  };
}

/** CSV export tailored to the matricula books table — its columns don't map
 *  to the generic `t('col_X')` keys used by the shared exportToCSV. */
export function exportBooksToCSV(books, columns, filename) {
  if (!books?.length) return;
  const header = columns.map(c => `"${(c.h || '').replace(/"/g, '""')}"`).join(',');
  const rows = books.map(b => columns.map(c => {
    let v;
    if (c.f === 'type')          v = typeLabel(b.type);
    else if (c.f === 'count')    v = b.count ?? 0;
    else                          v = b[c.f] ?? '';
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));

  const siteTitle = t('site_title').replace(/"/g, '""');
  const siteUrl = window.location.origin;
  const dateStr = new Date().toLocaleString();
  const csv = [header, ...rows].join('\n') +
    `\n\n"${siteTitle}"\n"${siteUrl}"\n"${dateStr}"`;
  downloadBlob(
    new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }),
    filename,
  );
}

const CHART_BG_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#34495e', '#d35400', '#7f8c8d', '#bdc3c7'];
const CHART_FONT = { family: 'system-ui, -apple-system, sans-serif', size: 14, weight: '600' };
const chartInstances = new Map();

/** Top-N doughnut chart with a trailing "Others" slice. Destroys any previous
 *  chart bound to the same canvas so re-renders don't leak Chart.js instances. */
async function renderDoughnut(canvasId, rows, { valueKey, labelKey, title, topN = 10 }) {
  try { await ensureChartJs(); } catch { return; }
  if (!window.Chart) return;
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  const sorted = [...rows].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  const top = sorted.slice(0, topN);
  const othersTotal = sorted.slice(topN).reduce((s, r) => s + (r[valueKey] || 0), 0);

  const labels = top.map(r => labelKey === 'contributor'
    ? baseContributorName(r[labelKey] || '')
    : (r[labelKey] || ''));
  const values = top.map(r => Number(r[valueKey] || 0));
  if (othersTotal > 0) {
    labels.push(t('chart_others'));
    values.push(othersTotal);
  }

  if (chartInstances.has(canvasId)) chartInstances.get(canvasId).destroy();

  chartInstances.set(canvasId, new window.Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_BG_COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: title, font: CHART_FONT, color: '#444' },
        legend: {
          position: window.innerWidth > 600 ? 'right' : 'bottom',
          labels: { font: { family: CHART_FONT.family }, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: (ctx2) => {
              const val = ctx2.parsed;
              const total = ctx2.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total ? ((val / total) * 100).toFixed(1) : '0';
              return ` ${ctx2.label}: ${val.toLocaleString()} (${pct}%)`;
            },
          },
        },
      },
    },
  }));
}

/** Render the global Matricula statistics page into the #matricula-stats
 *  container. Loaded via `?p=matricula` only — not exposed in the navbar. */
export async function renderMatriculaStatsPage() {
  window.scrollTo(0, 0);
  const container = document.getElementById('matricula-stats');
  if (!container) return;

  document.title = `${t('matricula_page_title')} | ${t('site_title')}`;

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10));
  }

  try {
    const stats = await fetchStats();
    const books = stats.books || [];
    const tc = stats.top_contributors || [];
    const tp = stats.top_parishes || [];

    const totalRecords = books.reduce((s, b) => s + (b.count || 0), 0);
    const totalBirths = books
      .filter(b => b.type === 'birth')
      .reduce((s, b) => s + (b.count || 0), 0);
    const totalMarriages = books
      .filter(b => b.type === 'marriage')
      .reduce((s, b) => s + (b.count || 0), 0);
    const contribCount = tc.length;
    const lastUpdate = books.reduce(
      (max, b) => (b.last_modified && b.last_modified > max ? b.last_modified : max),
      '',
    ).slice(0, 10);

    const heading = `<div class="matches-page-header">
      <h2 class="matches-page-title">${t('matricula_page_title')} - ${formatTitleSuffix(t('section_statistics'))}</h2>
    </div>
    <div class="totals-bar matricula-totals-bar">
      <span><span>${t('tab_contributors')}</span>: <strong>${fmt(contribCount)}</strong></span>
      <span><span>${t('col_books_count')}</span>: <strong>${fmt(books.length)}</strong></span>
      <span><span>${t('book_type_birth')}</span>: <strong>${fmt(totalBirths)}</strong></span>
      <span><span>${t('book_type_marriage')}</span>: <strong>${fmt(totalMarriages)}</strong></span>
      <span><span>${t('col_total')}</span>: <strong>${fmt(totalRecords)}</strong></span>
      <span><span>${t('col_last_modified')}</span>: <strong>${escapeHtml(lastUpdate)}</strong></span>
    </div>`;

    const chartsHtml = `<div class="charts-container matricula-charts-container">
      <div class="chart-wrapper">
        <canvas id="matriculaContributorsChart"></canvas>
      </div>
      <div class="chart-wrapper">
        <canvas id="matriculaParishesChart"></canvas>
      </div>
    </div>`;

    const booksSection = renderBooksSection(books);

    container.innerHTML = heading + chartsHtml + booksSection.html;

    renderDoughnut('matriculaContributorsChart', tc, {
      valueKey: 'total_records',
      labelKey: 'contributor',
      title: t('matricula_section_contributors'),
    });
    renderDoughnut('matriculaParishesChart', tp, {
      valueKey: 'total_records',
      labelKey: 'parish',
      title: t('matricula_section_parishes'),
    });
    booksSection.setup();
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
