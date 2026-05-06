import { t } from './i18n.js';
import { renderTable } from './table.js';
import { API_BASE_URL } from './config.js';

const contributorColumns = ['contributor_ID', 'total_births', 'total_families', 'total_deaths', 'total', 'total_links', 'last_modified', 'matches'];
let cachedData = null;
let fetchPromise = null;
let chartInstance = null;

let timelineData = null;
let timelinePromise = null;
let timelineChartInstance = null;

let matchCountsData = null;
let matchCountsPromise = null;

function ensureData() {
  if (cachedData) return Promise.resolve(cachedData);
  if (!fetchPromise) {
    fetchPromise = fetch(`${API_BASE_URL}/api/contributors/`)
      .then(r => r.json())
      .then(metadata => {
        cachedData = metadata.map(m => ({
          contributor_ID: m.name,
          total_births: m.births_count,
          total_families: m.families_count,
          total_deaths: m.deaths_count || 0,
          total: m.births_count + m.families_count + (m.deaths_count || 0),
          total_links: m.links_count || 0,
          last_modified: m.last_modified ? m.last_modified.slice(0, 10) : '',
          _url: m.url || '',
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
  return Object.fromEntries(
    cachedData.filter(d => d._url).map(d => [d.contributor_ID, d._url])
  );
}

function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

export async function renderTotalsBar() {
  try {
    const data = await ensureData();
    const births = data.reduce((s, r) => s + r.total_births, 0);
    const families = data.reduce((s, r) => s + r.total_families, 0);
    const deaths = data.reduce((s, r) => s + r.total_deaths, 0);
    const links = data.reduce((s, r) => s + r.total_links, 0);
    const lastUpdate = data.reduce((max, r) => r.last_modified > max ? r.last_modified : max, '');
    setEl('total-contributors', data.length.toLocaleString());
    setEl('total-births', births.toLocaleString());
    setEl('total-families', families.toLocaleString());
    setEl('total-deaths', deaths.toLocaleString());
    setEl('total-all', (births + families + deaths).toLocaleString());
    setEl('total-links', links.toLocaleString());
    setEl('total-last-update', lastUpdate);
    setEl('data-updated', lastUpdate);
    document.getElementById('totals-bar').style.display = '';
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
  const matchesFor = urlParams.get('matches');
  const withPartner = urlParams.get('with');

  const chartsContainer = document.getElementById('charts-container');
  const surnameCloudSection = document.getElementById('surname-cloud-section');

  if (matchesFor) {
    if (chartsContainer) chartsContainer.style.display = 'none';
    if (surnameCloudSection) surnameCloudSection.style.display = 'none';
    await renderMatchesPage(matchesFor, withPartner);
    return;
  }

  if (chartsContainer) chartsContainer.style.display = 'grid';
  if (surnameCloudSection) surnameCloudSection.style.display = '';

  const container = document.getElementById('table-contributors');
  container.innerHTML = `<p>${t('loading_contributors')}</p>`;

  try {
    const [data, timeline, counts] = await Promise.all([
      ensureData(), ensureTimelineData(), ensureMatchCounts(),
    ]);

    renderChart(data);
    renderTimelineChart(timeline);
    const initialFiltered = enrichWithMatchCounts(filterContributorData(data));
    renderTable(initialFiltered, 'table-contributors', contributorColumns, 'total', false);
    loadSurnameCloud(initialFiltered.map(d => d.contributor_ID));

    const input = document.getElementById('contributors-query');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        if (cachedData) {
          const filtered = enrichWithMatchCounts(filterContributorData(cachedData));
          renderTable(filtered, 'table-contributors', contributorColumns, 'total', false);
          loadSurnameCloud(filtered.map(d => d.contributor_ID));
        }
      });
    }
  } catch {
    container.innerHTML = `<p>${t('contributors_failed')}</p>`;
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
        { label: t('results_births'), data: births, backgroundColor: '#3498db', borderRadius: 2 },
        { label: t('results_families'), data: marriages, backgroundColor: '#2ecc71', borderRadius: 2 },
        { label: t('results_deaths'), data: deaths, backgroundColor: '#e74c3c', borderRadius: 2 }
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

let cloudAbortController = null;

function populateSurnameSelect(contributorData) {
  const select = document.getElementById('surname-cloud-select');
  if (!select) return;
  // Avoid re-binding the event listener on re-renders
  if (select.dataset.bound) {
    select.innerHTML = buildSelectOptions(contributorData);
    return;
  }
  select.innerHTML = buildSelectOptions(contributorData);
  select.addEventListener('change', () => loadSurnameCloud(select.value));
  select.dataset.bound = '1';
}

function buildSelectOptions(contributorData) {
  const sorted = [...contributorData].sort((a, b) => a.contributor_ID.localeCompare(b.contributor_ID));
  return `<option value="">${t('chart_surnames_all')}</option>` +
    `<option disabled>──────────────</option>` +
    sorted.map(d => `<option value="${d.contributor_ID}">${d.contributor_ID}</option>`).join('');
}

async function loadSurnameCloud(contributors) {
  const cloud = document.getElementById('surname-cloud');
  if (!cloud) return;

  cloud.innerHTML = `<span class="cloud-placeholder">${t('chart_surnames_loading')}</span>`;

  if (cloudAbortController) cloudAbortController.abort();
  cloudAbortController = new AbortController();

  try {
    const list = Array.isArray(contributors) ? contributors : (contributors ? [contributors] : []);
    const qs = list.length ? `contributors=${list.map(encodeURIComponent).join(',')}&` : '';
    const url = `${API_BASE_URL}/api/stats/top_surnames?${qs}limit=80`;
    const res = await fetch(url, { signal: cloudAbortController.signal });
    const data = await res.json();

    if (!data.length) {
      cloud.innerHTML = `<span class="cloud-placeholder">${t('no_results')}</span>`;
      return;
    }

    const maxCount = Math.max(...data.map(d => d.count));
    const minCount = Math.min(...data.map(d => d.count));
    data.sort((a, b) => a.surname.localeCompare(b.surname, 'sl'));
    const range = maxCount - minCount || 1;

    cloud.innerHTML = data.map(({ surname, count }) => {
      const ratio = (count - minCount) / range;
      const size = (0.75 + ratio * 1.75).toFixed(2);
      const opacity = (0.55 + ratio * 0.45).toFixed(2);
      const singleContrib = list.length === 1 ? list[0] : '';
      return `<span class="cloud-word" style="font-size:${size}rem;opacity:${opacity}" title="${count}" data-surname="${surname}" data-contributor="${singleContrib}">${surname}</span>`;
    }).join('');

    cloud.querySelectorAll('.cloud-word').forEach(el => {
      el.addEventListener('click', () => {
        const sn = el.dataset.surname;
        const contrib = el.dataset.contributor;
        const urlParams = { t: 'general', sn, ex: '1' };
        if (contrib) urlParams.c = contrib;
        window.open('?' + new URLSearchParams(urlParams).toString(), '_blank');
      });
    });
  } catch (err) {
    if (err.name !== 'AbortError') {
      cloud.innerHTML = `<span class="cloud-placeholder">${t('search_failed')}</span>`;
    }
  }
}

async function renderMatchesPage(contributor, withPartner) {
  // Close sidebar — not useful on the matches subpage
  document.getElementById('sidebar')?.classList.remove('open');

  const container = document.getElementById('table-contributors');
  container.innerHTML = `<p>${t('matches_loading')}</p>`;

  let partners;
  try {
    const res = await fetch(`${API_BASE_URL}/api/contributors/${encodeURIComponent(contributor)}/matches`);
    partners = await res.json();
  } catch {
    container.innerHTML = `<p>${t('search_failed')}</p>`;
    return;
  }

  const heading = `<div class="matches-page-header">
    <a href="?t=contributors" data-spa-nav class="matches-back-link">← ${t('back_to_genealogists')}</a>
    <h2 class="matches-page-title">${t('matches_for')} <em>${contributor}</em></h2>
  </div>`;

  if (!partners.length) {
    container.innerHTML = heading + `<p>${t('matches_none')}</p>`;
    return;
  }

  // Map to renderTable row format
  const tableData = partners.map(p => ({
    contributor_ID: p.contributor,
    _match_href: `?t=contributors&matches=${encodeURIComponent(contributor)}&with=${encodeURIComponent(p.contributor)}`,
    total_births:   p.births_count   || 0,
    total_families: p.families_count || 0,
    total_deaths:   p.deaths_count   || 0,
    total:          p.total_count,
    confidence:     Math.round((p.max_confidence || 0) * 100),
  }));

  container.innerHTML = heading +
    '<div id="matches-summary" class="table-responsive"></div>' +
    '<div id="matches-detail"></div>';

  renderTable(tableData, 'matches-summary',
    ['contributor_ID', 'total_births', 'total_families', 'total_deaths', 'total', 'confidence'],
    'total', false);

  // Highlight the active partner row
  if (withPartner) {
    document.querySelectorAll('#matches-summary tbody tr').forEach(tr => {
      const link = tr.querySelector('a[data-spa-nav]');
      if (link && new URL(link.href, location.href).searchParams.get('with') === withPartner) {
        tr.classList.add('matches-active-row');
      }
    });
    renderMatchDetail(contributor, withPartner);
  }
}

async function renderMatchDetail(contributor, partner) {
  const detailEl = document.getElementById('matches-detail');
  if (!detailEl) return;
  detailEl.innerHTML = `<p>${t('matches_loading')}</p>`;

  let records;
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/contributors/${encodeURIComponent(contributor)}/matches/${encodeURIComponent(partner)}`
    );
    records = await res.json();
  } catch {
    detailEl.innerHTML = `<p>${t('search_failed')}</p>`;
    return;
  }

  if (!records.length) {
    detailEl.innerHTML = `<p>${t('matches_none')}</p>`;
    return;
  }

  const byType = { birth: [], family: [], death: [] };
  records.forEach(r => byType[r.record_type]?.push(r));

  const buildSearchUrl = (tab, pairs) => {
    const p = new URLSearchParams({ t: tab, ex: '1' });
    pairs.forEach(([key, val]) => { if (val) p.set(key, val); });
    return '?' + p.toString();
  };

  const typeConfig = [
    {
      key: 'birth', label: t('matches_births'),
      fields: [
        { f: 'name',    h: t('col_name') },
        { f: 'surname', h: t('col_surname') },
        { f: 'date',    h: t('col_date_of_birth') },
        { f: 'place',   h: t('col_place_of_birth') },
      ],
      searchUrl: rec => buildSearchUrl('birth', [['n', rec.name], ['sn', rec.surname]]),
      linkedFields: new Set(['name', 'surname']),
    },
    {
      key: 'family', label: t('matches_families'),
      fields: [
        { f: 'husband_name',    h: t('col_husband_name') },
        { f: 'husband_surname', h: t('col_husband_surname') },
        { f: 'wife_name',       h: t('col_wife_name') },
        { f: 'wife_surname',    h: t('col_wife_surname') },
        { f: 'date',            h: t('col_date_of_marriage') },
        { f: 'place',           h: t('col_place_of_marriage') },
      ],
      searchUrl: (rec, field) => {
        if (field === 'husband_name' || field === 'husband_surname')
          return buildSearchUrl('family', [['hn', rec.husband_name], ['hsn', rec.husband_surname]]);
        if (field === 'wife_name' || field === 'wife_surname')
          return buildSearchUrl('family', [['wn', rec.wife_name], ['wsn', rec.wife_surname]]);
        return null;
      },
      linkedFields: new Set(['husband_name', 'husband_surname', 'wife_name', 'wife_surname']),
    },
    {
      key: 'death', label: t('matches_deaths'),
      fields: [
        { f: 'name',    h: t('col_name') },
        { f: 'surname', h: t('col_surname') },
        { f: 'date',    h: t('col_date_of_death') },
        { f: 'place',   h: t('col_place_of_death') },
      ],
      searchUrl: rec => buildSearchUrl('death', [['n', rec.name], ['sn', rec.surname]]),
      linkedFields: new Set(['name', 'surname']),
    },
  ];

  let html = `<div class="matches-detail-section">
    <h3 class="matches-detail-heading">${contributor} × ${partner}</h3>`;

  for (const { key, label, fields, searchUrl, linkedFields } of typeConfig) {
    const group = byType[key];
    if (!group.length) continue;

    const makeCell = (rec, f) => {
      const val = rec[f] || '';
      const cls = f === 'date' ? ' class="col-right"' : '';
      if (val && linkedFields.has(f)) {
        const href = searchUrl(rec, f);
        if (href) return `<td${cls}><a href="${href}" data-spa-nav class="name-link">${val}</a></td>`;
      }
      return `<td${cls}>${val}</td>`;
    };

    const headerCells = fields.map(({ h, f }) => {
      const cls = f === 'date' ? ' class="col-right"' : '';
      return `<th${cls}>${h}</th>`;
    }).join('');
    const groupRows = group.map((r, idx) => {
      const pairCls = idx % 2 === 0 ? 'match-pair-even' : 'match-pair-odd';
      const aCells = fields.map(({ f }) => makeCell(r.record_a, f)).join('');
      const bCells = fields.map(({ f }) => makeCell(r.record_b, f)).join('');
      const conf = Math.round((r.confidence || 0) * 100);
      return `<tr class="match-pair-row ${pairCls}">
                ${aCells}
                <td class="match-pair-label match-pair-label-a col-center">${contributor}</td>
                <td rowspan="2" class="match-conf col-center">${conf}%</td>
              </tr>
              <tr class="match-pair-row ${pairCls}">
                ${bCells}
                <td class="match-pair-label match-pair-label-b col-center">${partner}</td>
              </tr>`;
    }).join('');

    html += `<h4>${label} (${group.length})</h4>
    <div class="table-responsive">
      <table class="matches-detail-table">
        <thead><tr>
          ${headerCells}
          <th class="col-center">${t('col_contributor_ID')}</th>
          <th class="col-center">${t('col_confidence')}</th>
        </tr></thead>
        <tbody>${groupRows}</tbody>
      </table>
    </div>`;
  }

  html += '</div>';
  detailEl.innerHTML = html;
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Re-renders the contributors view if it is currently active (e.g. after language change). */
export function refreshContributorsIfVisible() {
  if (document.getElementById('tab-contributors').classList.contains('active')) {
    renderContributors();
  }
}
