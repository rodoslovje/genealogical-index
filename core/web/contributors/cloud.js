import { t } from '../i18n.js';
import { API_BASE_URL } from '../config.js';
import { exportToCSV } from '../table.js';
import { toUnicodeSearch } from '../url.js';
import { escapeHtml, downloadBlob } from '../utils.js';
import siteConfig from '@site-config';
import { getCachedData } from './data.js';

// One abort controller per target so re-renders cancel stale fetches.
const cloudAbortControllers = {};

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
    const text = escapeHtml(w.textContent);
    const fontFamily = computed.fontFamily.replace(/"/g, "'");
    svgContent += `<text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${computed.fontSize}" font-weight="${computed.fontWeight}" fill="${computed.color}" opacity="${computed.opacity}" dominant-baseline="hanging">${text}</text>`;
  });

  const rawUrl = window.location.href;
  let decodedUrl = rawUrl;
  try {
    const u = new URL(rawUrl);
    decodedUrl = u.origin + u.pathname + (u.searchParams.toString() ? '?' + toUnicodeSearch(u.searchParams) : '');
  } catch (e) {}
  svgContent += `<a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener"><text x="${rect.width - 5}" y="${svgHeight - 5}" font-family="system-ui, -apple-system, sans-serif" font-size="10px" fill="#777" text-anchor="end">Source: ${escapeHtml(decodedUrl)}</text></a>`;
  svgContent += `</svg>`;

  downloadBlob(new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8;' }), filename);
}

function buildSelectOptions(contributorData) {
  const sorted = [...contributorData].sort((a, b) => a.contributor_ID.localeCompare(b.contributor_ID));
  return `<option value="">${t('chart_surnames_all')}</option>` +
    `<option disabled>──────────────</option>` +
    sorted.map(d => `<option value="${d.contributor_ID}">${d.contributor_ID}</option>`).join('');
}

/** Populates the surname-cloud genealogist <select>. Idempotent. */
export function populateSurnameSelect(contributorData) {
  const select = document.getElementById('surname-cloud-select');
  if (!select) return;
  if (select.dataset.bound) {
    select.innerHTML = buildSelectOptions(contributorData);
    return;
  }
  select.innerHTML = buildSelectOptions(contributorData);
  select.addEventListener('change', () => loadSurnameCloud(select.value, 'surname-cloud'));
  select.dataset.bound = '1';
}

/**
 * Loads top surnames from the API and renders them as a clickable word cloud.
 * @param {string|string[]} contributors Empty/array → all data; single value → filter.
 * @param {string} targetId             DOM id of the cloud container.
 * @param {{ hideSectionIfEmpty?: boolean }} [options]
 * @returns {Promise<number>} number of surnames rendered (0 if empty/aborted)
 */
export async function loadSurnameCloud(contributors, targetId = 'surname-cloud', options = {}) {
  const cloud = document.getElementById(targetId);
  if (!cloud) return 0;

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
      if (options.hideSectionIfEmpty) {
        const section = cloud.closest('.surname-cloud-section, #surname-cloud-section');
        if (section) section.style.display = 'none';
      } else {
        cloud.innerHTML = `<span class="cloud-placeholder">${t('no_results')}</span>`;
      }
      return 0;
    }

    const maxCount = Math.max(...data.map(d => d.count));
    const minCount = Math.min(...data.map(d => d.count));
    data.sort((a, b) => a.surname.localeCompare(b.surname, 'sl'));
    const range = maxCount - minCount || 1;

    // When the cloud is built from a proper subset of contributors (filtered
    // list or single-contributor view), forward that subset to the search.
    const cached = getCachedData();
    const totalCount = cached ? cached.length : 0;
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

    decorateCloudHeader(cloud, data, list);
    return data.length;
  } catch (err) {
    if (err.name !== 'AbortError') {
      cloud.innerHTML = `<span class="cloud-placeholder">${t('search_failed')}</span>`;
    }
    return 0;
  }
}

// Builds (or refreshes) the header bar with collapse toggle, select, and
// CSV/SVG export buttons. Called after each successful cloud render.
function decorateCloudHeader(cloud, data, list) {
  const section = cloud.closest('#surname-cloud-section, .surname-cloud-section');
  if (!section) return;

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
        if (child !== headerDiv) child.style.display = isCollapsed ? '' : 'none';
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
  if (select && select.parentElement !== controls) controls.appendChild(select);

  const downloadIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
  const imageIcon    = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;

  const btnCsv = document.createElement('button');
  btnCsv.className = 'export-btn export-surnames-csv-btn';
  btnCsv.title = t('download_csv');
  btnCsv.innerHTML = `${downloadIcon}CSV`;
  btnCsv.addEventListener('click', () => {
    const prefix = siteConfig.filePrefix || 'sgi';
    const exportData = data.map(d => ({ surname: d.surname, total: d.count })).sort((a, b) => b.total - a.total);
    const filename = list.length === 1 ? `${prefix}-surnames-${list[0]}.csv` : `${prefix}-surnames.csv`;
    exportToCSV(exportData, ['surname', 'total'], filename);
  });

  const btnSvg = document.createElement('button');
  btnSvg.className = 'export-btn export-surnames-svg-btn';
  btnSvg.innerHTML = `${imageIcon}SVG`;
  btnSvg.addEventListener('click', () => {
    const prefix = siteConfig.filePrefix || 'sgi';
    const filename = list.length === 1 ? `${prefix}-surnames-${list[0]}.svg` : `${prefix}-surnames.svg`;
    downloadCloudAsSVG(cloud, filename);
  });

  controls.appendChild(btnCsv);
  controls.appendChild(btnSvg);
}
