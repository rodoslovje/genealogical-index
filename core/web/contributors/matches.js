import { t } from '../i18n.js';
import { renderTable, formatSpecialCell, exportToCSV } from '../table.js';
import { formatLinks } from '../links.js';
import { parseDateForSort } from '../dates.js';
import {
  isPrivate, getExpandCollapseIcon, shortenUrlLabel, baseContributorName,
  matriculaIndicatorHtml, altSurnameIconHtml, baptismIconHtml, notesIconHtml,
  escapeHtml,
} from '../utils.js';
import { API_BASE_URL } from '../config.js';
import { toUnicodeHref } from '../url.js';
import siteConfig from '@site-config';

import { ensureData, getCachedData, getContributorUrlMap } from './data.js';
import { loadSurnameCloud } from './cloud.js';
import {
  getContributorFilter, setCurrentMatches, setDetailRefilter,
} from './filter.js';

// Wraps a value in a diff-highlight span when it differs from the partner's
// equivalent field. Falls back to plain escape when both sides match.
function highlightDifferences(val, otherVal) {
  if (!val) return '';
  const valStr = String(val);
  if (!otherVal) return `<span class="match-diff">${escapeHtml(valStr)}</span>`;

  if (valStr.toLowerCase() === String(otherVal).toLowerCase()) {
    return escapeHtml(valStr);
  }

  const otherWords = new Set(String(otherVal).toLowerCase().match(/[\p{L}\d]+/gu) || []);
  if (otherWords.size === 0) return `<span class="match-diff">${escapeHtml(valStr)}</span>`;

  const tokens = valStr.split(/([\p{L}\d]+)/u);
  return tokens.map(token => {
    if (/^[\p{L}\d]+$/u.test(token) && !otherWords.has(token.toLowerCase())) {
      return `<span class="match-diff">${escapeHtml(token)}</span>`;
    }
    return escapeHtml(token);
  }).join('');
}

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
      ${row('tip_last_modified',  t('col_last_update'),    contribData.last_modified || '')}
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
    ${metricRow('tip_last_modified',  t('col_last_update'),    lastSum,                          lastTree,                  lastMat)}
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
        <h2 class="matches-page-title">${safeContributor}${contribInd} - ${t('col_contributor')}</h2>
      </div>
      <p>${t('no_results')}</p>`;
      return;
    }

    const displayName = baseContributor;
    const hasTree = !!contribData._tree;
    const hasMatricula = !!contribData._matricula;
    const showMatchesSection = hasTree; // matches only exist for Genealogist data

    if (withPartner) {
      const basePartner = baseContributorName(withPartner);
      const partnerData = cached.find(d => d.contributor_ID === basePartner);
      if (!partnerData) {
        const safePartner = escapeHtml(basePartner);
        const partnerInd  = matriculaIndicatorHtml(withPartner, t('icon_matricula_index'));
        document.title = `${t('no_results')} | ${t('site_title')}`;
        container.innerHTML = `<div class="matches-page-header">
          <h2 class="matches-page-title">${safePartner}${partnerInd} × <a href="${toUnicodeHref({ t: 'contributors', c: displayName })}" data-spa-nav style="color: inherit; text-decoration: none;">${displayName}</a> - ${t('col_matches')}</h2>
        </div>
        <p>${t('no_results')}</p>`;
        return;
      }
      document.title = `${basePartner} × ${displayName} - ${t('col_matches')} | ${t('site_title')}`;
      await renderMatchDetail(contributor, withPartner, contribData, container);
      return;
    }

    document.title = `${displayName} - ${t('col_contributor')} | ${t('site_title')}`;

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
    if (hasMatricula) {
      cloudSectionsHtml += `<div class="surname-cloud-section" style="margin-bottom: 24px;">
        <div class="surname-cloud-header section-bar">
          <h3 class="section-heading" data-i18n="section_surnames_matricula" style="margin: 0; padding: 0; border: none;">${t('section_surnames_matricula')}</h3>
        </div>
        <p>${t('contributor_surnames_intro')} <strong>${displayName}</strong> ${t('contributor_surnames_matricula_outro')}</p>
        <div class="surname-cloud" id="contributor-matricula-surname-cloud" data-i18n-title="chart_surnames_title"></div>
      </div>`;
    }

    const heading = `<div class="matches-page-header">
      <h2 class="matches-page-title">${displayName} - ${t('col_contributor')}</h2>
    </div>
    ${statsHtml}
    ${urlHtml}
    ${cloudSectionsHtml}`;

    const loadDetailClouds = () => {
      if (hasTree)      loadSurnameCloud([contribData._tree.contributor_ID],      'contributor-surname-cloud');
      if (hasMatricula) loadSurnameCloud([contribData._matricula.contributor_ID], 'contributor-matricula-surname-cloud', { hideSectionIfEmpty: true });
    };

    if (!showMatchesSection) {
      container.innerHTML = heading;
      loadDetailClouds();
      return;
    }

    let partners;
    try {
      // Matches are only computed for Genealogist (tree) data — fetch by the tree name.
      const treeName = contribData._tree.contributor_ID;
      const res = await fetch(`${API_BASE_URL}/api/contributors/${encodeURIComponent(treeName)}/matches`);
      if (!res.ok) throw new Error('API failed');
      partners = await res.json();
      setCurrentMatches(partners, displayName);
    } catch {
      container.innerHTML = heading + `<p>${t('search_failed')}</p>`;
      loadDetailClouds();
      return;
    }

    if (!partners.length) {
      container.innerHTML = heading +
        `<h3 class="section-heading" style="margin-top: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px;">${t('col_matches')}</h3>` +
        `<p>${t('matches_none')}</p>`;
      loadDetailClouds();
      return;
    }

    // Map to renderTable row format, applying any active filter
    const q = getContributorFilter();
    const filteredPartners = q ? partners.filter(p => p.contributor.toLowerCase().includes(q)) : partners;

    const tableData = filteredPartners.map(p => ({
      contributor_ID: p.contributor,
      _match_href: toUnicodeHref({ t: 'contributors', c: displayName, w: p.contributor }),
      total_persons:  p.persons_count  || 0,
      total_families: p.families_count || 0,
      total:          p.total_count,
      confidence:     Math.round((p.max_confidence || 0) * 100),
    }));

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

// --- Match detail (per-record pair view) ------------------------------------

const DATE_FIELDS_SET = new Set(['date_of_birth', 'date_of_death', 'date_of_marriage', 'husband_birth', 'wife_birth']);
const isDateField = (f) => DATE_FIELDS_SET.has(f);

// Fields whose text is highlighted (diff'd) when comparing record_a vs record_b.
const HIGHLIGHTABLE = new Set([
  'name', 'surname', 'husband_name', 'husband_surname', 'wife_name', 'wife_surname',
  'date_of_birth', 'place_of_birth', 'date_of_death', 'place_of_death',
  'date_of_marriage', 'place_of_marriage', 'husband_birth', 'wife_birth',
]);

// Text fields scanned when filtering match-detail rows. Genealogist IDs and
// ext_ids/links are deliberately excluded — the user filters by what they see.
const FILTER_FIELDS = [
  'name', 'surname', 'alt_surname',
  'date_of_birth', 'place_of_birth',
  'date_of_baptism', 'place_of_baptism',
  'date_of_death', 'place_of_death',
  'notes',
  'husband_name', 'husband_surname', 'husband_alt_surname', 'husband_birth',
  'wife_name', 'wife_surname', 'wife_alt_surname', 'wife_birth',
  'date_of_marriage', 'place_of_marriage',
];

async function renderMatchDetail(contributor, partner, contribData, container) {
  const detailEl = container;
  if (!detailEl) return;

  const urlMap = getContributorUrlMap();
  const contribUrl = urlMap[contributor];
  const partnerUrl = urlMap[partner];
  const contribBase = baseContributorName(contributor);
  const partnerBase = baseContributorName(partner);
  const contribInd  = matriculaIndicatorHtml(contributor, t('icon_matricula_index'));
  const partnerInd  = matriculaIndicatorHtml(partner, t('icon_matricula_index'));

  let urlsHtml = '';
  if (contribUrl || partnerUrl) {
    urlsHtml = `<div style="margin-bottom: 20px; font-size: 0.95rem; color: #444; display: flex; flex-wrap: wrap; gap: 16px 40px;">`;
    if (partnerUrl) {
      urlsHtml += `<div>${t('more_info_about')} <strong>${partnerBase}</strong>${partnerInd}:<div style="margin-top: 8px;"><a href="${partnerUrl}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(partnerUrl)}</a></div></div>`;
    }
    if (contribUrl) {
      urlsHtml += `<div>${t('more_info_about')} <strong>${contribBase}</strong>${contribInd}:<div style="margin-top: 8px;"><a href="${contribUrl}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(contribUrl)}</a></div></div>`;
    }
    urlsHtml += `</div>`;
  }

  const primaryHtml = `<strong><a href="${toUnicodeHref({ t: 'contributors', c: contribBase })}" data-spa-nav>${contribBase}</a></strong>${contribInd}`;
  const secondaryHtml = `<strong><a href="${toUnicodeHref({ t: 'contributors', c: partnerBase })}" data-spa-nav>${partnerBase}</a></strong>${partnerInd}`;
  const introText = t('matches_detail_intro').replace('{0}', primaryHtml).replace('{1}', secondaryHtml);

  const baseHtml = `
    <div class="matches-page-header">
      <h2 class="matches-page-title">${partnerBase}${partnerInd} × <a href="${toUnicodeHref({ t: 'contributors', c: contribBase })}" data-spa-nav style="color: inherit; text-decoration: none;">${contribBase}</a>${contribInd} - ${t('col_matches')}</h2>
    </div>
    <p>${introText}</p>
    ${urlsHtml}`;

  try {
    let records;
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/contributors/${encodeURIComponent(contributor)}/matches/${encodeURIComponent(partner)}`
      );
      if (!res.ok) throw new Error('API failed');
      records = await res.json();
    } catch {
      detailEl.innerHTML = baseHtml + `<p>${t('search_failed')}</p>`;
      return;
    }

    if (!records || !records.length) {
      detailEl.innerHTML = baseHtml + `<p>${t('matches_none')}</p>`;
      return;
    }

    const sortState = {
      person: { primary: { column: 'confidence', ascending: false }, secondary: null },
      family: { primary: { column: 'confidence', ascending: false }, secondary: null },
    };

    const collapseState = { person: false, family: false };

    const recordSearchText = (rec) =>
      FILTER_FIELDS.map(f => rec[f] || '').join(' ').toLowerCase();
    const pairMatchesFilter = (r, q) => {
      if (!q) return true;
      return recordSearchText(r.record_a).includes(q)
          || recordSearchText(r.record_b).includes(q);
    };

    let currentFilter = getContributorFilter();

    function renderTables() {
      const byType = { person: [], family: [] };
      records.forEach(r => {
        if (pairMatchesFilter(r, currentFilter)) byType[r.record_type]?.push(r);
      });

      const collator = new Intl.Collator('sl', { sensitivity: 'base' });
      const getMatchValue = (r, col) => {
        if (col === 'confidence') return r.confidence || 0;
        const val = r.record_a[col];
        if (col === 'links') {
          if (!val) return 0;
          if (Array.isArray(val)) return val.length;
          try { return JSON.parse(val).length; } catch { return 0; }
        }
        if (isDateField(col)) return parseDateForSort(val);
        return String(val || '').toLowerCase();
      };
      const cmp = (a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return collator.compare(String(a ?? ''), String(b ?? ''));
      };

      for (const key of ['person', 'family']) {
        const state = sortState[key];
        if (state && state.primary && byType[key].length > 0) {
          byType[key].sort((a, b) => {
            const dir = state.primary.ascending ? 1 : -1;
            const res = cmp(getMatchValue(a, state.primary.column), getMatchValue(b, state.primary.column));
            if (res !== 0) return res * dir;
            if (state.secondary) {
              const sdir = state.secondary.ascending ? 1 : -1;
              const sres = cmp(getMatchValue(a, state.secondary.column), getMatchValue(b, state.secondary.column));
              if (sres !== 0) return sres * sdir;
            }
            if (state.primary.column !== 'confidence' && (!state.secondary || state.secondary.column !== 'confidence')) {
              return cmp(getMatchValue(a, 'confidence'), getMatchValue(b, 'confidence')) * -1;
            }
            return 0;
          });
        }
      }

      const buildSearchUrl = (tab, pairs) => {
        const p = new URLSearchParams({ t: tab, ex: '1' });
        pairs.forEach(([key, val]) => { if (val) p.set(key, val); });
        return toUnicodeHref(p);
      };

      const typeConfig = [
        {
          key: 'person', label: t('matches_persons'),
          fields: [
            { f: 'name',           h: t('col_name') },
            { f: 'surname',        h: t('col_surname') },
            { f: 'date_of_birth',  h: t('col_date_of_birth') },
            { f: 'place_of_birth', h: t('col_place_of_birth') },
            { f: 'date_of_death',  h: t('col_date_of_death') },
            { f: 'place_of_death', h: t('col_place_of_death') },
            { f: 'links',          h: t('col_links') },
            { f: 'partners',       h: t('col_partners') },
            { f: 'parents',        h: t('col_parents') },
          ],
          searchUrl: rec => {
            if (isPrivate(rec.name) || isPrivate(rec.surname)) return null;
            return buildSearchUrl('person', [['n', rec.name], ['sn', rec.surname]]);
          },
          linkedFields: new Set(['name', 'surname']),
        },
        {
          key: 'family', label: t('matches_families'),
          fields: [
            { f: 'husband_name',      h: t('col_husband_name') },
            { f: 'husband_surname',   h: t('col_husband_surname') },
            { f: 'husband_birth',     h: t('col_husband_birth') },
            { f: 'wife_name',         h: t('col_wife_name') },
            { f: 'wife_surname',      h: t('col_wife_surname') },
            { f: 'wife_birth',        h: t('col_wife_birth') },
            { f: 'date_of_marriage',  h: t('col_date_of_marriage') },
            { f: 'place_of_marriage', h: t('col_place_of_marriage') },
            { f: 'links',             h: t('col_links') },
            { f: 'children',          h: t('col_children') },
            { f: 'parents',           h: t('col_parents') },
          ],
          searchUrl: (rec, field) => {
            if (field === 'husband_name' || field === 'husband_surname') {
              if (isPrivate(rec.husband_name) || isPrivate(rec.husband_surname)) return null;
              return buildSearchUrl('family', [['hn', rec.husband_name], ['hsn', rec.husband_surname]]);
            }
            if (field === 'wife_name' || field === 'wife_surname') {
              if (isPrivate(rec.wife_name) || isPrivate(rec.wife_surname)) return null;
              return buildSearchUrl('family', [['wn', rec.wife_name], ['wsn', rec.wife_surname]]);
            }
            return null;
          },
          linkedFields: new Set(['husband_name', 'husband_surname', 'wife_name', 'wife_surname']),
        },
      ];

      let html = baseHtml;

      // Field → optional row-icon builder. Adding a new icon is one entry.
      const ROW_ICON_BUILDERS = {
        surname:         (r) => altSurnameIconHtml(r.alt_surname,          t('icon_alt_surname')),
        husband_surname: (r) => altSurnameIconHtml(r.husband_alt_surname,  t('icon_alt_surname')),
        wife_surname:    (r) => altSurnameIconHtml(r.wife_alt_surname,     t('icon_alt_surname')),
        date_of_birth:   (r) => baptismIconHtml(r.date_of_baptism, r.place_of_baptism, t('icon_baptism')),
        place_of_birth:    (r) => notesIconHtml(r.notes, t('icon_notes')),
        place_of_marriage: (r) => notesIconHtml(r.notes, t('icon_notes')),
      };
      const extraIcon = (rec, f) => ROW_ICON_BUILDERS[f]?.(rec) || '';

      for (const { key, label, fields, searchUrl, linkedFields } of typeConfig) {
        const group = byType[key];
        if (!group.length) continue;

        const state = sortState[key];

        const makeCell = (rec, otherRec, f) => {
          if (f === 'parents' || f === 'children' || f === 'partners') {
            const inner = formatSpecialCell(f, rec);
            return `<td>${inner || ''}</td>`;
          }
          if (f === 'links') {
            const icons = formatLinks(rec.links);
            return `<td class="link-cell">${icons || ''}</td>`;
          }
          const val = rec[f] || '';

          let safeVal;
          if (HIGHLIGHTABLE.has(f)) {
            let otherText = otherRec[f] || '';
            if (f.endsWith('surname')) {
              const altF = f === 'surname' ? 'alt_surname' : f.replace('surname', 'alt_surname');
              if (otherRec[altF]) otherText += ' ' + otherRec[altF];
            }
            safeVal = highlightDifferences(val, otherText);
          } else {
            safeVal = escapeHtml(val);
          }

          const cls = isDateField(f) ? ' class="col-right"' : '';
          const extra = extraIcon(rec, f);
          if (val && linkedFields.has(f)) {
            const href = searchUrl(rec, f);
            if (href) return `<td${cls}><a href="${href}" data-spa-nav class="name-link">${safeVal}</a>${extra}</td>`;
          }
          return `<td${cls}>${safeVal}${extra}</td>`;
        };

        const headerCells = fields.map(({ h, f }) => {
          let cls = isDateField(f) ? 'sortable col-right' : 'sortable';
          if (f === 'links') cls += ' col-center';
          let indicator = '';
          if (state.primary.column === f) indicator = state.primary.ascending ? '&nbsp;▲' : '&nbsp;▼';
          else if (state.secondary?.column === f) indicator = state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';
          const tipKey = f === 'parents'
            ? (key === 'family' ? 'tip_parents_family' : 'tip_parents_person')
            : `tip_${f}`;
          const tipText = t(tipKey);
          const titleAttr = tipText && tipText !== tipKey ? ` title="${tipText.replace(/"/g, '&quot;')}"` : '';
          return `<th data-col="${f}" data-type="${key}" class="${cls}"${titleAttr}>${h}${indicator}</th>`;
        }).join('');

        let confIndicator = '';
        if (state.primary.column === 'confidence') confIndicator = state.primary.ascending ? '&nbsp;▲' : '&nbsp;▼';
        else if (state.secondary?.column === 'confidence') confIndicator = state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';

        const groupRows = group.map((r, idx) => {
          r.record_a.contributor = contributor;
          r.record_b.contributor = partner;
          const pairCls = idx % 2 === 0 ? 'match-pair-even' : 'match-pair-odd';
          const aCells = fields.map(({ f }) => makeCell(r.record_a, r.record_b, f)).join('');
          const bCells = fields.map(({ f }) => makeCell(r.record_b, r.record_a, f)).join('');
          const conf = Math.round((r.confidence || 0) * 100);
          const contribBaseL = baseContributorName(contributor);
          const partnerBaseL = baseContributorName(partner);
          const contribIndicator = matriculaIndicatorHtml(contributor, t('icon_matricula_index'));
          const partnerIndicator = matriculaIndicatorHtml(partner, t('icon_matricula_index'));
          const contributorLink = `<a href="${toUnicodeHref({ t: 'contributors', c: contribBaseL })}" data-spa-nav>${contribBaseL}</a>${contribIndicator}`;
          const partnerLink = `<a href="${toUnicodeHref({ t: 'contributors', c: partnerBaseL })}" data-spa-nav>${partnerBaseL}</a>${partnerIndicator}`;
          return `<tr class="match-pair-row ${pairCls}">
                    ${aCells}
                    <td class="match-pair-label match-pair-label-a col-center">${contributorLink}</td>
                    <td rowspan="2" class="match-conf col-center">${conf}%</td>
                  </tr>
                  <tr class="match-pair-row ${pairCls}">
                    ${bCells}
                    <td class="match-pair-label match-pair-label-b col-center">${partnerLink}</td>
                  </tr>`;
        }).join('');

        // Only show the expand-all toggle when this group's table actually contains
        // expandable cells (parents/partners/children).
        const hasExpandable = fields.some(f => f.f === 'parents' || f.f === 'partners' || f.f === 'children');
        const expandBtnHtml = hasExpandable
          ? `<button class="export-btn expand-toggle-btn expand-matches-btn" data-type="${key}" data-all-open="0" title="${t('expand_all')}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>${t('expand_all')}
            </button>`
          : '';

        const isCollapsed = collapseState[key];
        const collapsedClass = isCollapsed ? ' collapsible-header collapsed' : ' collapsible-header';
        const contentDisplay = isCollapsed ? ' style="display: none;"' : '';

        html += `<div class="matches-section" data-type="${key}">
          <div class="section-bar section-bar--top-sm">
            <h4 class="${collapsedClass}" style="margin: 0; font-size: 1.1rem; border: none; padding: 0;">${label} (${group.length})</h4>
            <div class="matches-section-actions" style="display: flex; gap: 10px;">
              ${expandBtnHtml}
              <button class="export-btn export-matches-btn" data-type="${key}" title="${t('download_csv')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV
              </button>
            </div>
          </div>
          <div class="matches-section-content table-responsive"${contentDisplay}>
            <table class="matches-detail-table">
              <thead><tr>
                ${headerCells}
                <th class="col-center" title="${t('tip_contributor_ID').replace(/"/g, '&quot;')}">${t('col_contributor_ID')}</th>
                <th data-col="confidence" data-type="${key}" class="sortable col-center" title="${t('tip_confidence').replace(/"/g, '&quot;')}">${t('col_confidence')}${confIndicator}</th>
              </tr></thead>
              <tbody>${groupRows}</tbody>
            </table>
          </div>
        </div>`;
      }

      html += '</div>';
      detailEl.innerHTML = html;

      // --- listeners -----------------------------------------------------
      detailEl.querySelectorAll('.matches-section').forEach(section => {
        const typeKey = section.dataset.type;
        const header = section.querySelector('h4');
        const content = section.querySelector('.matches-section-content');
        if (header && content) {
          header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a')) return;
            const isCollapsed = header.classList.contains('collapsed');
            content.style.display = isCollapsed ? '' : 'none';
            header.classList.toggle('collapsed', !isCollapsed);
            collapseState[typeKey] = !isCollapsed;
          });
        }
      });

      detailEl.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const col = th.dataset.col;
          const type = th.dataset.type;
          const state = sortState[type];
          if (state.primary?.column === col) {
            state.primary.ascending = !state.primary.ascending;
          } else {
            state.secondary = state.primary;
            state.primary = { column: col, ascending: true };
          }
          renderTables();
        });
      });

      detailEl.querySelectorAll('.export-matches-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const prefix = siteConfig.filePrefix || 'sgi';
          const typeKey = btn.dataset.type;
          const typeData = byType[typeKey];
          const config = typeConfig.find(c => c.key === typeKey);
          const flatData = [];
          typeData.forEach(r => {
            flatData.push({ ...r.record_a, contributor_ID: contributor, confidence: Math.round((r.confidence || 0) * 100) });
            flatData.push({ ...r.record_b, contributor_ID: partner, confidence: Math.round((r.confidence || 0) * 100) });
          });
          const cols = [...config.fields.map(f => f.f), 'contributor_ID', 'confidence'];
          exportToCSV(flatData, cols, `${prefix}-matches-${typeKey}-${contributor}-${partner}.csv`);
        });
      });

      detailEl.querySelectorAll('.expand-matches-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const section = btn.closest('.matches-section');
          if (!section) return;
          const targetOpen = btn.dataset.allOpen !== '1';
          section.querySelectorAll('details.expandable-cell').forEach(d => { d.open = targetOpen; });
          btn.dataset.allOpen = targetOpen ? '1' : '0';
          const text = targetOpen ? t('collapse_all') : t('expand_all');
          btn.innerHTML = `${getExpandCollapseIcon(targetOpen)}${text}`;
          btn.title = text;
        });
      });
    }

    renderTables();

    // Expose a refilter callback so the sidebar input can re-filter live.
    setDetailRefilter((q) => {
      currentFilter = (q || '').trim().toLowerCase();
      renderTables();
    });
  } finally {
    // overlay is handled cleanly by renderMatchesPage's outer try/finally
  }
}
