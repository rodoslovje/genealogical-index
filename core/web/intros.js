import { t, getIntro } from './i18n.js';
import siteConfig from '@site-config';

// Intro text shown on the empty Search / Person / Family tabs. Site-specific
// paragraphs (siteConfig.intro) plus the society logo/links and the
// cross-country "other indexes" footer.

export function renderIntros() {
  const paragraphs = getIntro().map(p =>
    p.warning
      ? `<p class="intro-warning">${p.text}</p>`
      : `<p>${p.text}</p>`
  ).join('');
  const logoImg = siteConfig.logo
    ? `<img src="${siteConfig.logo}" alt="${siteConfig.logoAlt}" class="intro-logo" />`
    : '';
  const indexLink = siteConfig.indexUrl
    ? `<a href="${siteConfig.indexUrl}" target="_blank" rel="noopener" class="intro-logo-link">
        <span class="intro-logo-name">${t('site_title')}</span>
      </a>`
    : '';
  const logo = `<div class="intro-logo-links">
    ${logoImg}
    <div class="intro-logo-text">
      <a href="${siteConfig.societyUrl}" target="_blank" rel="noopener" class="intro-logo-link">
        <span class="intro-logo-name">${t('society_name')}</span>
      </a>
      ${indexLink}
    </div>
  </div>`;

  const otherIndexesList = [
    `<span>🇸🇮 <a href="https://indeks.rodoslovje.si/" target="_blank" rel="noopener" style="font-weight: 500;">${t('country_slo')}</a></span>`,
    `<span>🇭🇷 <a href="https://indeks.rodoslovlje.hr/" target="_blank" rel="noopener" style="font-weight: 500;">${t('country_cro')}</a></span>`
  ];
  const otherIndexesHtml = `
    <div class="other-indexes" style="margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; font-size: 1.05rem;">
      <div style="font-weight: 600;">${t('other_indexes')}</div>
      <div style="display: flex; flex-wrap: wrap; gap: 1.5rem;">
        ${otherIndexesList.join('')}
      </div>
    </div>
  `;

  const html = paragraphs + logo + otherIndexesHtml;
  ['intro-general', 'intro-person', 'intro-family'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });
}

export function hideIntro(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

export function showIntros(onlyId = null) {
  ['intro-general', 'intro-person', 'intro-family'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = (!onlyId || id === onlyId) ? '' : 'none';
  });
}
