import { t } from './i18n.js';
import { renderTable, formatSpecialCell, exportToCSV } from './table.js';
import { formatLinks } from './links.js';
import { parseDateForSort } from './dates.js';
import { isPrivate, cmp, getExpandCollapseIcon, shortenUrlLabel } from './utils.js';
import { API_BASE_URL } from './config.js';
import { toUnicodeHref, toUnicodeSearch } from './url.js';
import siteConfig from '@site-config';

const contributorColumns = ['contributor_ID', 'total_persons', 'total_families', 'total', 'total_links', 'last_modified', 'matches'];
const MATRICULA_SUFFIX = '-matricula';
const baseContributorName = (name) => name && name.endsWith(MATRICULA_SUFFIX)
  ? name.slice(0, -MATRICULA_SUFFIX.length)
  : name;

// Expands aggregated contributor rows back to underlying DB contributor IDs
// (e.g. ["Kovačič", "Kovačič-matricula"]) so surname-cloud / search queries
// include matricula records.
function expandContributorNames(rows) {
  const names = [];
  rows.forEach(r => {
    if (r._tree)      names.push(r._tree.contributor_ID);
    if (r._matricula) names.push(r._matricula.contributor_ID);
    if (!r._tree && !r._matricula) names.push(r.contributor_ID);
  });
  return names;
}

let cachedData = null;
let fetchPromise = null;
let chartInstance = null;

let timelineData = null;
let timelinePromise = null;
let timelineChartInstance = null;

let matchCountsData = null;
let matchCountsPromise = null;

let currentMatchesData = null;
let currentMatchesContributor = null;

function _toPart(p) {
  if (!p) return null;
  return {
    contributor_ID: p.name,
    total_persons: p.persons_count || 0,
    total_families: p.families_count || 0,
    total: (p.persons_count || 0) + (p.families_count || 0),
    total_links: p.links_count || 0,
    last_modified: p.last_modified ? p.last_modified.slice(0, 10) : '',
    _url: p.url || '',
  };
}

function ensureData() {
  if (cachedData) return Promise.resolve(cachedData);
  if (!fetchPromise) {
    fetchPromise = fetch(`${API_BASE_URL}/api/contributors/`)
      .then(r => r.json())
      .then(metadata => {
        // Backend returns one entry per base contributor with summed totals
        // and an optional tree/matricula breakdown.
        cachedData = metadata.map(m => ({
          contributor_ID: m.name,
          total_persons: m.persons_count || 0,
          total_families: m.families_count || 0,
          total: (m.persons_count || 0) + (m.families_count || 0),
          total_links: m.links_count || 0,
          last_modified: m.last_modified ? m.last_modified.slice(0, 10) : '',
          _url: m.url || '',
          _tree: _toPart(m.tree),
          _matricula: _toPart(m.matricula),
        }));
        return cachedData;
      });
  }
  return fetchPromise;
}

function ensureTimelineData() {
  if (timelineData) return Promise.resolve(timelineData);
  if (!timelinePromise) {
    timelinePromise = fetch(`${API_BASE_URL}/api/stats/timeline`)
      .then(r => r.json())
      .then(data => { timelineData = data; return data; });
  }
  return timelinePromise;
}

function ensureMatchCounts() {
  if (matchCountsData) return Promise.resolve(matchCountsData);
  if (!matchCountsPromise) {
    matchCountsPromise = fetch(`${API_BASE_URL}/api/matches/counts`)
      .then(r => r.json())
      .then(data => {
        matchCountsData = Object.fromEntries(data.map(d => [d.contributor, d.partners_count]));
        return matchCountsData;
      })
      .catch(() => { matchCountsData = {}; return matchCountsData; });
  }
  return matchCountsPromise;
}

function enrichWithMatchCounts(data) {
  if (!matchCountsData) return data;
  return data.map(d => ({ ...d, matches_count: matchCountsData[d.contributor_ID] || 0 }));
}

export function prefetchContributors() {
  ensureData().catch(() => {});
  ensureTimelineData().catch(() => {});
  ensureMatchCounts().catch(() => {});
}

export function getContributorUrlMap() {
  if (!cachedData) return {};
  const map = {};
  cachedData.forEach(d => {
    if (d._url) map[d.contributor_ID] = d._url;
    // Also map raw -matricula IDs so links from partners that still use the
    // suffixed name resolve to the correct URL.
    if (d._tree?._url)      map[d._tree.contributor_ID]      = d._tree._url;
    if (d._matricula?._url) map[d._matricula.contributor_ID] = d._matricula._url;
  });
  return map;
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export async function renderTotalsBar() {
  try {
    const data = await ensureData();
    const persons = data.reduce((s, r) => s + r.total_persons, 0);
    const families = data.reduce((s, r) => s + r.total_families, 0);
    const links = data.reduce((s, r) => s + r.total_links, 0);
    const lastUpdate = data.reduce((max, r) => r.last_modified > max ? r.last_modified : max, '');
    setEl('total-contributors', data.length.toLocaleString());
    setEl('total-persons', persons.toLocaleString());
    setEl('total-families', families.toLocaleString());
    setEl('total-all', (persons + families).toLocaleString());
    setEl('total-links', links.toLocaleString());
    setEl('total-last-update', lastUpdate);
    setEl('data-updated', lastUpdate);
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('contributor')) {
      document.getElementById('totals-bar').style.display = 'none';
    } else {
      document.getElementById('totals-bar').style.display = '';
    }
  } catch { /* silently skip if API unavailable */ }
}

function getContributorFilter() {
  return (document.getElementById('contributors-query')?.value || '').trim().toLowerCase();
}

function filterContributorData(data) {
  const q = getContributorFilter();
  if (!q) return data;
  return data.filter(d => d.contributor_ID.toLowerCase().includes(q) || d.last_modified.includes(q));
}

export async function renderContributors() {
  const urlParams = new URLSearchParams(window.location.search);
  const contributor = urlParams.get('contributor');
  const withPartner = urlParams.get('with');

  const chartsContainer = document.getElementById('charts-container');
  const surnameCloudSection = document.getElementById('surname-cloud-section');
  let tableHeader = document.getElementById('table-contributors-header');

  if (contributor) {
    if (chartsContainer) chartsContainer.style.display = 'none';
    if (surnameCloudSection) surnameCloudSection.style.display = 'none';
    if (tableHeader) tableHeader.style.display = 'none';
    await renderMatchesPage(contributor, withPartner);
    return;
  }

  document.title = t('site_title');

  if (chartsContainer) chartsContainer.style.display = 'grid';
  if (surnameCloudSection) surnameCloudSection.style.display = '';
  if (tableHeader) tableHeader.style.display = '';

  const container = document.getElementById('table-contributors');

  if (!tableHeader) {
    tableHeader = document.createElement('h2');
    tableHeader.id = 'table-contributors-header';
    tableHeader.className = 'section-heading';
    tableHeader.style.marginTop = '2rem';
    tableHeader.style.borderBottom = '1px solid var(--border)';
    tableHeader.style.paddingBottom = '5px';
    tableHeader.style.marginBottom = '10px';
    container.parentNode.insertBefore(tableHeader, container);
  }
  tableHeader.dataset.i18n = 'tab_contributors';
  tableHeader.textContent = t('tab_contributors');

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10)); // Yield to allow browser to paint the overlay
  }

  try {
    const [data, timeline, counts] = await Promise.all([
      ensureData(), ensureTimelineData(), ensureMatchCounts(),
    ]);

    renderChart(data);
    renderTimelineChart(timeline);
    const initialFiltered = enrichWithMatchCounts(filterContributorData(data));
    const tableData = initialFiltered.map(d => ({
      ...d,
      _contributor_href: toUnicodeHref({ t: 'contributors', contributor: d.contributor_ID })
    }));
    renderTable(tableData, 'table-contributors', contributorColumns, 'total', false);
    loadSurnameCloud(expandContributorNames(initialFiltered), 'surname-cloud');

    const input = document.getElementById('contributors-query');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        const q = getContributorFilter();
        const urlParams = new URLSearchParams(window.location.search);
        const activeContributor = urlParams.get('contributor');
        const withPartner = urlParams.get('with');
        const activeBase = activeContributor ? baseContributorName(activeContributor) : null;

        if (activeContributor && !withPartner && currentMatchesData && currentMatchesContributor === activeBase) {
          const filtered = q ? currentMatchesData.filter(p => p.contributor.toLowerCase().includes(q)) : currentMatchesData;
          const tableData = filtered.map(p => ({
            contributor_ID: p.contributor,
            _match_href: toUnicodeHref({ t: 'contributors', contributor: activeBase, with: p.contributor }),
            total_persons:  p.persons_count  || 0,
            total_families: p.families_count || 0,
            total:          p.total_count,
            confidence:     Math.round((p.max_confidence || 0) * 100),
          }));
          renderTable(tableData, 'matches-summary', ['contributor_ID', 'total_persons', 'total_families', 'total', 'confidence'], 'total', false);
        } else if (!activeContributor && cachedData) {
          const filtered = enrichWithMatchCounts(filterContributorData(cachedData));
          const filteredTableData = filtered.map(d => ({
            ...d,
            _contributor_href: toUnicodeHref({ t: 'contributors', contributor: d.contributor_ID })
          }));
          renderTable(filteredTableData, 'table-contributors', contributorColumns, 'total', false);
          loadSurnameCloud(expandContributorNames(filtered), 'surname-cloud');
        }
      });
    }
  } catch {
    container.innerHTML = `<p>${t('contributors_failed')}</p>`;
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}

function renderChart(data) {
  if (!window.Chart) return;

  const ctx = document.getElementById('contributorsChart')?.getContext('2d');
  if (!ctx) return;

  const sorted = [...data].sort((a, b) => b.total - a.total);
  const top10 = sorted.slice(0, 10);
  const others = sorted.slice(10);
  const othersTotal = others.reduce((sum, r) => sum + r.total, 0);

  const labels = top10.map(d => d.contributor_ID);
  const values = top10.map(d => d.total);

  if (othersTotal > 0) {
    labels.push(t('chart_others'));
    values.push(othersTotal);
  }

  if (chartInstance) {
    chartInstance.destroy();
  }

  // Vibrant, accessible colors for the chart slices
  const bgColors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#34495e', '#d35400', '#7f8c8d', '#bdc3c7'];

  chartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: t('tab_contributors'),
          font: { family: 'system-ui, -apple-system, sans-serif', size: 14, weight: '600' },
          color: '#444'
        },
        legend: {
          position: window.innerWidth > 600 ? 'right' : 'bottom',
          labels: { font: { family: 'system-ui, -apple-system, sans-serif' } }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((val / total) * 100).toFixed(1);
              return ` ${context.label}: ${val.toLocaleString()} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderTimelineChart(data) {
  if (!window.Chart) return;
  const ctx = document.getElementById('timelineChart')?.getContext('2d');
  if (!ctx) return;

  const decades = {};
  data.forEach(d => {
    const decade = Math.floor(d.year / 10) * 10;
    if (!decades[decade]) decades[decade] = { births: 0, marriages: 0, deaths: 0 };
    decades[decade].births += d.births;
    decades[decade].marriages += d.marriages;
    decades[decade].deaths += d.deaths;
  });

  // Fill any gaps so the timeline represents a continuous X-axis
  if (Object.keys(decades).length > 0) {
    const minDecade = Math.min(...Object.keys(decades).map(Number));
    const maxDecade = Math.max(...Object.keys(decades).map(Number));
    for (let i = minDecade; i <= maxDecade; i += 10) {
      if (!decades[i]) decades[i] = { births: 0, marriages: 0, deaths: 0 };
    }
  }

  const sortedKeys = Object.keys(decades).sort((a, b) => a - b);
  const labels = sortedKeys.map(d => `${d}`);
  const births = sortedKeys.map(d => decades[d].births);
  const marriages = sortedKeys.map(d => decades[d].marriages);
  const deaths = sortedKeys.map(d => decades[d].deaths);

  if (timelineChartInstance) timelineChartInstance.destroy();

  // Using Chart.js stacked feature for the timeline
  timelineChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        { label: t('chart_births'), data: births, backgroundColor: '#3498db', borderRadius: 2 },
        { label: t('chart_marriages'), data: marriages, backgroundColor: '#2ecc71', borderRadius: 2 },
        { label: t('chart_deaths'), data: deaths, backgroundColor: '#e74c3c', borderRadius: 2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 12 } },
        title: {
          display: true,
          text: t('chart_timeline'),
          font: { family: 'system-ui, -apple-system, sans-serif', size: 14, weight: '600' },
          color: '#444'
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
        x: { stacked: true, grid: { display: false } }
      }
    }
  });
}

// --- Surname Word Cloud ---

let cloudAbortControllers = {};

function downloadCloudAsSVG(cloudEl, filename) {
  const rect = cloudEl.getBoundingClientRect();
  const paddingBottom = 20;
  const svgHeight = rect.height + paddingBottom;
  const words = cloudEl.querySelectorAll('.cloud-word');
  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${svgHeight}" viewBox="0 0 ${rect.width} ${svgHeight}">`;

  let bgColor = window.getComputedStyle(document.body).backgroundColor;
  if (!bgColor || bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
    bgColor = 'white';
  }
  svgContent += `<rect width="100%" height="100%" fill="${bgColor}"/>`;

  words.forEach(w => {
    const wRect = w.getBoundingClientRect();
    const computed = window.getComputedStyle(w);
    const x = wRect.left - rect.left;
    const y = (wRect.top - rect.top) + (parseFloat(computed.fontSize) * 0.15); // Slight bump to align baseline

    const text = w.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fontFamily = computed.fontFamily.replace(/"/g, "'");
    svgContent += `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${computed.fontSize}" font-weight="${computed.fontWeight}" fill="${computed.color}" opacity="${computed.opacity}" dominant-baseline="hanging">${text}</text>`;
  });

  const rawUrl = window.location.href;
  let decodedUrl = rawUrl;
  try {
    const u = new URL(rawUrl);
    decodedUrl = u.origin + u.pathname + (u.searchParams.toString() ? '?' + toUnicodeSearch(u.searchParams) : '');
  } catch (e) {}
  const escapeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  svgContent += `<a href="${escapeXml(rawUrl)}" target="_blank" rel="noopener"><text x="${rect.width - 5}" y="${svgHeight - 5}" font-family="system-ui, -apple-system, sans-serif" font-size="10px" fill="#777" text-anchor="end">Source: ${escapeXml(decodedUrl)}</text></a>`;

  svgContent += `</svg>`;
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function populateSurnameSelect(contributorData) {
  const select = document.getElementById('surname-cloud-select');
  if (!select) return;
  // Avoid re-binding the event listener on re-renders
  if (select.dataset.bound) {
    select.innerHTML = buildSelectOptions(contributorData);
    return;
  }
  select.innerHTML = buildSelectOptions(contributorData);
  select.addEventListener('change', () => loadSurnameCloud(select.value, 'surname-cloud'));
  select.dataset.bound = '1';
}

function buildSelectOptions(contributorData) {
  const sorted = [...contributorData].sort((a, b) => a.contributor_ID.localeCompare(b.contributor_ID));
  return `<option value="">${t('chart_surnames_all')}</option>` +
    `<option disabled>──────────────</option>` +
    sorted.map(d => `<option value="${d.contributor_ID}">${d.contributor_ID}</option>`).join('');
}

async function loadSurnameCloud(contributors, targetId = 'surname-cloud') {
  const cloud = document.getElementById(targetId);
  if (!cloud) return;

  cloud.innerHTML = `<span class="cloud-placeholder">${t('chart_surnames_loading')}</span>`;

  if (cloudAbortControllers[targetId]) cloudAbortControllers[targetId].abort();
  cloudAbortControllers[targetId] = new AbortController();

  try {
    const list = Array.isArray(contributors) ? contributors : (contributors ? [contributors] : []);
    const qs = list.length ? `contributors=${list.map(encodeURIComponent).join(',')}&` : '';
    const url = `${API_BASE_URL}/api/stats/top_surnames?${qs}limit=80`;
    const res = await fetch(url, { signal: cloudAbortControllers[targetId].signal });
    const data = await res.json();

    if (!data.length) {
      cloud.innerHTML = `<span class="cloud-placeholder">${t('no_results')}</span>`;
      return;
    }

    const maxCount = Math.max(...data.map(d => d.count));
    const minCount = Math.min(...data.map(d => d.count));
    data.sort((a, b) => a.surname.localeCompare(b.surname, 'sl'));
    const range = maxCount - minCount || 1;

    // When the cloud is built from a proper subset of contributors (filtered
    // list or single-contributor view), forward that subset to the search.
    const totalCount = cachedData ? cachedData.length : 0;
    const isFiltered = list.length > 0 && (totalCount === 0 || list.length < totalCount);
    const contribParam = isFiltered ? list.join(',') : '';

    cloud.innerHTML = data.map(({ surname, count }) => {
      const ratio = (count - minCount) / range;
      const size = (0.75 + ratio * 1.75).toFixed(2);
      const opacity = (0.55 + ratio * 0.45).toFixed(2);
      return `<span class="cloud-word" style="font-size:${size}rem;opacity:${opacity}" title="${count}" data-surname="${surname}" data-contributor="${contribParam}">${surname}</span>`;
    }).join('');

    cloud.querySelectorAll('.cloud-word').forEach(el => {
      el.addEventListener('click', () => {
        const sn = el.dataset.surname;
        const contrib = el.dataset.contributor;
        const urlParams = { t: 'general', sn, ex: '1' };
        if (contrib) urlParams.c = contrib;
        window.open('?' + toUnicodeSearch(urlParams), '_blank');
      });
    });

    const section = cloud.closest('#surname-cloud-section, .surname-cloud-section');
    if (section) {
      let headerDiv = section.querySelector('.surname-cloud-header');
      if (!headerDiv) {
        let heading = section.querySelector('h3, .section-heading');
        if (!heading) {
          heading = document.createElement('h3');
          heading.className = 'section-heading';
          heading.textContent = t('section_surnames');
          section.insertBefore(heading, section.firstChild);
        }

        heading.dataset.i18n = 'section_surnames';
        heading.style.margin = '0';
        heading.style.padding = '0';
        heading.style.border = 'none';

        if (heading.parentElement && heading.parentElement.tagName === 'DIV' && heading.parentElement !== section) {
          headerDiv = heading.parentElement;
          headerDiv.classList.add('surname-cloud-header');
        } else {
          headerDiv = document.createElement('div');
          headerDiv.className = 'surname-cloud-header';
          heading.parentNode.insertBefore(headerDiv, heading);
          headerDiv.appendChild(heading);
        }
      }

        const heading = headerDiv.querySelector('h3, .section-heading');

      if (headerDiv) {
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.alignItems = 'flex-end';
        headerDiv.style.borderBottom = '1px solid var(--border)';
        headerDiv.style.paddingBottom = '5px';
        headerDiv.style.marginBottom = '10px';

          if (heading && !heading.classList.contains('collapsible-header')) {
            heading.classList.add('collapsible-header');
            heading.addEventListener('click', () => {
              const isCollapsed = heading.classList.contains('collapsed');
              Array.from(section.children).forEach(child => {
                if (child !== headerDiv) {
                  child.style.display = isCollapsed ? '' : 'none';
                }
              });
              heading.classList.toggle('collapsed', !isCollapsed);
            });
          }

          // Preserve visibility state on re-render
          const isCollapsed = heading && heading.classList.contains('collapsed');
          Array.from(section.children).forEach(child => {
            if (child !== headerDiv) child.style.display = isCollapsed ? 'none' : '';
          });

        headerDiv.querySelectorAll('.export-btn').forEach(b => b.remove());

        let controls = headerDiv.querySelector('.surname-cloud-controls');
        if (!controls) {
          controls = document.createElement('div');
          controls.className = 'surname-cloud-controls';
          controls.style.display = 'flex';
          controls.style.gap = '10px';
          controls.style.alignItems = 'center';
          headerDiv.appendChild(controls);
        }

        const select = section.querySelector('select');
        if (select && select.parentElement !== controls) {
          controls.appendChild(select);
        }

        const btnCsv = document.createElement('button');
        btnCsv.className = 'export-btn export-surnames-csv-btn';
        btnCsv.title = t('download_csv');
        btnCsv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>CSV`;

        btnCsv.addEventListener('click', () => {
          const prefix = siteConfig.filePrefix || 'sgi';
          const exportData = data.map(d => ({ surname: d.surname, total: d.count })).sort((a, b) => b.total - a.total);
          const filename = list.length === 1 ? `${prefix}-surnames-${list[0]}.csv` : `${prefix}-surnames.csv`;
          exportToCSV(exportData, ['surname', 'total'], filename);
        });

        const btnSvg = document.createElement('button');
        btnSvg.className = 'export-btn export-surnames-svg-btn';
        btnSvg.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>SVG`;

        btnSvg.addEventListener('click', () => {
          const prefix = siteConfig.filePrefix || 'sgi';
          const filename = list.length === 1 ? `${prefix}-surnames-${list[0]}.svg` : `${prefix}-surnames.svg`;
          downloadCloudAsSVG(cloud, filename);
        });

        controls.appendChild(btnCsv);
        controls.appendChild(btnSvg);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      cloud.innerHTML = `<span class="cloud-placeholder">${t('search_failed')}</span>`;
    }
  }
}

function renderContributorStats(contribData) {
  if (!contribData) return '';
  const tip = (key) => t(key).replace(/"/g, '&quot;');
  const fmt = (n) => Number(n || 0).toLocaleString();
  const tree = contribData._tree;
  const mat  = contribData._matricula;

  // Single-column grid when only one source exists (or no breakdown is interesting).
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

  // 3-value grid: Sum / Tree / Matricula.
  const metricRow = (tipKey, label, sum, treeVal, matVal) => {
    const a = ` title="${tip(tipKey)}"`;
    return `<span${a}>${label}:</span>` +
      `<strong${a}>${sum}</strong>` +
      `<strong${a}>${treeVal}</strong>` +
      `<strong${a}>${matVal}</strong>`;
  };
  const lastTree = tree.last_modified || '';
  const lastMat  = mat.last_modified  || '';
  const lastSum  = contribData.last_modified || '';

  return `<div class="contributor-stats" style="margin-bottom: 20px; font-size: 0.95rem; display: grid; grid-template-columns: max-content max-content max-content max-content; column-gap: 16px; row-gap: 4px; justify-items: end;">
    <span></span>
    <strong>${t('col_sum')}</strong>
    <strong>${t('col_tree')}</strong>
    <strong>${t('col_matricula')}</strong>
    ${metricRow('tip_total_persons',  t('col_total_persons'),  fmt(contribData.total_persons),  fmt(tree.total_persons),  fmt(mat.total_persons))}
    ${metricRow('tip_total_families', t('col_total_families'), fmt(contribData.total_families), fmt(tree.total_families), fmt(mat.total_families))}
    ${metricRow('tip_total',          t('col_total'),          fmt(contribData.total),          fmt(tree.total),          fmt(mat.total))}
    ${metricRow('tip_total_links',    t('col_total_links'),    fmt(contribData.total_links),    fmt(tree.total_links),    fmt(mat.total_links))}
    ${metricRow('tip_last_modified',  t('col_last_update'),    lastSum,                          lastTree,                  lastMat)}
  </div>`;
}

async function renderMatchesPage(contributor, withPartner) {
  window.scrollTo(0, 0);

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
    // Normalize: clicking through partner links may still use a -matricula
    // suffix; aggregate rows are keyed by the base name.
    const baseContributor = baseContributorName(contributor);
    const contribData = cachedData.find(d => d.contributor_ID === baseContributor);

    if (!contribData) {
      const safeContributor = String(contributor).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      document.title = `${t('no_results')} | ${t('site_title')}`;
      container.innerHTML = `<div class="matches-page-header">
        <h2 class="matches-page-title">${safeContributor} - ${t('col_contributor')}</h2>
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
      const partnerData = cachedData.find(d => d.contributor_ID === basePartner);
      if (!partnerData) {
        const safeContributor = String(displayName).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safePartner = String(withPartner).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        document.title = `${t('no_results')} | ${t('site_title')}`;
        container.innerHTML = `<div class="matches-page-header">
          <h2 class="matches-page-title">${safePartner} × <a href="${toUnicodeHref({ t: 'contributors', contributor: displayName })}" data-spa-nav style="color: inherit; text-decoration: none;">${safeContributor}</a> - ${t('col_matches')}</h2>
        </div>
        <p>${t('no_results')}</p>`;
        return;
      }
      document.title = `${withPartner} × ${displayName} - ${t('col_matches')} | ${t('site_title')}`;
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
        <div class="surname-cloud-header" style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px;">
          <h3 class="section-heading" data-i18n="section_surnames" style="margin: 0; padding: 0; border: none;">${t('section_surnames')}</h3>
        </div>
        <p>${t('contributor_surnames_intro')} <strong>${displayName}</strong> ${t('contributor_surnames_outro')}</p>
        <div class="surname-cloud" id="contributor-surname-cloud" data-i18n-title="chart_surnames_title"></div>
      </div>`;
    }
    if (hasMatricula) {
      cloudSectionsHtml += `<div class="surname-cloud-section" style="margin-bottom: 24px;">
        <div class="surname-cloud-header" style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-bottom: 10px;">
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
      if (hasMatricula) loadSurnameCloud([contribData._matricula.contributor_ID], 'contributor-matricula-surname-cloud');
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
      currentMatchesData = partners;
      currentMatchesContributor = displayName;
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
      _match_href: toUnicodeHref({ t: 'contributors', contributor: displayName, with: p.contributor }),
      total_persons:  p.persons_count  || 0,
      total_families: p.families_count || 0,
      total:          p.total_count,
      confidence:     Math.round((p.max_confidence || 0) * 100),
    }));

    container.innerHTML = heading +
      `<div class="matches-summary-section">
        <div class="matches-summary-header" style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-top: 2rem; margin-bottom: 10px;">
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

async function renderMatchDetail(contributor, partner, contribData, container) {
  const detailEl = container;
  if (!detailEl) return;

  const urlMap = getContributorUrlMap();
  const contribUrl = urlMap[contributor];
  const partnerUrl = urlMap[partner];

  let urlsHtml = '';
  if (contribUrl || partnerUrl) {
    urlsHtml = `<div style="margin-bottom: 20px; font-size: 0.95rem; color: #444; display: flex; flex-wrap: wrap; gap: 16px 40px;">`;
    if (partnerUrl) {
      urlsHtml += `<div>${t('more_info_about')} <strong>${partner}</strong>:<div style="margin-top: 8px;"><a href="${partnerUrl}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(partnerUrl)}</a></div></div>`;
    }
    if (contribUrl) {
      urlsHtml += `<div>${t('more_info_about')} <strong>${contributor}</strong>:<div style="margin-top: 8px;"><a href="${contribUrl}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(contribUrl)}</a></div></div>`;
    }
    urlsHtml += `</div>`;
  }

  const primaryHtml = `<strong><a href="${toUnicodeHref({ t: 'contributors', contributor: contributor })}" data-spa-nav>${contributor}</a></strong>`;
  const secondaryHtml = `<strong><a href="${toUnicodeHref({ t: 'contributors', contributor: partner })}" data-spa-nav>${partner}</a></strong>`;
  const introText = t('matches_detail_intro').replace('{0}', primaryHtml).replace('{1}', secondaryHtml);

  const baseHtml = `
    <div class="matches-page-header">
      <h2 class="matches-page-title">${partner} × <a href="${toUnicodeHref({ t: 'contributors', contributor: contributor })}" data-spa-nav style="color: inherit; text-decoration: none;">${contributor}</a> - ${t('col_matches')}</h2>
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
      family: { primary: { column: 'confidence', ascending: false }, secondary: null }
    };

    const collapseState = { person: false, family: false };

    function renderTables() {
      const byType = { person: [], family: [] };
      records.forEach(r => byType[r.record_type]?.push(r));

      const collator = new Intl.Collator('sl', { sensitivity: 'base' });
      function getMatchValue(r, col) {
        if (col === 'confidence') return r.confidence || 0;
        const val = r.record_a[col];
        if (col === 'links') {
          if (!val) return 0;
          if (Array.isArray(val)) return val.length;
          try { return JSON.parse(val).length; } catch { return 0; }
        }
        const isDateField = col === 'date_of_birth' || col === 'date_of_death' || col === 'date_of_marriage' || col === 'husband_birth' || col === 'wife_birth';
        if (isDateField) return parseDateForSort(val);
        return String(val || '').toLowerCase();
      }
      function cmp(a, b) {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return collator.compare(String(a ?? ''), String(b ?? ''));
      }

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

      for (const { key, label, fields, searchUrl, linkedFields } of typeConfig) {
        const group = byType[key];
        if (!group.length) continue;

        const state = sortState[key];

        const isDateField = f => f === 'date_of_birth' || f === 'date_of_death' || f === 'date_of_marriage' || f === 'husband_birth' || f === 'wife_birth';
        const makeCell = (rec, f) => {
          if (f === 'parents' || f === 'children' || f === 'partners') {
            const inner = formatSpecialCell(f, rec);
            return `<td>${inner || ''}</td>`;
          }
          if (f === 'links') {
            const icons = formatLinks(rec.links);
            return `<td class="link-cell">${icons || ''}</td>`;
          }
          const val = rec[f] || '';
          const safeVal = String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const cls = isDateField(f) ? ' class="col-right"' : '';
          if (val && linkedFields.has(f)) {
            const href = searchUrl(rec, f);
            if (href) return `<td${cls}><a href="${href}" data-spa-nav class="name-link">${safeVal}</a></td>`;
          }
          return `<td${cls}>${safeVal}</td>`;
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
          const aCells = fields.map(({ f }) => makeCell(r.record_a, f)).join('');
          const bCells = fields.map(({ f }) => makeCell(r.record_b, f)).join('');
          const conf = Math.round((r.confidence || 0) * 100);
          const contributorLink = `<a href="${toUnicodeHref({ t: 'contributors', contributor: contributor })}" data-spa-nav>${contributor}</a>`;
          const partnerLink = `<a href="${toUnicodeHref({ t: 'contributors', contributor: partner })}" data-spa-nav>${partner}</a>`;
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
          <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid var(--border); padding-bottom: 5px; margin-top: 1.5rem; margin-bottom: 10px;">
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

  } finally {
    // no-op, overlay is already handled cleanly by renderMatchesPage
  }
}

/** Re-renders the contributors view if it is currently active (e.g. after language change). */
export function refreshContributorsIfVisible() {
  if (document.getElementById('tab-contributors').classList.contains('active')) {
    renderContributors();
  }
}
