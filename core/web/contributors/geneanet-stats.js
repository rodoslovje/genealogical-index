import { t, getCurrentLang } from '../i18n.js';
import { API_BASE_URL } from '../config.js';
import { escapeHtml, ensureLeaflet, formatExportFilename } from '../lib/utils.js';
import { csvCell, csvFooter, downloadCsv } from '../lib/csv.js';
import { setupSortableTable, buildThead, renderDoughnut, setupCollapsibleHeader } from './matricula-stats.js';
import { loadSurnameCloud } from './cloud.js';

// The single Geneanet cemeteries source contributor (NFC-normalised so it
// matches the name stored in the DB).
const GENEANET_CONTRIBUTOR = 'Pokopališča-geneanet'.normalize('NFC');

let cachedStats = null;
let fetchPromise = null;

function fetchStats() {
  if (cachedStats) return Promise.resolve(cachedStats);
  if (!fetchPromise) {
    const empty = { cemeteries: [], top_places: [], totals: {} };
    fetchPromise = fetch(`${API_BASE_URL}/api/geneanet/stats`)
      .then(r => (r.ok ? r.json() : empty))
      .then(data => { cachedStats = data; return data; })
      .catch(() => empty);
  }
  return fetchPromise;
}

const collator = new Intl.Collator('sl', { sensitivity: 'base' });
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
  ? a - b
  : collator.compare(String(a ?? ''), String(b ?? ''));

const fmt = (n) => Number(n || 0).toLocaleString();

// Geneanet location types (cimetiere / eglise / …) → localized label, falling
// back to the raw value for anything not explicitly translated.
function typeLabel(type) {
  const key = `geneanet_type_${type}`;
  const label = t(key);
  return label && label !== key ? label : escapeHtml(type || '');
}

// Map-marker fill colour per location type (legend below the map keys these).
const TYPE_COLORS = {
  cimetiere: '#2c7fb8',           // cemetery
  cimetiere_militaire: '#d7301f', // military cemetery
  eglise: '#762a83',              // church
  monument: '#e6550d',            // monument
};
const DEFAULT_TYPE_COLOR = '#636363';
const typeColor = (type) => TYPE_COLORS[type] || DEFAULT_TYPE_COLOR;

let mapInstance = null;

/** Render the cemetery locations on a CARTO/OSM basemap via Leaflet. Markers
 *  use lat/lon from the index; cemeteries without coordinates are skipped. */
async function renderMap(cemeteries) {
  const located = cemeteries.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  const mapEl = document.getElementById('geneanet-map');
  if (!mapEl || !located.length) {
    if (mapEl) mapEl.style.display = 'none';
    return;
  }
  try { await ensureLeaflet(); } catch { mapEl.style.display = 'none'; return; }
  const L = window.L;
  if (!L) { mapEl.style.display = 'none'; return; }

  // A re-render (language switch / re-nav) must drop the previous instance, or
  // Leaflet throws "Map container is already initialized".
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }

  mapInstance = L.map(mapEl, { scrollWheelZoom: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(mapInstance);

  // Radius scaled by indexed persons. sqrt keeps the *area* proportional to the
  // count (so big cemeteries don't visually dwarf everything), normalised to the
  // dataset's max and clamped to a readable pixel range.
  const maxPersons = Math.max(1, ...located.map(c => c.persons_count || 0));
  const MIN_R = 3, MAX_R = 14;
  const radiusFor = (count) =>
    MIN_R + (Math.sqrt(Math.max(0, count || 0)) / Math.sqrt(maxPersons)) * (MAX_R - MIN_R);

  const markers = located.map(c => {
    // Small circle markers (vs. the bulky default pin) coloured by location
    // type, sized by indexed-person count.
    const m = L.circleMarker([c.lat, c.lon], {
      radius: radiusFor(c.persons_count),
      color: '#fff',
      weight: 1,
      fillColor: typeColor(c.type),
      fillOpacity: 0.9,
    });
    const title = escapeHtml(c.name || c.place || '');
    const place = escapeHtml(c.place || '');
    const counts = `${t('col_persons')}: ${fmt(c.persons_count)} · ${t('col_graves')}: ${fmt(c.graves_count)}`;
    const link = c.url
      ? `<br><a href="${c.url}" target="_blank" rel="noopener">Geneanet</a>`
      : '';
    m.bindPopup(`<strong>${title}</strong><br>${typeLabel(c.type)} · ${place}<br>${counts}${link}`);
    return m;
  });
  const group = L.featureGroup(markers).addTo(mapInstance);

  // Legend keying marker colour → type, listing only the types actually present.
  const presentTypes = [...new Set(located.map(c => c.type))];
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'geneanet-map-legend');
    div.innerHTML = presentTypes
      .map(ty => `<span><i style="background:${typeColor(ty)}"></i>${escapeHtml(typeLabel(ty))}</span>`)
      .join('');
    return div;
  };
  legend.addTo(mapInstance);

  // The map lives in a CSS-grid column whose width is resolved after this JS
  // runs; recompute size so tiles/markers align before fitting the bounds.
  mapInstance.invalidateSize();
  mapInstance.fitBounds(group.getBounds().pad(0.2));
}

function renderCemeteriesSection(cemeteries) {
  const columns = [
    { f: 'place',          h: t('col_place'),         cls: ' col-center' },
    { f: 'name',           h: t('col_cemetery'),      cls: '' },
    { f: 'type',           h: t('col_book_type'),     cls: ' col-center', sortVal: (c) => typeLabel(c.type).toLowerCase() },
    { f: 'persons_count',  h: t('col_persons'),       cls: ' col-center', sortVal: (c) => Number(c.persons_count || 0), defaultDesc: true },
    { f: 'graves_count',   h: t('col_graves'),        cls: ' col-center', sortVal: (c) => Number(c.graves_count || 0),  defaultDesc: true },
  ];

  const renderRow = (c) => {
    const name = escapeHtml(c.name || '');
    const nameCell = c.url
      ? `<a href="${c.url}" target="_blank" rel="noopener">${name}</a>`
      : name;
    return `<tr>
      <td class="col-center">${escapeHtml(c.place || '')}</td>
      <td>${nameCell}</td>
      <td class="col-center">${typeLabel(c.type)}</td>
      <td class="col-center">${fmt(c.persons_count)}</td>
      <td class="col-center">${fmt(c.graves_count)}</td>
    </tr>`;
  };

  return {
    html: `<div class="matricula-stats-section" style="margin-bottom: 24px;">
      <div class="geneanet-cemeteries-header section-bar section-bar--top">
        <h3 class="section-heading" style="margin: 0; padding: 0; border: none;">${t('geneanet_section_cemeteries')} (<span id="geneanet-cemeteries-count">${fmt(cemeteries.length)}</span>)</h3>
        <button class="export-btn geneanet-cemeteries-csv-btn" title="${t('download_csv')}">CSV</button>
      </div>
      <div class="geneanet-cemeteries-content">
        <div class="table-responsive">
          <table id="geneanet-cemeteries-table">
            <thead><tr>${buildThead(columns)}</tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>`,
    setup: () => {
      let filtered = cemeteries;

      const tableApi = setupSortableTable({
        tableId: 'geneanet-cemeteries-table',
        headerSelector: '.geneanet-cemeteries-header h3',
        contentSelector: '.geneanet-cemeteries-content',
        columns, data: cemeteries,
        initialSort: { column: 'place', ascending: true },
        renderRow,
        fallbackSort: (a, b) => collator.compare(a.name || '', b.name || ''),
      });

      const applyFilters = () => {
        const query = document.getElementById('filter-geneanet-cemeteries')?.value.toLowerCase().trim() || '';
        filtered = cemeteries.filter(c => {
          if (!query) return true;
          const place = (c.place || '').toLowerCase();
          const name = (c.name || '').toLowerCase();
          const type = typeLabel(c.type).toLowerCase();
          return place.includes(query) || name.includes(query) || type.includes(query);
        });
        const countEl = document.getElementById('geneanet-cemeteries-count');
        if (countEl) countEl.textContent = fmt(filtered.length);
        if (tableApi) tableApi.updateData(filtered);
      };

      const filterInput = document.getElementById('filter-geneanet-cemeteries');
      if (filterInput) {
        filterInput.oninput = applyFilters;
        filterInput.onchange = applyFilters;
        if (filterInput.value) applyFilters();
      }

      const csvBtn = document.querySelector('.geneanet-cemeteries-csv-btn');
      if (csvBtn) {
        csvBtn.addEventListener('click', () => {
          exportCemeteriesToCSV(filtered, columns, formatExportFilename('geneanet-cemeteries', 'csv'));
        });
      }
    },
  };
}

function exportCemeteriesToCSV(rows, columns, filename) {
  if (!rows?.length) return;
  const header = columns.map(c => csvCell(c.h || '')).join(',');
  const body = rows.map(c => columns.map(col => {
    let v;
    if (col.f === 'type') v = typeLabel(c.type);
    else                  v = c[col.f] ?? '';
    return csvCell(v);
  }).join(','));
  downloadCsv([header, ...body, '', ...csvFooter()], filename);
}

/** Render the global Geneanet Cemeteries index page into the #geneanet-stats
 *  container. Loaded via `?t=geneanet` only — not exposed in the navbar. */
export async function renderGeneanetStatsPage() {
  window.scrollTo(0, 0);
  const container = document.getElementById('geneanet-stats');
  if (!container) return;

  document.title = `${t('geneanet_page_title')} | ${t('site_title')}`;

  const overlay = document.getElementById('search-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    await new Promise(r => setTimeout(r, 10));
  }

  try {
    const stats = await fetchStats();
    const cemeteries = stats.cemeteries || [];
    const places = stats.top_places || [];
    const totals = stats.totals || {};

    // Geneanet's cemetery portal is localized for de/it; everything else falls
    // back to the English entry point.
    const lang = getCurrentLang();
    const gPrefix = (lang === 'de' || lang === 'it') ? lang : 'en';
    const introHtml = t('geneanet_intro')
      .replace('{0}', 'https://rodoslovje.si/register-slovenskih-pokopalisc/')
      .replace('{1}', `https://${gPrefix}.geneanet.org/cemetery/`);

    const heading = `<div class="matches-page-header">
      <h2 class="matches-page-title">${t('geneanet_page_title')}</h2>
    </div>
    <p class="index-intro">${introHtml}</p>
    <h2 class="section-heading" id="geneanet-stats-heading">${t('section_statistics')}</h2>
    <div id="geneanet-stats-body">
      <div class="totals-bar matricula-totals-bar">
        <span><span>${t('geneanet_section_cemeteries')}</span>: <strong>${fmt(totals.cemeteries_count)}</strong></span>
        <span><span>${t('col_place')}</span>: <strong>${fmt(totals.places_count)}</strong></span>
        <span><span>${t('col_persons')}</span>: <strong>${fmt(totals.persons_count)}</strong></span>
        <span><span>${t('col_graves')}</span>: <strong>${fmt(totals.graves_count)}</strong></span>
      </div>
      <div class="charts-container matricula-charts-container">
        <div class="chart-wrapper">
          <div id="geneanet-map" class="geneanet-map"></div>
        </div>
        <div class="chart-wrapper">
          <canvas id="geneanetPlacesChart"></canvas>
        </div>
      </div>
    </div>`;

    const cloudHtml = `<div class="surname-cloud-section" id="geneanet-surname-cloud-section">
      <div class="surname-cloud" id="geneanet-surname-cloud" data-i18n-title="chart_surnames_title"></div>
    </div>`;

    const cemeteriesSection = renderCemeteriesSection(cemeteries);

    container.innerHTML = heading + cloudHtml + cemeteriesSection.html;

    renderMap(cemeteries);
    renderDoughnut('geneanetPlacesChart', places, {
      valueKey: 'persons_count',
      labelKey: 'place',
      title: t('geneanet_section_places'),
    });
    setupCollapsibleHeader('#geneanet-stats-heading', '#geneanet-stats-body');
    // Top surnames across the Geneanet cemeteries source. hideSectionIfEmpty so
    // the section disappears cleanly if the source has no surname data.
    loadSurnameCloud(GENEANET_CONTRIBUTOR, 'geneanet-surname-cloud', { hideSectionIfEmpty: true });
    cemeteriesSection.setup();
  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
