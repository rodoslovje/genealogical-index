// Per-source panels of the single-contributor page, and the tab strip that
// switches between them.
//
// A genealogist can contribute up to four kinds of data — a family tree,
// Matricula index transcriptions, Geneanet cemetery indexes, military
// records — and each gets one panel: its own surname cloud plus whatever is
// specific to that source (transcribed books, indexed cemeteries). The
// Matches section rides along on the *primary* source's panel (tree, else
// cemeteries, else military) because the matches API folds all of a
// genealogist's sources together — matches are per genealogist, not per
// source — and Matricula is index-only with no matches at all.
//
// With one source there is no strip and the lone panel renders flat. With
// several, only the active panel is built (lazily, on first activation) and
// panels stay mounted once built, so switching back is instant and any
// filter/sort state inside is kept.

import { t, tf } from '../i18n.js';
import { escapeHtml, formatExportFilename } from '../lib/utils.js';
import { toUnicodeHref, toUnicodeSearch, currentParams } from '../lib/url.js';
import { DOWNLOAD_ICON } from '../lib/icons.js';
import { updateCurrentKey } from '../lib/view-cache.js';
import siteConfig from '@site-config';

import { fetchMatriculaBooks, fetchGeneanetCemeteries } from './data.js';
import { loadSurnameCloud } from './cloud.js';
import { exportBooksToCSV, setupSortableTable, buildThead } from './matricula-stats.js';
import { geneanetTypeLabel, exportCemeteriesToCSV } from './geneanet-stats.js';
import { renderMatchesSummary } from './matches-summary.js';

/** URL parameter naming the active source tab (`s=matricula`). Omitted for
 *  the default tab so plain contributor links stay canonical. */
export const SOURCE_TAB_PARAM = 's';

/** Which source tab the current URL asks for, or null. */
export function readSourceTab(params = currentParams()) {
  return params.get(SOURCE_TAB_PARAM);
}

/** Mirrors the active tab into the URL via replaceState (no history entry —
 *  Back should still return to the contributors list), then re-keys the view
 *  cache so a later Back/Forward restores this page under the URL it now
 *  has. */
function writeSourceTab(key, defaultKey) {
  const u = new URL(window.location);
  if (key === defaultKey) u.searchParams.delete(SOURCE_TAB_PARAM);
  else u.searchParams.set(SOURCE_TAB_PARAM, key);
  const search = toUnicodeSearch(u.searchParams);
  history.replaceState(null, '', u.pathname + (search ? '?' + search : ''));
  updateCurrentKey(window.location.pathname + window.location.search);
}

const strongCount = (n) => ({ n, html: `<strong>${Number(n || 0).toLocaleString()}</strong>` });
const fmt = (n) => Number(n || 0).toLocaleString();

const sectionBar = (title, exportBtnClass) => `<div class="section-bar section-bar--top">
    <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${title}</h3>
    ${exportBtnClass ? `<button class="export-btn ${exportBtnClass}" title="${t('download_csv')}">${DOWNLOAD_ICON}CSV</button>` : ''}
  </div>`;

/** Markup for one surname cloud. `cloud.js` decorates `.surname-cloud-header`
 *  with its own CSV/SVG buttons and collapse toggle after loading. */
function cloudSectionHtml(id, introHtml) {
  return `<div class="surname-cloud-section">
    <div class="surname-cloud-header">
      <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('section_surnames')}</h3>
    </div>
    <p>${introHtml}</p>
    <div class="surname-cloud" id="${id}" data-i18n-title="chart_surnames_title"></div>
  </div>`;
}

/** Makes an `h3` inside `headerEl` toggle `contentEl`, mirroring the
 *  collapsible headings used across the contributor pages. */
function makeCollapsible(headerEl, contentEl) {
  const heading = headerEl?.querySelector('h3');
  if (!heading || !contentEl) return;
  heading.classList.add('collapsible-header');
  heading.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    const isCollapsed = heading.classList.contains('collapsed');
    contentEl.style.display = isCollapsed ? '' : 'none';
    heading.classList.toggle('collapsed', !isCollapsed);
  });
}

/** The transcribed-books table of the Matricula panel. Kept as plain sort
 *  handling (rather than `setupSortableTable`) because its default sort has
 *  a two-level tiebreak on parish then book name. */
function booksTableHtml(booksCols, summaryHtml) {
  const theadHtml = booksCols.map(({ f, h, cls }) =>
    `<th data-col="${f}" class="sortable${cls}">${h}</th>`
  ).join('');
  return `<div class="matricula-books-subsection">
    ${sectionBar(t('section_matricula_books'), 'export-matricula-books-btn')}
    <div class="matricula-books-content">
      ${summaryHtml}
      <div class="table-responsive">
        <table class="matricula-books-table">
          <thead><tr>${theadHtml}</tr></thead>
          <tbody id="matricula-books-tbody"></tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function mountBooksTable(panelEl, matriculaBooks, booksCols, displayName) {
  const sub = panelEl.querySelector('.matricula-books-subsection');
  if (!sub) return;
  makeCollapsible(sub.querySelector('.section-bar'), sub.querySelector('.matricula-books-content'));

  const tbody = sub.querySelector('#matricula-books-tbody');
  if (!tbody) return;

  const csvBtn = sub.querySelector('.export-matricula-books-btn');
  if (csvBtn) {
    csvBtn.addEventListener('click', () => {
      exportBooksToCSV(matriculaBooks, booksCols, formatExportFilename(`matricula-books-${displayName}`, 'csv'));
    });
  }

  const typeLabel = (type) => {
    if (type === 'birth')    return t('book_type_birth');
    if (type === 'marriage') return t('book_type_marriage');
    if (type === 'death')    return t('book_type_death');
    return escapeHtml(type || '');
  };
  const collator = new Intl.Collator('sl', { sensitivity: 'base' });
  const sortVal = (b, col) => {
    if (col === 'count') return Number(b.count || 0);
    if (col === 'type')  return typeLabel(b.type).toLowerCase();
    return String(b[col] || '').toLowerCase();
  };
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
    ? a - b
    : collator.compare(String(a ?? ''), String(b ?? ''));

  const sortState = { column: 'parish', ascending: true };
  const sorted = matriculaBooks.slice();
  const headers = sub.querySelectorAll('thead th.sortable');
  const renderRows = () => {
    const { column, ascending } = sortState;
    const dir = ascending ? 1 : -1;
    sorted.sort((a, b) => {
      const r = cmp(sortVal(a, column), sortVal(b, column)) * dir;
      if (r !== 0) return r;
      if (column !== 'parish') return collator.compare(a.parish || '', b.parish || '');
      return collator.compare(a.name || '', b.name || '');
    });

    tbody.innerHTML = sorted.map(b => {
      const date = escapeHtml(b.date || '');
      const dateCell = b.url
        ? `<a href="${b.url}" target="_blank" rel="noopener" title="${escapeHtml(b.name || '')}">${date}</a>`
        : date;
      const lastMod = (b.last_modified || '').slice(0, 10);
      return `<tr>
        <td class="col-center">${escapeHtml(b.parish || '')}</td>
        <td class="col-center">${typeLabel(b.type)}</td>
        <td class="col-center">${dateCell}</td>
        <td class="col-center">${fmt(b.count)}</td>
        <td class="col-center">${escapeHtml(lastMod)}</td>
      </tr>`;
    }).join('');

    headers.forEach(th => {
      const colDef = booksCols.find(c => c.f === th.dataset.col);
      const baseLabel = colDef ? colDef.h : th.textContent;
      const indicator = th.dataset.col === sortState.column
        ? (sortState.ascending ? '&nbsp;▲' : '&nbsp;▼')
        : '';
      th.innerHTML = `${baseLabel}${indicator}`;
    });
  };

  renderRows();
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortState.column === col) {
        sortState.ascending = !sortState.ascending;
      } else {
        sortState.column = col;
        sortState.ascending = true;
      }
      renderRows();
    });
  });
}

/** Builds the list of panels a contributor's page needs, in the same order
 *  as the stats grid's columns (Tree / Matricula / Cemeteries / Military).
 *  Each is `{ key, label, load(panelEl) }`; `load` fills `panelEl` and wires
 *  it up, and runs at most once per page.
 *
 *  Fetches the transcribed-books list up front: a genealogist with books
 *  listed but no `-matricula` index yet still gets a Matricula panel, and
 *  that can't be known without asking. */
export async function buildSourcePanels({ contribData, displayName, overlay }) {
  const primary = contribData._tree || contribData._geneanet || contribData._military;
  const showMatches = !!primary && !siteConfig.gatedFeatures?.includes('matches');
  const matriculaBooks = await fetchMatriculaBooks(displayName);

  // The Matches section lands on the primary source's panel only.
  const matchesHtml = (part) => (showMatches && part === primary)
    ? '<div class="matches-summary-section"></div>'
    : '';
  const mountMatches = async (panelEl, part, cachedList) => {
    const sectionEl = panelEl.querySelector('.matches-summary-section');
    if (!sectionEl) return;
    await renderMatchesSummary({ sectionEl, primary, displayName, cached: cachedList, overlay });
  };

  const panels = [];

  if (contribData._tree) {
    const part = contribData._tree;
    panels.push({
      key: 'tree',
      label: t('col_tree'),
      async load(panelEl, cachedList) {
        panelEl.innerHTML =
          cloudSectionHtml('contributor-tree-surname-cloud',
            `${t('contributor_surnames_intro')} <strong>${displayName}</strong> ${t('contributor_surnames_outro')}`) +
          matchesHtml(part);
        loadSurnameCloud([part.contributor_ID], 'contributor-tree-surname-cloud');
        await mountMatches(panelEl, part, cachedList);
      },
    });
  }

  if (contribData._matricula || matriculaBooks.length) {
    const part = contribData._matricula;
    const booksCols = [
      { f: 'parish',        h: t('col_book_parish'),    cls: ' col-center' },
      { f: 'type',          h: t('col_book_type'),      cls: ' col-center' },
      { f: 'date',          h: t('col_book_period'),    cls: ' col-center' },
      { f: 'count',         h: t('col_book_count'),     cls: ' col-center' },
      { f: 'last_modified', h: t('col_last_modified'),  cls: ' col-center' },
    ];
    panels.push({
      key: 'matricula',
      label: t('col_matricula'),
      async load(panelEl) {
        const totalRecords = matriculaBooks.reduce((s, b) => s + (b.count || 0), 0);
        const summaryHtml = matriculaBooks.length
          ? `<p>${tf('matricula_books_summary',
              `<strong>${displayName}</strong>`,
              strongCount(matriculaBooks.length),
              strongCount(totalRecords),
              toUnicodeHref({ t: 'matricula' }))}</p>`
          : '';
        panelEl.innerHTML =
          (part ? cloudSectionHtml('contributor-matricula-surname-cloud', t('contributor_matricula_surnames_intro')) : '') +
          (matriculaBooks.length ? booksTableHtml(booksCols, summaryHtml) : '');
        mountBooksTable(panelEl, matriculaBooks, booksCols, displayName);
        if (part) loadSurnameCloud([part.contributor_ID], 'contributor-matricula-surname-cloud', { hideSectionIfEmpty: true });
      },
    });
  }

  if (contribData._geneanet) {
    const part = contribData._geneanet;
    const cemeteryCols = [
      { f: 'place',         h: t('col_place'),      cls: ' col-center' },
      { f: 'name',          h: t('col_cemetery'),   cls: '' },
      { f: 'type',          h: t('col_book_type'),  cls: ' col-center', sortVal: (c) => geneanetTypeLabel(c.type).toLowerCase() },
      { f: 'persons_count', h: t('col_persons'),    cls: ' col-center', sortVal: (c) => Number(c.persons_count || 0), defaultDesc: true },
      { f: 'graves_count',  h: t('col_graves'),     cls: ' col-center', sortVal: (c) => Number(c.graves_count || 0),  defaultDesc: true },
    ];
    panels.push({
      key: 'geneanet',
      label: t('col_geneanet'),
      async load(panelEl, cachedList) {
        const cemeteries = await fetchGeneanetCemeteries(displayName);
        const totalPersons = cemeteries.reduce((s, c) => s + (c.persons_count || 0), 0);
        const summaryHtml = cemeteries.length
          ? `<p>${tf('geneanet_cemeteries_summary',
              `<strong>${displayName}</strong>`,
              strongCount(cemeteries.length),
              strongCount(totalPersons),
              toUnicodeHref({ t: 'geneanet' }))}</p>`
          : '';
        const tableHtml = cemeteries.length
          ? `<div class="geneanet-cemeteries-subsection">
              <div class="contributor-geneanet-header section-bar section-bar--top">
                <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('section_geneanet_cemeteries')}</h3>
                <button class="export-btn export-geneanet-cemeteries-btn" title="${t('download_csv')}">${DOWNLOAD_ICON}CSV</button>
              </div>
              <div class="contributor-geneanet-content">
                ${summaryHtml}
                <div class="table-responsive">
                  <table id="contributor-geneanet-table">
                    <thead><tr>${buildThead(cemeteryCols)}</tr></thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
            </div>`
          : '';
        panelEl.innerHTML =
          cloudSectionHtml('contributor-geneanet-surname-cloud', t('contributor_geneanet_surnames_intro')) +
          tableHtml +
          matchesHtml(part);

        if (cemeteries.length) {
          const collator = new Intl.Collator('sl', { sensitivity: 'base' });
          const tableApi = setupSortableTable({
            tableId: 'contributor-geneanet-table',
            headerSelector: '.contributor-geneanet-header h3',
            contentSelector: '.contributor-geneanet-content',
            columns: cemeteryCols,
            data: cemeteries,
            initialSort: { column: 'place', ascending: true },
            renderRow: (c) => {
              const name = escapeHtml(c.name || '');
              const nameCell = c.url
                ? `<a href="${c.url}" target="_blank" rel="noopener">${name}</a>`
                : name;
              return `<tr>
                <td class="col-center">${escapeHtml(c.place || '')}</td>
                <td>${nameCell}</td>
                <td class="col-center">${geneanetTypeLabel(c.type)}</td>
                <td class="col-center">${fmt(c.persons_count)}</td>
                <td class="col-center">${fmt(c.graves_count)}</td>
              </tr>`;
            },
            fallbackSort: (a, b) => collator.compare(a.name || '', b.name || ''),
          });
          const csvBtn = panelEl.querySelector('.export-geneanet-cemeteries-btn');
          if (csvBtn && tableApi) {
            csvBtn.addEventListener('click', () => {
              exportCemeteriesToCSV(tableApi.getVisibleData(), cemeteryCols, formatExportFilename(`geneanet-cemeteries-${displayName}`, 'csv'));
            });
          }
        }
        loadSurnameCloud([part.contributor_ID], 'contributor-geneanet-surname-cloud', { hideSectionIfEmpty: true });
        await mountMatches(panelEl, part, cachedList);
      },
    });
  }

  if (contribData._military) {
    const part = contribData._military;
    panels.push({
      key: 'military',
      label: t('col_military'),
      async load(panelEl, cachedList) {
        panelEl.innerHTML =
          cloudSectionHtml('contributor-military-surname-cloud',
            `${t('contributor_surnames_intro')} <strong>${displayName}</strong> ${t('contributor_surnames_outro')}`) +
          matchesHtml(part);
        loadSurnameCloud([part.contributor_ID], 'contributor-military-surname-cloud', { hideSectionIfEmpty: true });
        await mountMatches(panelEl, part, cachedList);
      },
    });
  }

  // Default to the primary source's panel (it carries Matches); a contributor
  // with only Matricula data has no primary and falls back to the first panel.
  const primaryKey = !primary ? null
    : primary === contribData._tree ? 'tree'
    : primary === contribData._geneanet ? 'geneanet'
    : 'military';
  return { panels, defaultKey: primaryKey || panels[0]?.key || null };
}

/** Appends the tab strip (when there is more than one panel) and the panel
 *  containers to `container`, activates the tab the URL asks for (falling
 *  back to `defaultKey`), and wires tab clicks. `cachedList` is the aggregate
 *  contributors list handed through to the Matches section. */
export async function mountSourceTabs({ container, panels, defaultKey, cachedList, overlay }) {
  if (!panels.length) return;
  const has = (key) => panels.some(p => p.key === key);
  const requested = readSourceTab();
  const initial = has(requested) ? requested : (has(defaultKey) ? defaultKey : panels[0].key);

  const wrap = document.createElement('div');
  wrap.className = 'source-panels';
  const stripHtml = panels.length > 1
    ? `<div class="source-tabs" role="tablist">${panels.map(p =>
        `<button type="button" role="tab" data-source="${p.key}" aria-selected="false">${p.label}</button>`
      ).join('')}</div>`
    : '';
  wrap.innerHTML = stripHtml + panels.map(p =>
    `<div class="source-panel" role="tabpanel" data-source="${p.key}" hidden></div>`
  ).join('');
  container.appendChild(wrap);

  const loaded = new Set();
  const activate = async (key, { sync }) => {
    wrap.querySelectorAll('.source-tabs button').forEach(b => {
      const on = b.dataset.source === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    wrap.querySelectorAll('.source-panel').forEach(p => { p.hidden = p.dataset.source !== key; });
    if (sync) writeSourceTab(key, defaultKey);

    if (loaded.has(key)) return;
    loaded.add(key);
    const panel = panels.find(p => p.key === key);
    const panelEl = wrap.querySelector(`.source-panel[data-source="${key}"]`);
    if (!panel || !panelEl) return;
    // The initial activation runs under the page-level spinner already; a
    // later tab click shows it for its own fetches.
    if (sync && overlay) overlay.style.display = 'flex';
    try {
      await panel.load(panelEl, cachedList);
    } finally {
      if (sync && overlay) overlay.style.display = 'none';
    }
  };

  wrap.querySelector('.source-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-source]');
    if (btn) activate(btn.dataset.source, { sync: true });
  });

  await activate(initial, { sync: false });
}
