import { t, formatTitleSuffix } from '../i18n.js';
import { API_BASE_URL } from '../config.js';
import { escapeHtml, baseContributorName } from '../utils.js';
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
  if (!tableEl) return;
  const tbody = tableEl.querySelector('tbody');
  if (!tbody) return;

  const state = { ...initialSort };
  const sorted = data.slice();

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
}

function buildThead(columns) {
  return columns.map(({ f, h, cls = '' }) =>
    `<th data-col="${f}" class="sortable${cls}">${h}</th>`
  ).join('');
}

function renderBooksSection(books) {
  const columns = [
    { f: 'parish',        h: t('col_book_parish') },
    { f: 'contributor',   h: t('col_contributor') },
    { f: 'name',          h: t('col_book_name') },
    { f: 'type',          h: t('col_book_type'),     sortVal: (b) => typeLabel(b.type).toLowerCase() },
    { f: 'count',         h: t('col_book_count'),    cls: ' col-right', sortVal: (b) => Number(b.count || 0), defaultDesc: true },
    { f: 'last_modified', h: t('col_last_modified') },
  ];

  const renderRow = (b) => {
    const name = escapeHtml(b.name || '');
    const nameCell = b.url
      ? `<a href="${b.url}" target="_blank" rel="noopener">${name}</a>`
      : name;
    const contrib = b.contributor ? baseContributorName(b.contributor) : '';
    const contribCell = contrib
      ? `<a href="${toUnicodeHref({ t: 'contributors', c: contrib })}" data-spa-nav>${escapeHtml(contrib)}</a>`
      : '';
    const lastMod = (b.last_modified || '').slice(0, 10);
    return `<tr>
      <td>${escapeHtml(b.parish || '')}</td>
      <td>${contribCell}</td>
      <td>${nameCell}</td>
      <td>${typeLabel(b.type)}</td>
      <td class="col-right">${fmt(b.count)}</td>
      <td>${escapeHtml(lastMod)}</td>
    </tr>`;
  };

  return {
    html: `<div class="matricula-stats-section" style="margin-bottom: 24px;">
      <div class="matricula-allbooks-header section-bar section-bar--top">
        <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('matricula_section_books')} (${fmt(books.length)})</h3>
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
    setup: () => setupSortableTable({
      tableId: 'matricula-allbooks-table',
      headerSelector: '.matricula-allbooks-header h3',
      contentSelector: '.matricula-allbooks-content',
      columns, data: books,
      initialSort: { column: 'parish', ascending: true },
      renderRow,
      fallbackSort: (a, b) => collator.compare(a.name || '', b.name || ''),
    }),
  };
}

function renderContributorsSection(rows) {
  const columns = [
    { f: 'contributor',   h: t('col_contributor') },
    { f: 'books_count',   h: t('col_books_count'),   cls: ' col-right', sortVal: (r) => Number(r.books_count || 0),   defaultDesc: true },
    { f: 'total_records', h: t('col_total_records'), cls: ' col-right', sortVal: (r) => Number(r.total_records || 0), defaultDesc: true },
  ];

  const renderRow = (r) => {
    const contrib = baseContributorName(r.contributor || '');
    const safe = escapeHtml(contrib);
    const link = `<a href="${toUnicodeHref({ t: 'contributors', c: contrib })}" data-spa-nav>${safe}</a>`;
    return `<tr>
      <td>${link}</td>
      <td class="col-right">${fmt(r.books_count)}</td>
      <td class="col-right">${fmt(r.total_records)}</td>
    </tr>`;
  };

  return {
    html: `<div class="matricula-stats-section" style="margin-bottom: 24px;">
      <div class="matricula-topcontribs-header section-bar section-bar--top">
        <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('matricula_section_top_contributors')} (${fmt(rows.length)})</h3>
      </div>
      <div class="matricula-topcontribs-content">
        <div class="table-responsive">
          <table id="matricula-topcontribs-table">
            <thead><tr>${buildThead(columns)}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`,
    setup: () => setupSortableTable({
      tableId: 'matricula-topcontribs-table',
      headerSelector: '.matricula-topcontribs-header h3',
      contentSelector: '.matricula-topcontribs-content',
      columns, data: rows,
      initialSort: { column: 'total_records', ascending: false },
      renderRow,
      fallbackSort: (a, b) => collator.compare(a.contributor || '', b.contributor || ''),
    }),
  };
}

function renderParishesSection(rows) {
  const columns = [
    { f: 'parish',             h: t('col_book_parish') },
    { f: 'books_count',        h: t('col_books_count'),        cls: ' col-right', sortVal: (r) => Number(r.books_count || 0),        defaultDesc: true },
    { f: 'total_records',      h: t('col_total_records'),      cls: ' col-right', sortVal: (r) => Number(r.total_records || 0),      defaultDesc: true },
    { f: 'contributors_count', h: t('col_contributors_count'), cls: ' col-right', sortVal: (r) => Number(r.contributors_count || 0), defaultDesc: true },
  ];

  const renderRow = (r) => `<tr>
    <td>${escapeHtml(r.parish || '')}</td>
    <td class="col-right">${fmt(r.books_count)}</td>
    <td class="col-right">${fmt(r.total_records)}</td>
    <td class="col-right">${fmt(r.contributors_count)}</td>
  </tr>`;

  return {
    html: `<div class="matricula-stats-section" style="margin-bottom: 24px;">
      <div class="matricula-topparishes-header section-bar section-bar--top">
        <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('matricula_section_top_parishes')} (${fmt(rows.length)})</h3>
      </div>
      <div class="matricula-topparishes-content">
        <div class="table-responsive">
          <table id="matricula-topparishes-table">
            <thead><tr>${buildThead(columns)}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`,
    setup: () => setupSortableTable({
      tableId: 'matricula-topparishes-table',
      headerSelector: '.matricula-topparishes-header h3',
      contentSelector: '.matricula-topparishes-content',
      columns, data: rows,
      initialSort: { column: 'total_records', ascending: false },
      renderRow,
      fallbackSort: (a, b) => collator.compare(a.parish || '', b.parish || ''),
    }),
  };
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

    const heading = `<div class="matches-page-header">
      <h2 class="matches-page-title">${t('matricula_page_title')} - ${formatTitleSuffix(t('section_statistics'))}</h2>
    </div>
    <p>${t('matricula_page_intro')} (${fmt(books.length)} ${t('matricula_books_label')}, ${fmt(totalRecords)} ${t('matricula_records_label')})</p>`;

    const booksSection = renderBooksSection(books);
    const contribSection = renderContributorsSection(tc);
    const parishSection = renderParishesSection(tp);

    container.innerHTML = heading + contribSection.html + parishSection.html + booksSection.html;

    contribSection.setup();
    parishSection.setup();
    booksSection.setup();
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
