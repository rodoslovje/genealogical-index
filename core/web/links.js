import { t, getCurrentLang } from './i18n.js';

export function formatLinks(links) {
  let linksList = [];
  if (links) {
    if (Array.isArray(links)) {
      linksList = links;
    } else {
      try { linksList = JSON.parse(links); } catch(e) { linksList = [links]; }
    }
  }
  if (!linksList.length) return '';

  return linksList.map(url => {
    let icon = '📜';
    let titleText = t('icon_matricula');

    if (url.includes('familysearch.org')) {
      icon = '🌳';
      titleText = t('icon_familysearch');
    } else if (url.includes('geneanet.org') || url.includes('findagrave.com') || url.includes('billiongraves.com')) {
      icon = '🪦';
      titleText = t('icon_grave');
    } else if (url.includes('sistory.si/ww')) {
      icon = '🎖︎';
      titleText = t('icon_military');
    } else if (url.includes('sistory.si') && url.includes('popisi')) {
      icon = '📋';
      titleText = t('icon_census');
    } else if (url.includes('dlib.si')) {
      icon = '📰';
      titleText = t('icon_dlib');
    }

    try {
      const domain = new URL(url).hostname.replace(/^www\./, '');
      titleText = `${titleText} - ${domain}`;
    } catch (e) {}

    const href = url.includes('matricula-online.eu')
      ? url.replace(/\/(en|sl)\//, `/${getCurrentLang()}/`)
      : url;
    return `<a href="${href}" target="_blank" rel="noopener" title="${titleText}">${icon}</a>`;
  }).join(' ');
}