import { t, formatTitleSuffix } from '../i18n.js';
import { renderTable, exportToCSV } from '../table.js';
import {
  shortenUrlLabel, baseContributorName, matriculaIndicatorHtml, escapeHtml,
} from '../utils.js';
import { API_BASE_URL } from '../config.js';
import { toUnicodeHref } from '../url.js';
import siteConfig from '@site-config';

import { ensureData, getCachedData, getContributorUrlMap, fetchMatriculaBooks } from './data.js';
import { loadSurnameCloud } from './cloud.js';
import {
  getContributorFilter, setCurrentMatches, setDetailRefilter,
} from './filter.js';
import { exportBooksToCSV } from './matricula-stats.js';
import { renderMatchDetail } from './match-detail.js';
import { fetchErrorKey } from '../auth.js';

/** Renders the per-contributor stats grid (single column or 3-column Sum/Tree/Matricula). */
function renderContributorStats(contribData) {
  if (!contribData) return '';
  const tip = (key) => t(key).replace(/"/g, '&quot;');
  const fmt = (n) => Number(n || 0).toLocaleString();
  const tree = contribData._tree;
  const mat  = contribData._matricula;

  // Single-column grid when only one source exists.
  if (!tree || !mat) {
    const row = (tipKey, label, value) => {
      const a = ` title="${tip(tipKey)}"`;
      return `<span${a}>${label}:</span><strong${a}>${value}</strong>`;
    };
    return `<div class="contributor-stats" style="margin-bottom: 20px; font-size: 0.95rem; display: grid; grid-template-columns: max-content max-content; column-gap: 16px; row-gap: 4px; justify-items: end;">
      ${row('tip_total_persons',  t('col_total_persons'),  fmt(contribData.total_persons))}
      ${row('tip_total_families', t('col_total_families'), fmt(contribData.total_families))}
      ${row('tip_total',          t('col_total'),          fmt(contribData.total))}
      ${row('tip_total_links',    t('col_total_links'),    fmt(contribData.total_links))}
      ${row('tip_last_modified',  t('col_last_modified'),  contribData.last_modified || '')}
    </div>`;
  }

  // 3-value grid: Total / Tree / Matricula.
  const metricRow = (tipKey, label, sum, treeVal, matVal) => {
    const a = ` title="${tip(tipKey)}"`;
    return `<span${a}>${label}:</span>` +
      `<strong${a}>${sum}</strong>` +
      `<span${a}>${treeVal}</span>` +
      `<span${a}>${matVal}</span>`;
  };
  const lastTree = tree.last_modified || '';
  const lastMat  = mat.last_modified  || '';
  const lastSum  = contribData.last_modified || '';
  const divider = '<div style="grid-column: 1 / -1; border-bottom: 1px solid var(--border); margin: 2px 0;"></div>';

  return `<div class="contributor-stats" style="margin-bottom: 20px; font-size: 0.95rem; display: grid; grid-template-columns: max-content max-content max-content max-content; column-gap: 16px; row-gap: 4px; justify-items: end;">
    <span></span>
    <strong>${t('col_total')}</strong>
    <strong>${t('col_tree')}</strong>
    <strong>${t('col_matricula')}</strong>
    ${divider}
    ${metricRow('tip_total_persons',  t('col_total_persons'),  fmt(contribData.total_persons),  fmt(tree.total_persons),  fmt(mat.total_persons))}
    ${metricRow('tip_total_families', t('col_total_families'), fmt(contribData.total_families), fmt(tree.total_families), fmt(mat.total_families))}
    ${metricRow('tip_total_links',    t('col_total_links'),    fmt(contribData.total_links),    fmt(tree.total_links),    fmt(mat.total_links))}
    ${metricRow('tip_last_modified',  t('col_last_modified'),  lastSum,                          lastTree,                  lastMat)}
  </div>`;
}

/** Renders either the per-contributor matches summary or the per-pair detail. */
export async function renderMatchesPage(contributor, withPartner) {
  window.scrollTo(0, 0);

  // The detail-view refilter is only valid while that view is mounted.
  setDetailRefilter(null);

  const totalsBar = document.getElementById('totals-bar');
  if (totalsBar) totalsBar.style.display = 'none';

  const container = document.getElementById('table-contributors');

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10)); // Yield to allow browser to paint the overlay
  }

  try {
    await ensureData();
    const cached = getCachedData();
    // Normalize: clicking through partner links may still use a -matricula
    // suffix; aggregate rows are keyed by the base name.
    const baseContributor = baseContributorName(contributor);
    const contribData = cached.find(d => d.contributor_ID === baseContributor);

    if (!contribData) {
      const safeContributor = escapeHtml(baseContributor);
      const contribInd = matriculaIndicatorHtml(contributor, t('icon_matricula_index'));
      document.title = `${t('no_results')} | ${t('site_title')}`;
      container.innerHTML = `<div class="matches-page-header">
        <h2 class="matches-page-title">${safeContributor}${contribInd} - ${formatTitleSuffix(t('col_contributor'))}</h2>
      </div>
      <p>${t('no_results')}</p>`;
      return;
    }

    const displayName = baseContributor;
    const hasTree = !!contribData._tree;
    const hasMatricula = !!contribData._matricula;
    // Matches section needs Genealogist data AND the 'matches' feature not
    // being gated out of this build.
    const showMatchesSection = hasTree && !siteConfig.gatedFeatures?.includes('matches');

    if (withPartner) {
      const basePartner = baseContributorName(withPartner);
      const partnerData = cached.find(d => d.contributor_ID === basePartner);
      if (!partnerData) {
        const safePartner = escapeHtml(basePartner);
        const partnerInd  = matriculaIndicatorHtml(withPartner, t('icon_matricula_index'));
        document.title = `${t('no_results')} | ${t('site_title')}`;
        container.innerHTML = `<div class="matches-page-header">
          <h2 class="matches-page-title">${safePartner}${partnerInd} × <a href="${toUnicodeHref({ t: 'contributors', c: displayName })}" data-spa-nav style="color: inherit; text-decoration: none;">${displayName}</a> - ${formatTitleSuffix(t('col_matches'))}</h2>
        </div>
        <p>${t('no_results')}</p>`;
        return;
      }
      document.title = `${basePartner} × ${displayName} - ${formatTitleSuffix(t('col_matches'))} | ${t('site_title')}`;
      await renderMatchDetail(contributor, withPartner, contribData, container);
      return;
    }

    document.title = `${displayName} - ${formatTitleSuffix(t('col_contributor'))} | ${t('site_title')}`;

    const urlMap = getContributorUrlMap();
    const url = urlMap[displayName] || (contribData._tree?._url) || (contribData._matricula?._url);
    const urlHtml = url ? `<div style="margin-bottom: 20px; font-size: 0.95rem; color: #444;">${t('more_info_about')} <strong>${displayName}</strong>:<div style="margin-top: 8px;"><a href="${url}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(url)}</a></div></div>` : '';

    const statsHtml = renderContributorStats(contribData);

    let cloudSectionsHtml = '';
    if (hasTree) {
      cloudSectionsHtml += `<div class="surname-cloud-section" style="margin-bottom: 24px;">
        <div class="surname-cloud-header section-bar">
          <h3 class="section-heading" data-i18n="section_surnames" style="margin: 0; padding: 0; border: none;">${t('section_surnames')}</h3>
        </div>
        <p>${t('contributor_surnames_intro')} <strong>${displayName}</strong> ${t('contributor_surnames_outro')}</p>
        <div class="surname-cloud" id="contributor-surname-cloud" data-i18n-title="chart_surnames_title"></div>
      </div>`;
    }

    // Combined Matricula section: top surnames followed by the transcribed
    // books table. Shown whenever the contributor has either matricula-suffixed
    // index data or transcribed Matricula Online books.
    const matriculaBooks = await fetchMatriculaBooks(displayName);
    const booksSortState = { column: 'parish', ascending: true };
    const booksCols = [
      { f: 'parish',        h: t('col_book_parish'),    cls: ' col-center' },
      { f: 'type',          h: t('col_book_type'),      cls: ' col-center' },
      { f: 'date',          h: t('col_book_period'),    cls: ' col-center' },
      { f: 'count',         h: t('col_book_count'),     cls: ' col-center' },
      { f: 'last_modified', h: t('col_last_modified'),  cls: ' col-center' },
    ];
    let matriculaSectionHtml = '';
    if (hasMatricula || matriculaBooks.length) {
      const fmt = (n) => Number(n || 0).toLocaleString();
      const totalRecords = matriculaBooks.reduce((s, b) => s + (b.count || 0), 0);

      const matriculaUrl = toUnicodeHref({ t: 'matricula' });
      const summaryHtml = matriculaBooks.length
        ? `<p>${t('matricula_books_summary')
            .replace('{0}', `<strong>${displayName}</strong>`)
            .replace('{1}', `<strong>${fmt(matriculaBooks.length)}</strong>`)
            .replace('{2}', `<strong>${fmt(totalRecords)}</strong>`)
            .replace('{3}', matriculaUrl)}</p>`
        : '';

      const cloudHtml = hasMatricula
        ? `<div class="surname-cloud-section" style="margin-top: 1.5rem;">
            <div class="surname-cloud-header section-bar section-bar--top" style="margin-bottom: 8px;">
              <h4 class="section-heading" style="margin: 0; padding: 0; border: none; font-size: 1.1rem;">${t('section_surnames')}</h4>
            </div>
            <p style="margin-bottom: 12px;">${t('contributor_matricula_surnames_intro')}</p>
            <div class="surname-cloud" id="contributor-matricula-surname-cloud" data-i18n-title="chart_surnames_title"></div>
          </div>`
        : '';

      let booksHtml = '';
      if (matriculaBooks.length) {
        const theadHtml = booksCols.map(({ f, h, cls }) =>
          `<th data-col="${f}" class="sortable${cls}">${h}</th>`
        ).join('');
        booksHtml = `<div class="matricula-books-subsection" style="margin-top: 1.5rem;">
          <div class="matricula-books-header section-bar section-bar--top" style="margin-bottom: 8px;">
            <h4 class="section-heading" style="margin: 0; padding: 0; border: none; font-size: 1.1rem;">${t('section_matricula_books')}</h4>
            <button class="export-btn export-matricula-books-btn" title="${t('download_csv')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV
            </button>
          </div>
          <div class="table-responsive">
            <table class="matricula-books-table">
              <thead><tr>${theadHtml}</tr></thead>
              <tbody id="matricula-books-tbody"></tbody>
            </table>
          </div>
        </div>`;
      }

      matriculaSectionHtml = `<div class="matricula-section" style="margin-bottom: 24px;">
        <div class="matricula-section-header section-bar section-bar--top">
          <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('matricula_page_title')}</h3>
        </div>
        <div class="matricula-section-content">
          ${summaryHtml}
          ${booksHtml}
          ${cloudHtml}
        </div>
      </div>`;
    }

    const setupBooksSection = () => {
      // Wire up the parent Matricula section's collapsible behavior first —
      // it's present whenever there's matricula data, even with no books.
      const matriculaHeader = document.querySelector('.matricula-section-header h3');
      const matriculaContent = document.querySelector('.matricula-section-content');
      if (matriculaHeader && matriculaContent) {
        matriculaHeader.classList.add('collapsible-header');
        matriculaHeader.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('a')) return;
          const isCollapsed = matriculaHeader.classList.contains('collapsed');
          matriculaContent.style.display = isCollapsed ? '' : 'none';
          matriculaHeader.classList.toggle('collapsed', !isCollapsed);
        });
      }

      const booksHeader = container.querySelector('.matricula-books-header h4');
      const booksContent = container.querySelector('.matricula-books-subsection .table-responsive');
      if (booksHeader && booksContent) {
        booksHeader.classList.add('collapsible-header');
        booksHeader.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('a')) return;
          const isCollapsed = booksHeader.classList.contains('collapsed');
          booksContent.style.display = isCollapsed ? '' : 'none';
          booksHeader.classList.toggle('collapsed', !isCollapsed);
        });
      }

      if (!matriculaBooks.length) return;
      const tbody = document.getElementById('matricula-books-tbody');
      if (!tbody) return;

      const csvBtn = container.querySelector('.export-matricula-books-btn');
      if (csvBtn) {
        csvBtn.addEventListener('click', () => {
          const prefix = siteConfig.filePrefix || 'sgi';
          exportBooksToCSV(matriculaBooks, booksCols, `${prefix}-matricula-books-${displayName}.csv`);
        });
      }

      const typeLabel = (type) => {
        if (type === 'birth')    return t('book_type_birth');
        if (type === 'marriage') return t('book_type_marriage');
        if (type === 'death')    return t('book_type_death');
        return escapeHtml(type || '');
      };
      const fmt = (n) => Number(n || 0).toLocaleString();
      const collator = new Intl.Collator('sl', { sensitivity: 'base' });
      const sortVal = (b, col) => {
        if (col === 'count') return Number(b.count || 0);
        if (col === 'type')  return typeLabel(b.type).toLowerCase();
        return String(b[col] || '').toLowerCase();
      };
      const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
        ? a - b
        : collator.compare(String(a ?? ''), String(b ?? ''));

      const sorted = matriculaBooks.slice();
      const renderRows = () => {
        const { column, ascending } = booksSortState;
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

        // Refresh sort indicators on the header row.
        document.querySelectorAll('.matricula-books-table thead th.sortable').forEach(th => {
          const colDef = booksCols.find(c => c.f === th.dataset.col);
          const baseLabel = colDef ? colDef.h : th.textContent;
          const indicator = th.dataset.col === booksSortState.column
            ? (booksSortState.ascending ? '&nbsp;▲' : '&nbsp;▼')
            : '';
          th.innerHTML = `${baseLabel}${indicator}`;
        });
      };

      renderRows();

      document.querySelectorAll('.matricula-books-table thead th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.col;
          if (booksSortState.column === col) {
            booksSortState.ascending = !booksSortState.ascending;
          } else {
            booksSortState.column = col;
            booksSortState.ascending = true;
          }
          renderRows();
        });
      });

    };

    const heading = `<div class="matches-page-header">
      <h2 class="matches-page-title">${displayName} - ${formatTitleSuffix(t('col_contributor'))}</h2>
    </div>
    ${statsHtml}
    ${urlHtml}
    ${cloudSectionsHtml}
    ${matriculaSectionHtml}`;

    const loadDetailClouds = () => {
      if (hasTree)      loadSurnameCloud([contribData._tree.contributor_ID],      'contributor-surname-cloud');
      if (hasMatricula) loadSurnameCloud([contribData._matricula.contributor_ID], 'contributor-matricula-surname-cloud', { hideSectionIfEmpty: true });
    };

    if (!showMatchesSection) {
      container.innerHTML = heading;
      loadDetailClouds();
      setupBooksSection();
      return;
    }

    let partners;
    let status = 0;
    try {
      // Matches are only computed for Genealogist (tree) data — fetch by the tree name.
      const treeName = contribData._tree.contributor_ID;
      const res = await fetch(`${API_BASE_URL}/api/contributors/${encodeURIComponent(treeName)}/matches`);
      status = res.status;
      if (!res.ok) throw new Error('API failed');
      partners = await res.json();
      setCurrentMatches(partners, displayName);
    } catch {
      container.innerHTML = heading + `<p>${t(fetchErrorKey(status))}</p>`;
      loadDetailClouds();
      setupBooksSection();
      return;
    }

    if (!partners.length) {
      container.innerHTML = heading +
        `<h3 class="section-heading" style="margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px;">${t('col_matches')}</h3>` +
        `<p>${t('matches_none')}</p>`;
      loadDetailClouds();
      setupBooksSection();
      return;
    }

    // Map to renderTable row format, applying any active filter
    const q = getContributorFilter();
    const filteredPartners = q ? partners.filter(p => p.contributor.toLowerCase().includes(q)) : partners;

    const tableData = filteredPartners.map(p => {
      const partnerData = cached.find(d => d.contributor_ID === baseContributorName(p.contributor));
      const isMatOnly = partnerData ? (!partnerData._tree && !!partnerData._matricula) : false;
      return {
        contributor_ID: p.contributor,
        _match_href: toUnicodeHref({ t: 'contributors', c: displayName, w: p.contributor }),
        total_persons:  p.persons_count  || 0,
        total_families: p.families_count || 0,
        total:          p.total_count,
        confidence:     Math.round((p.max_confidence || 0) * 100),
        _is_matricula_only: isMatOnly,
      };
    });

    container.innerHTML = heading +
      `<div class="matches-summary-section">
        <div class="matches-summary-header section-bar section-bar--top">
          <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('col_matches')}</h3>
          <button class="export-btn export-matches-summary-btn" title="${t('download_csv')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV
          </button>
        </div>
        <div class="matches-summary-content">
          <p>${t('matches_found_intro')} <strong>${displayName}</strong>.<br>${t('matches_found_outro')}</p>
          <div id="matches-summary" class="table-responsive"></div>
        </div>
      </div>`;

    loadDetailClouds();
    setupBooksSection();

    const summaryHeader = container.querySelector('.matches-summary-header h3');
    const summaryContent = container.querySelector('.matches-summary-content');
    if (summaryHeader && summaryContent) {
      summaryHeader.classList.add('collapsible-header');
      summaryHeader.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const isCollapsed = summaryHeader.classList.contains('collapsed');
        summaryContent.style.display = isCollapsed ? '' : 'none';
        summaryHeader.classList.toggle('collapsed', !isCollapsed);
      });
    }

    const summaryCols = ['contributor_ID', 'total_persons', 'total_families', 'total', 'confidence'];
    renderTable(tableData, 'matches-summary', summaryCols, 'total', false);

    const summaryBtn = container.querySelector('.export-matches-summary-btn');
    if (summaryBtn) {
      summaryBtn.addEventListener('click', () => {
        const prefix = siteConfig.filePrefix || 'sgi';
        exportToCSV(tableData, summaryCols, `${prefix}-matches-${displayName}.csv`);
      });
    }

  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
