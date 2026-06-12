import { t, formatTitleSuffix } from '../i18n.js';
import { formatSpecialCell, exportToCSV, runWithBusy, remeasureVirtualColumns, setTableBusy } from '../table.js';
import { formatLinks } from '../lib/links.js';
import { parseDateForSort } from '../lib/dates.js';
import {
  isPrivate, getExpandCollapseIcon, shortenUrlLabel, baseContributorName,
  matriculaIndicatorHtml, geneanetIndicatorHtml, isSpecialContributor, altSurnameIconHtml, baptismIconHtml, notesIconHtml,
  escapeHtml, highlightDifferences, formatExportFilename,
} from '../lib/utils.js';
import { API_BASE_URL } from '../config.js';
import { toUnicodeHref } from '../lib/url.js';
import { DOWNLOAD_ICON } from '../lib/icons.js';
import { authFetch, fetchErrorKey } from '../auth.js';

import { getContributorUrlMap } from './data.js';
import { getContributorFilter, setDetailRefilter } from './filter.js';

// --- Match detail (per-record pair view) ------------------------------------

const DATE_FIELDS_SET = new Set(['date_of_birth', 'date_of_death', 'date_of_marriage', 'husband_birth', 'wife_birth']);
const isDateField = (f) => DATE_FIELDS_SET.has(f);

// Above this match count, a sort/filter re-render blocks long enough to warrant
// the busy spinner (mirrors table.js's threshold for the search tables).
const MATCHES_SPINNER_THRESHOLD = 2000;
// Per-table row count above which we lock column widths and switch the table to
// `content-visibility` virtualization (the `.virtual-table` styles in style.css)
// so off-screen rows are skipped by the browser.
const MATCHES_VIRTUAL_THRESHOLD = 150;
// Pairs (2 <tr> each) rendered synchronously per section on a full rebuild;
// the rest stream in on setTimeout batches so first paint doesn't wait for
// tens of thousands of rows.
const MATCHES_CHUNK_PAIRS = 500;
// Top-N matches by confidence requested per record type; matches the API
// default. Server time scales ~linearly with record count (~0.8ms each), so a
// cemetery-scale pair (25k+) drops from ~25s to ~2s. "Load all" lifts the cap.
const MATCHES_DETAIL_LIMIT = 2000;

// Fields whose text is highlighted (diff'd) when comparing record_a vs record_b.
const HIGHLIGHTABLE = new Set([
  'name', 'surname', 'husband_name', 'husband_surname', 'wife_name', 'wife_surname',
  'date_of_birth', 'place_of_birth', 'date_of_death', 'place_of_death',
  'date_of_burial', 'place_of_burial',
  'date_of_marriage', 'place_of_marriage', 'husband_birth', 'wife_birth',
]);

// Text fields scanned when filtering match-detail rows. Genealogist IDs and
// ext_ids/links are deliberately excluded — the user filters by what they see.
const FILTER_FIELDS = [
  'name', 'surname', 'alt_surname',
  'date_of_birth', 'place_of_birth',
  'date_of_baptism', 'place_of_baptism',
  'date_of_death', 'place_of_death',
  'date_of_burial', 'place_of_burial',
  'notes',
  'husband_name', 'husband_surname', 'husband_alt_surname', 'husband_birth',
  'wife_name', 'wife_surname', 'wife_alt_surname', 'wife_birth',
  'date_of_marriage', 'place_of_marriage',
];

// --- Sorting & reorder helpers (shared by the full rebuild and the fast
// sort-only path). Kept at module scope since they depend on no per-render
// state — only their arguments. ---------------------------------------------

const _collator = new Intl.Collator('sl', { sensitivity: 'base' });

function getMatchValue(r, col) {
  if (col === 'confidence') return r.confidence || 0;
  const val = r.record_a[col];
  if (col === 'links') {
    if (!val) return 0;
    if (Array.isArray(val)) return val.length;
    try { return JSON.parse(val).length; } catch { return 0; }
  }
  if (isDateField(col)) return parseDateForSort(val);
  return String(val || '').toLowerCase();
}

function cmpVals(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return _collator.compare(String(a ?? ''), String(b ?? ''));
}

// Sorts a record group in place. Decorate-sort: each record's sort key(s) are
// computed once (O(n)) instead of inside the comparator (O(n log n)) — getMatchValue
// does real work (toLowerCase, date parsing, JSON length) so on large match sets
// this is the difference between snappy and multi-second. Confidence is the
// implicit final tiebreak (descending) unless it's already the primary/secondary.
function sortGroup(group, state) {
  if (!state || !state.primary || group.length === 0) return;
  const pcol = state.primary.column;
  const scol = state.secondary?.column;
  const needConf = pcol !== 'confidence' && scol !== 'confidence';
  const pk = new Map();
  const sk = scol ? new Map() : null;
  const ck = needConf ? new Map() : null;
  for (const r of group) {
    pk.set(r, getMatchValue(r, pcol));
    if (sk) sk.set(r, getMatchValue(r, scol));
    if (ck) ck.set(r, getMatchValue(r, 'confidence'));
  }
  const dir = state.primary.ascending ? 1 : -1;
  const sdir = state.secondary?.ascending ? 1 : -1;
  group.sort((a, b) => {
    const res = cmpVals(pk.get(a), pk.get(b));
    if (res !== 0) return res * dir;
    if (sk) {
      const sres = cmpVals(sk.get(a), sk.get(b));
      if (sres !== 0) return sres * sdir;
    }
    if (ck) return cmpVals(ck.get(a), ck.get(b)) * -1;
    return 0;
  });
}

// Rewrites the sort-arrow indicators on a section's sortable headers in place
// (keeps the <th> nodes so their click listeners survive). Base label text is
// stashed in data-label at render time.
function updateHeaderArrows(section, state) {
  section.querySelectorAll('th.sortable').forEach(th => {
    const col = th.dataset.col;
    let ind = '';
    if (state.primary.column === col) ind = state.primary.ascending ? '&nbsp;▲' : '&nbsp;▼';
    else if (state.secondary?.column === col) ind = state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';
    th.innerHTML = `${th.dataset.label || ''}${ind}`;
  });
}

// Reorders an already-rendered section's rows to match `group`'s new order by
// moving the existing <tr> pairs (each record = two rows joined by the rowspan
// confidence cell) — no HTML regenerated, so open <details> survive. Re-stripes
// the per-pair even/odd background classes since those are positional.
//
// The <tbody> is detached from the document first: moving thousands of live,
// content-visibility rows one-by-one while attached forces per-move layout
// bookkeeping that goes pathological on large match sets (a cemetery dataset can
// be tens of thousands of pairs). Detached, the moves are pure tree ops with no
// layout cost; reattaching does a single layout pass.
function reorderType(tbody, group, pairMap) {
  if (!tbody) return;
  const parent = tbody.parentNode;
  const next = tbody.nextSibling;
  if (parent) parent.removeChild(tbody);
  group.forEach((r, i) => {
    const pair = pairMap.get(r);
    if (!pair) return;
    const cls = i % 2 === 0 ? 'match-pair-even' : 'match-pair-odd';
    for (const tr of pair) {
      if (!tr) continue;
      tr.classList.remove('match-pair-even', 'match-pair-odd');
      tr.classList.add(cls);
      tbody.appendChild(tr); // moves within the detached tbody — cheap
    }
  });
  if (parent) parent.insertBefore(tbody, next);
}

export async function renderMatchDetail(contributor, partner, contribData, container) {
  const detailEl = container;
  if (!detailEl) return;

  const urlMap = getContributorUrlMap();
  const contribUrl = urlMap[contributor];
  const partnerUrl = urlMap[partner];
  const contribBase = baseContributorName(contributor);
  const partnerBase = baseContributorName(partner);
  const contribInd  = matriculaIndicatorHtml(contributor, t('icon_matricula_index')) + geneanetIndicatorHtml(contributor, t('icon_geneanet_index'));
  const partnerInd  = matriculaIndicatorHtml(partner, t('icon_matricula_index')) + geneanetIndicatorHtml(partner, t('icon_geneanet_index'));

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
      <h2 class="matches-page-title">${partnerBase}${partnerInd} × <a href="${toUnicodeHref({ t: 'contributors', c: contribBase })}" data-spa-nav style="color: inherit; text-decoration: none;">${contribBase}</a>${contribInd} - ${formatTitleSuffix(t('col_matches'))}</h2>
    </div>
    <p>${introText}</p>
    ${urlsHtml}`;

  try {
    let records;
    // Server-side totals per record type. Large pairs are capped to the top-N
    // matches by confidence (MATCHES_DETAIL_LIMIT); totals let the UI say how
    // much was held back and offer "load all".
    let totals = { person: 0, family: 0 };
    let status = 0;

    const fetchRecords = async (limit) => {
      const res = await authFetch(
        `${API_BASE_URL}/api/contributors/${encodeURIComponent(contributor)}/matches/${encodeURIComponent(partner)}?limit=${limit}`
      );
      status = res.status;
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      if (Array.isArray(data)) {
        // Older API: bare uncapped array (ignores ?limit). Totals = loaded.
        records = data;
        totals = {
          person: data.filter(r => r.record_type === 'person').length,
          family: data.filter(r => r.record_type === 'family').length,
        };
      } else {
        records = data.records;
        totals = { person: data.persons_total || 0, family: data.families_total || 0 };
      }
    };

    try {
      await fetchRecords(MATCHES_DETAIL_LIMIT);
    } catch {
      detailEl.innerHTML = baseHtml + `<p>${t(fetchErrorKey(status))}</p>`;
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

    // Per-type display order + DOM pair nodes from the last full render, so a
    // subsequent *sort* (row set unchanged, only order) can reorder existing
    // rows instead of rebuilding the whole section. Keyed: { group, pairMap, tbody }.
    let renderedGroups = {};

    // Bumped by every full renderTables() run; an in-flight chunk stream from a
    // previous render compares its captured token and stops when stale.
    let renderToken = 0;

    const recordSearchText = (rec) =>
      FILTER_FIELDS.map(f => rec[f] || '').join(' ').toLowerCase();
    const pairMatchesFilter = (r, q) => {
      if (!q) return true;
      return recordSearchText(r.record_a).includes(q)
          || recordSearchText(r.record_b).includes(q);
    };

    let currentFilter = getContributorFilter();

    // Synthetic per-record keys used to map DOM rows ↔ records across
    // sort/filter re-renders so we can preserve expanded <details> state.
    const recordKeys = new WeakMap();
    let nextRecordKey = 0;
    const keyFor = (rec) => {
      if (!recordKeys.has(rec)) recordKeys.set(rec, `r${++nextRecordKey}`);
      return recordKeys.get(rec);
    };

    function renderTables() {
      const token = ++renderToken;
      // Sections whose pair rows exceed the first synchronous chunk; their
      // remainder streams in after the innerHTML swap. { key, group, buildPairRow, next }.
      const pendingChunks = [];

      const byType = { person: [], family: [] };
      const loadedCounts = { person: 0, family: 0 };
      records.forEach(r => {
        if (loadedCounts[r.record_type] !== undefined) loadedCounts[r.record_type] += 1;
        if (pairMatchesFilter(r, currentFilter)) byType[r.record_type]?.push(r);
      });
      // True when the server held back rows beyond the top-N cap.
      const truncated = {
        person: totals.person > loadedCounts.person,
        family: totals.family > loadedCounts.family,
      };

      for (const key of ['person', 'family']) {
        sortGroup(byType[key], sortState[key]);
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
            { f: 'date_of_burial',  h: t('col_date_of_burial') },
            { f: 'place_of_burial', h: t('col_place_of_burial') },
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

      if (truncated.person || truncated.family) {
        const shown = (loadedCounts.person + loadedCounts.family).toLocaleString();
        const total = (totals.person + totals.family).toLocaleString();
        html += `<div class="matches-truncated-note">
          ${t('matches_truncated').replace('{0}', shown).replace('{1}', total)}
          <button id="load-all-matches" class="export-btn">${t('matches_load_all')}</button>
        </div>`;
      }

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
            const inner = formatSpecialCell(f, rec, otherRec);
            // data-col lets the sort-rerender capture/restore open <details> state.
            return `<td data-col="${f}">${inner || ''}</td>`;
          }
          if (f === 'links') {
            const icons = formatLinks(rec.links, otherRec.links);
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
          // data-label stashes the base header text so a fast sort-only re-render
          // can rewrite just the arrow indicator (see updateHeaderArrows).
          return `<th data-col="${f}" data-type="${key}" data-label="${String(h).replace(/"/g, '&quot;')}" class="${cls}"${titleAttr}>${h}${indicator}</th>`;
        }).join('');

        let confIndicator = '';
        if (state.primary.column === 'confidence') confIndicator = state.primary.ascending ? '&nbsp;▲' : '&nbsp;▼';
        else if (state.secondary?.column === 'confidence') confIndicator = state.secondary.ascending ? '&nbsp;△' : '&nbsp;▽';

        const buildPairRow = (r, idx) => {
          const pairCls = idx % 2 === 0 ? 'match-pair-even' : 'match-pair-odd';
          const aCells = fields.map(({ f }) => makeCell(r.record_a, r.record_b, f)).join('');
          const bCells = fields.map(({ f }) => makeCell(r.record_b, r.record_a, f)).join('');
          const conf = Math.round((r.confidence || 0) * 100);

          const aContrib = r.record_a.contributor || contributor;
          const bContrib = r.record_b.contributor || partner;

          // Tree-comparison link (persons only). Anchors the compare view on this
          // matched pair using each side's stable (contributor, ext_id) identity
          // rather than the row id (which can change on re-import). The SPA-nav
          // handler gates it behind login on auth-configured sites. Hidden when
          // either side is a special non-tree source (Matricula / Geneanet) or
          // lacks an ext_id.
          let compareLinkHtml = '';
          if (key === 'person' && r.record_a.ext_id && r.record_b.ext_id
              && !isSpecialContributor(aContrib) && !isSpecialContributor(bContrib)) {
            const cmpName = isPrivate(r.record_a.name) || isPrivate(r.record_a.surname)
              ? '' : [r.record_a.name, r.record_a.surname].filter(Boolean).join(' ');
            const cmpHref = toUnicodeHref({
              t: 'compare', ca: aContrib, a: r.record_a.ext_id, cb: bContrib, b: r.record_b.ext_id, pn: cmpName,
            });
            compareLinkHtml = `<div class="compare-link-wrap"><a class="compare-tree-link" href="${cmpHref}" data-spa-nav title="${t('compare_tooltip').replace(/"/g, '&quot;')}">🌳 ${t('compare_action')}</a></div>`;
          }
          const contribBaseL = baseContributorName(aContrib);
          const partnerBaseL = baseContributorName(bContrib);
          const contribIndicator = matriculaIndicatorHtml(aContrib, t('icon_matricula_index')) + geneanetIndicatorHtml(aContrib, t('icon_geneanet_index'));
          const partnerIndicator = matriculaIndicatorHtml(bContrib, t('icon_matricula_index')) + geneanetIndicatorHtml(bContrib, t('icon_geneanet_index'));
          const contributorLink = `<a href="${toUnicodeHref({ t: 'contributors', c: contribBaseL })}" data-spa-nav>${contribBaseL}</a>${contribIndicator}`;
          const partnerLink = `<a href="${toUnicodeHref({ t: 'contributors', c: partnerBaseL })}" data-spa-nav>${partnerBaseL}</a>${partnerIndicator}`;
          return `<tr class="match-pair-row ${pairCls}" data-row-key="${keyFor(r.record_a)}">
                    ${aCells}
                    <td class="match-pair-label match-pair-label-a col-center">${contributorLink}</td>
                    <td rowspan="2" class="match-conf col-center">${conf}%${compareLinkHtml}</td>
                  </tr>
                  <tr class="match-pair-row ${pairCls}" data-row-key="${keyFor(r.record_b)}">
                    ${bCells}
                    <td class="match-pair-label match-pair-label-b col-center">${partnerLink}</td>
                  </tr>`;
        };

        // First chunk renders synchronously for instant first paint; the
        // remainder streams in after the innerHTML swap (chunk loop below).
        const firstCount = Math.min(group.length, MATCHES_CHUNK_PAIRS);
        let groupRows = '';
        for (let i = 0; i < firstCount; i++) groupRows += buildPairRow(group[i], i);
        if (firstCount < group.length) {
          pendingChunks.push({ key, group, buildPairRow, next: firstCount });
        }

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
            <h4 class="${collapsedClass}" style="margin: 0; font-size: 1.1rem; border: none; padding: 0;">${label} (${
              truncated[key] ? `${group.length.toLocaleString()} / ${totals[key].toLocaleString()}` : group.length.toLocaleString()
            })</h4>
            <div class="matches-section-actions" style="display: flex; gap: 10px;">
              ${expandBtnHtml}
              <button class="export-btn export-matches-btn" data-type="${key}" title="${t('download_csv')}">${DOWNLOAD_ICON}CSV</button>
            </div>
          </div>
          <div class="matches-section-content table-responsive"${contentDisplay}>
            <table class="matches-detail-table">
              <thead><tr>
                ${headerCells}
                <th class="col-center" title="${t('tip_contributor_ID').replace(/"/g, '&quot;')}">${t('col_contributor_ID')}</th>
                <th data-col="confidence" data-type="${key}" data-label="${t('col_confidence').replace(/"/g, '&quot;')}" class="sortable col-center" title="${t('tip_confidence').replace(/"/g, '&quot;')}">${t('col_confidence')}${confIndicator}</th>
              </tr></thead>
              <tbody>${groupRows}</tbody>
            </table>
          </div>
        </div>`;
      }

      html += '</div>';

      // Capture which <details> cells are currently open, keyed by row-key +
      // column name. Re-applied after the innerHTML swap so sorting/filtering
      // doesn't collapse cells the user expanded.
      const openMap = new Map();
      detailEl.querySelectorAll('details.expandable-cell[open]').forEach(det => {
        const td = det.closest('td');
        const tr = det.closest('tr');
        const col = td?.dataset.col;
        const rowKey = tr?.dataset.rowKey;
        if (!col || !rowKey) return;
        if (!openMap.has(rowKey)) openMap.set(rowKey, new Set());
        openMap.get(rowKey).add(col);
      });

      detailEl.innerHTML = html;

      // Virtualize large match tables: measure the freshly-rendered (auto-layout)
      // column widths, lock them as percentages via a <colgroup>, then switch to
      // fixed layout + per-row content-visibility (.virtual-table, styled in
      // style.css) so the browser skips layout/paint of off-screen rows. Fixed
      // layout is required so skipped rows don't make columns jitter on scroll.
      detailEl.querySelectorAll('table.matches-detail-table').forEach(table => {
        if (table.tBodies[0]?.rows.length <= MATCHES_VIRTUAL_THRESHOLD) return;
        const widths = Array.from(table.querySelectorAll('thead th'), th => th.offsetWidth);
        const total = widths.reduce((a, b) => a + b, 0) || 1;
        const colgroup = document.createElement('colgroup');
        colgroup.innerHTML = widths.map(w => `<col style="width:${((w / total) * 100).toFixed(3)}%">`).join('');
        table.insertBefore(colgroup, table.firstChild);
        // Record the measured natural width; the mobile breakpoint applies it
        // as min-width so phones pan via the .table-responsive wrapper instead
        // of squeezing the columns.
        table.style.setProperty('--vt-natural-width', `${Math.round(total)}px`);
        table.classList.add('virtual-table');
      });

      // --- immediate listeners (don't depend on rows being complete) -------
      const loadAllBtn = detailEl.querySelector('#load-all-matches');
      if (loadAllBtn) {
        loadAllBtn.addEventListener('click', async () => {
          loadAllBtn.disabled = true;
          setTableBusy(true);
          try {
            await fetchRecords(0); // 0 = no cap
            renderTables();
          } catch {
            loadAllBtn.disabled = false;
          } finally {
            setTableBusy(false);
          }
        });
      }

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

      detailEl.querySelectorAll('.export-matches-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const typeKey = btn.dataset.type;
          // CSV must never be silently truncated by the server-side top-N cap:
          // when the page holds a partial set, fetch the rest first (updating
          // the visible table too), then export. On a failed fetch we fall
          // back to exporting the loaded subset — same as the pre-cap behavior.
          if (records.length < totals.person + totals.family) {
            setTableBusy(true);
            try {
              await fetchRecords(0); // 0 = no cap
              renderTables();
            } catch (err) {
              console.error('full fetch for CSV export failed; exporting loaded subset', err);
            } finally {
              setTableBusy(false);
            }
          }
          // Recompute from `records` rather than the closure's byType: the
          // fetch above may have replaced the record set. The sidebar filter
          // still applies (an explicit user choice), and the rows are ordered
          // like the visible table.
          const typeData = records.filter(
            r => r.record_type === typeKey && pairMatchesFilter(r, currentFilter)
          );
          sortGroup(typeData, sortState[typeKey]);
          const config = typeConfig.find(c => c.key === typeKey);
          const flatData = [];
          typeData.forEach(r => {
            flatData.push({ ...r.record_a, contributor_ID: contributor, confidence: Math.round((r.confidence || 0) * 100) });
            flatData.push({ ...r.record_b, contributor_ID: partner, confidence: Math.round((r.confidence || 0) * 100) });
          });
          const cols = [...config.fields.map(f => f.f), 'contributor_ID', 'confidence'];
          exportToCSV(flatData, cols, formatExportFilename(`matches-${typeKey}-${contributor}-${partner}`, 'csv'));
        });
      });

      // --- deferred wiring: needs every pair row in the DOM -----------------
      // Runs synchronously when all sections fit in the first chunk; otherwise
      // after the chunk stream below finishes. Sort/expand listeners are part of
      // it, so those controls can't act on a half-populated tbody.
      const finishWiring = () => {
        if (openMap.size) {
          detailEl.querySelectorAll('tr[data-row-key]').forEach(tr => {
            const openCols = openMap.get(tr.dataset.rowKey);
            if (!openCols) return;
            openCols.forEach(col => {
              const det = tr.querySelector(`td[data-col="${col}"] details.expandable-cell`);
              if (det) det.open = true;
            });
          });

          // Sync each section's expand-all toggle to match the restored state.
          detailEl.querySelectorAll('.matches-section').forEach(section => {
            const btn = section.querySelector('.expand-matches-btn');
            if (!btn) return;
            const allEls = section.querySelectorAll('details.expandable-cell');
            const allOpen = allEls.length > 0 && Array.from(allEls).every(d => d.open);
            btn.dataset.allOpen = allOpen ? '1' : '0';
            const text = allOpen ? t('collapse_all') : t('expand_all');
            btn.innerHTML = `${getExpandCollapseIcon(allOpen)}${text}`;
            btn.title = text;
          });
        }

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
            // sortType() reorders the existing rows (no HTML rebuilt). On a large
            // set even that takes a beat, so run it behind the spinner.
            runWithBusy(records.length > MATCHES_SPINNER_THRESHOLD, () => sortType(type));
          });
        });

        detailEl.querySelectorAll('.expand-matches-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const section = btn.closest('.matches-section');
            if (!section) return;
            const targetOpen = btn.dataset.allOpen !== '1';
            runWithBusy(records.length > MATCHES_SPINNER_THRESHOLD, () => {
              section.querySelectorAll('details.expandable-cell').forEach(d => { d.open = targetOpen; });
              // Expanded cells need more width than the collapsed-state colgroup
              // allotted, so re-lock this table's column widths to the new content.
              remeasureVirtualColumns(section.querySelector('table.virtual-table'));
              btn.dataset.allOpen = targetOpen ? '1' : '0';
              const text = targetOpen ? t('collapse_all') : t('expand_all');
              btn.innerHTML = `${getExpandCollapseIcon(targetOpen)}${text}`;
              btn.title = text;
            });
          });
        });

        // Snapshot each rendered section so a later sort can reorder its existing
        // rows. tbody rows are in `group` order, two consecutive <tr> per record
        // (record_a row, record_b row), so map record → [trA, trB].
        renderedGroups = {};
        for (const key of ['person', 'family']) {
          const group = byType[key];
          if (!group.length) continue;
          const tbody = detailEl.querySelector(`.matches-section[data-type="${key}"] table.matches-detail-table tbody`);
          if (!tbody) continue;
          const rows = tbody.children;
          const pairMap = new Map();
          group.forEach((r, i) => pairMap.set(r, [rows[2 * i], rows[2 * i + 1]]));
          renderedGroups[key] = { group, pairMap, tbody };
        }
      };

      if (!pendingChunks.length) {
        finishWiring();
        return;
      }

      // Stream the remaining pair rows into their tbodies in setTimeout batches
      // behind the spinner — first paint showed the first chunk already. The
      // captured token detects a newer render (filter rebuild, navigation) and
      // stops; the stale-DOM check covers the page being torn down entirely.
      for (const job of pendingChunks) {
        job.tbody = detailEl.querySelector(`.matches-section[data-type="${job.key}"] table.matches-detail-table tbody`);
      }
      setTableBusy(true);
      const appendNext = () => {
        if (token !== renderToken || !detailEl.isConnected) {
          setTableBusy(false);
          return;
        }
        const job = pendingChunks[0];
        const end = Math.min(job.group.length, job.next + MATCHES_CHUNK_PAIRS);
        let chunkHtml = '';
        for (let i = job.next; i < end; i++) chunkHtml += job.buildPairRow(job.group[i], i);
        job.tbody.insertAdjacentHTML('beforeend', chunkHtml);
        job.next = end;
        if (job.next >= job.group.length) pendingChunks.shift();
        if (pendingChunks.length) {
          setTimeout(appendNext, 0);
        } else {
          setTableBusy(false);
          finishWiring();
        }
      };
      setTimeout(appendNext, 0);
    }

    // Fast path for a header-sort click: the visible row set is unchanged, only
    // its order, so re-sort the stored group and physically reorder the existing
    // <tr> pairs instead of rebuilding the section. Falls back to a full render
    // if the section was never rendered (shouldn't normally happen).
    function sortType(key) {
      const rendered = renderedGroups[key];
      const section = detailEl.querySelector(`.matches-section[data-type="${key}"]`);
      if (!rendered || !section) { renderTables(); return; }
      sortGroup(rendered.group, sortState[key]);
      updateHeaderArrows(section, sortState[key]);
      reorderType(rendered.tbody, rendered.group, rendered.pairMap);
    }

    renderTables();

    // Expose a refilter callback so the sidebar input can re-filter live.
    // Debounced: each keystroke triggers a full rebuild, which on a large match
    // set is the expensive path — wait for a typing pause, then rebuild behind
    // the spinner. A rebuild bumps renderToken, so any chunk stream still
    // running from the previous render stops itself.
    let filterTimer = null;
    setDetailRefilter((q) => {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(() => {
        currentFilter = (q || '').trim().toLowerCase();
        runWithBusy(records.length > MATCHES_SPINNER_THRESHOLD, renderTables);
      }, 250);
    });
  } finally {
    // overlay is handled cleanly by renderMatchesPage's outer try/finally
  }
}
