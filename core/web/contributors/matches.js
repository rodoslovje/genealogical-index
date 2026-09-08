import { t, formatTitleSuffix } from '../i18n.js';
import {
  shortenUrlLabel, baseContributorName, matriculaIndicatorHtml, geneanetIndicatorHtml, militaryIndicatorHtml, deceasedIndicatorHtml, deceasedTitleAttr, deceasedYears, escapeHtml, contributorTypeLabelKey,
} from '../lib/utils.js';
import { toUnicodeHref } from '../lib/url.js';

import { ensureData, getCachedData, getContributorUrlMap } from './data.js';
import { renderMatchDetail } from './match-detail.js';
import { buildSourcePanels, mountSourceTabs } from './source-panels.js';

/** Returns the i18n key for the contributor type label based on which data
 *  sources are present. When the contributor has exactly one special source
 *  and no tree, use its specific label (e.g. "Vojaški viri") instead of
 *  the generic "Rodoslovec". Falls back to contributorTypeLabelKey(rawName)
 *  when contribData is not available (e.g. "not found" error path). */
function contribDataTypeLabelKey(contribData, rawName) {
  if (!contribData) return contributorTypeLabelKey(rawName);
  const hasTree  = !!contribData._tree;
  const hasMat   = !!contribData._matricula;
  const hasGene  = !!contribData._geneanet;
  const hasMil   = !!contribData._military;
  const sourceCount = [hasTree, hasMat, hasGene, hasMil].filter(Boolean).length;
  if (sourceCount === 1) {
    if (hasMat)  return 'icon_matricula_index';
    if (hasGene) return 'icon_geneanet_index';
    if (hasMil)  return 'icon_military_index';
  }
  return 'col_contributor';
}

/** Renders the "In memoriam" panel for a genealogist who has passed away, or
 *  '' for everyone else. Carries their years when known, their personal page
 *  (the same `url` the plain link box would have shown) and a memorial page
 *  when one exists. */
function renderMemorial(contribData, displayName, url) {
  const marker = contribData?._deceased;
  if (!marker) return '';
  const years = deceasedYears(marker);
  // Their real name, which is the whole point of the panel — the heading above
  // still carries the short contributor key used everywhere else on the site.
  const name = escapeHtml(contribData._full_name || displayName);
  const title = years
    ? `${t('memorial_title')} — <strong>${name}</strong> (${escapeHtml(years)})`
    : `${t('memorial_title')} — <strong>${name}</strong>`;
  const links = [];
  if (url) {
    links.push(`<a href="${url}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(url)}</a>`);
  }
  const memorialUrl = contribData._memorial_url;
  if (memorialUrl) {
    links.push(`<a href="${memorialUrl}" target="_blank" rel="noopener">🕯 ${t('memorial_page')}</a>`);
  }
  const linksHtml = links.length
    ? `<div class="contributor-memorial-links">${links.join('<span class="contributor-memorial-sep">·</span>')}</div>`
    : '';
  return `<div class="contributor-memorial">
    <div class="contributor-memorial-title">${title}</div>
    <div class="contributor-memorial-note">${t('memorial_note')}</div>
    ${linksHtml}
  </div>`;
}

/** Renders the per-contributor stats grid: a single column when the
 *  contributor has one source, otherwise Total plus one column per source
 *  present (Tree / Matricula / Cemeteries / Military). */
function renderContributorStats(contribData) {
  if (!contribData) return '';
  const tip = (key) => t(key).replace(/"/g, '&quot;');
  const fmt = (n) => Number(n || 0).toLocaleString();
  const parts = [
    { part: contribData._tree,      label: t('col_tree') },
    { part: contribData._matricula, label: t('col_matricula') },
    { part: contribData._geneanet,  label: t('col_geneanet') },
    { part: contribData._military,  label: t('col_military') },
  ].filter(p => p.part);

  const divider = '<div style="grid-column: 1 / -1; border-bottom: 1px solid var(--border); margin: 2px 0;"></div>';

  // Single-column grid when only one source exists — still headed by the
  // source's name (Tree / Matricula / ...) so it reads like the multi-source
  // grid below.
  if (parts.length < 2) {
    const row = (tipKey, label, value) => {
      const a = ` title="${tip(tipKey)}"`;
      return `<span${a}>${label}:</span><strong${a}>${value}</strong>`;
    };
    const headerHtml = parts.length ? `<span></span><strong>${parts[0].label}</strong>${divider}` : '';
    return `<div class="contributor-stats" style="margin-bottom: 20px; font-size: 0.95rem; display: grid; grid-template-columns: max-content max-content; column-gap: 16px; row-gap: 4px; justify-items: end;">
      ${headerHtml}
      ${row('tip_total_persons',  t('col_total_persons'),  fmt(contribData.total_persons))}
      ${row('tip_total_families', t('col_total_families'), fmt(contribData.total_families))}
      ${row('tip_total',          t('col_total'),          fmt(contribData.total))}
      ${row('tip_total_links',    t('col_total_links'),    fmt(contribData.total_links))}
      ${row('tip_last_modified',  t('col_last_modified'),  contribData.last_modified || '')}
    </div>`;
  }

  // Multi-value grid: one column per present source, then Total.
  const metricRow = (tipKey, label, sum, values) => {
    const a = ` title="${tip(tipKey)}"`;
    return `<span${a}>${label}:</span>` +
      values.map(v => `<span${a}>${v}</span>`).join('') +
      `<strong${a}>${sum}</strong>`;
  };
  const colTemplate = Array(parts.length + 2).fill('max-content').join(' ');

  return `<div class="contributor-stats" style="margin-bottom: 20px; font-size: 0.95rem; display: grid; grid-template-columns: ${colTemplate}; column-gap: 16px; row-gap: 4px; justify-items: end;">
    <span></span>
    ${parts.map(p => `<strong>${p.label}</strong>`).join('')}
    <strong>${t('col_total')}</strong>
    ${divider}
    ${metricRow('tip_total_persons',  t('col_total_persons'),  fmt(contribData.total_persons),  parts.map(p => fmt(p.part.total_persons)))}
    ${metricRow('tip_total_families', t('col_total_families'), fmt(contribData.total_families), parts.map(p => fmt(p.part.total_families)))}
    ${metricRow('tip_total_links',    t('col_total_links'),    fmt(contribData.total_links),    parts.map(p => fmt(p.part.total_links)))}
    ${metricRow('tip_last_modified',  t('col_last_modified'),  contribData.last_modified || '', parts.map(p => p.part.last_modified || ''))}
  </div>`;
}

/** Renders either the per-contributor page or the per-pair match detail.
 *
 *  The per-contributor page is a shared header (name, stats grid, memorial /
 *  intro / link) followed by one panel per data source; with several sources
 *  a tab strip switches between them (see source-panels.js). */
export async function renderMatchesPage(contributor, withPartner) {
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
    const cached = getCachedData();
    // Normalize: clicking through partner links may still use a -matricula
    // suffix; aggregate rows are keyed by the base name.
    const baseContributor = baseContributorName(contributor);
    const contribData = cached.find(d => d.contributor_ID === baseContributor);

    if (!contribData) {
      const safeContributor = escapeHtml(baseContributor);
      const contribInd = matriculaIndicatorHtml(contributor, t('icon_matricula_index')) + geneanetIndicatorHtml(contributor, t('icon_geneanet_index')) + militaryIndicatorHtml(contributor, t('icon_military_index'));
      document.title = `${t('no_results')} | ${t('site_title')}`;
      container.innerHTML = `<div class="matches-page-header">
        <h2 class="matches-page-title">${safeContributor}${contribInd} - ${formatTitleSuffix(t(contributorTypeLabelKey(contributor)))}</h2>
      </div>
      <p>${t('no_results')}</p>`;
      return;
    }

    const displayName = baseContributor;

    if (withPartner) {
      const basePartner = baseContributorName(withPartner);
      const partnerData = cached.find(d => d.contributor_ID === basePartner);
      if (!partnerData) {
        const safePartner = escapeHtml(basePartner);
        const partnerInd  = matriculaIndicatorHtml(withPartner, t('icon_matricula_index')) + geneanetIndicatorHtml(withPartner, t('icon_geneanet_index')) + militaryIndicatorHtml(withPartner, t('icon_military_index')) + deceasedIndicatorHtml(withPartner, t('memorial_title'));
        document.title = `${t('no_results')} | ${t('site_title')}`;
        container.innerHTML = `<div class="matches-page-header">
          <h2 class="matches-page-title"><span${deceasedTitleAttr(withPartner, t('memorial_title'))}>${safePartner}</span>${partnerInd} × <a href="${toUnicodeHref({ t: 'contributors', c: displayName })}" data-spa-nav style="color: inherit; text-decoration: none;"${deceasedTitleAttr(displayName, t('memorial_title'))}>${displayName}</a> - ${formatTitleSuffix(t('col_matches'))}</h2>
        </div>
        <p>${t('no_results')}</p>`;
        return;
      }
      document.title = `${basePartner} × ${displayName} - ${formatTitleSuffix(t('col_matches'))} | ${t('site_title')}`;
      await renderMatchDetail(contributor, withPartner, contribData, container);
      return;
    }

    document.title = `${displayName} - ${formatTitleSuffix(t(contribDataTypeLabelKey(contribData, contributor)))} | ${t('site_title')}`;

    const urlMap = getContributorUrlMap();
    const url = urlMap[displayName] || (contribData._tree?._url) || (contribData._geneanet?._url) || (contribData._matricula?._url);
    // A deceased genealogist gets an "In memoriam" panel instead of the plain
    // link box — their personal page and any memorial page move inside it, so
    // the page never shows two separate link blocks.
    const memorialHtml = renderMemorial(contribData, displayName, url);
    const urlHtml = (url && !memorialHtml) ? `<div style="margin-bottom: 20px; font-size: 0.95rem; color: #444;">${t('more_info_about')} <strong>${displayName}</strong>:<div style="margin-top: 8px;"><a href="${url}" target="_blank" rel="noopener">🔗 ${shortenUrlLabel(url)}</a></div></div>` : '';
    const introHtml = contribData._intro ? `<div class="contributor-intro" style="margin-bottom: 20px; font-size: 0.95rem; line-height: 1.6;">${contribData._intro}</div>` : '';

    container.innerHTML = `<div class="matches-page-header">
      <h2 class="matches-page-title"><span${deceasedTitleAttr(displayName, t('memorial_title'))}>${displayName}</span>${deceasedIndicatorHtml(displayName, t('memorial_title'))} - ${formatTitleSuffix(t(contribDataTypeLabelKey(contribData, contributor)))}</h2>
    </div>
    ${renderContributorStats(contribData)}
    ${memorialHtml}
    ${introHtml}
    ${urlHtml}`;

    const { panels, defaultKey } = await buildSourcePanels({ contribData, displayName, overlay });
    await mountSourceTabs({ container, panels, defaultKey, cachedList: cached, overlay });

  } finally {
    if (overlay) overlay.style.display = 'none';
  }
}
