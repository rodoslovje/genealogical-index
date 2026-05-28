import { t, getCurrentLang } from './i18n.js';

function parseLinksList(links) {
  if (!links) return [];
  if (Array.isArray(links)) return links;
  try {
    const parsed = JSON.parse(links);
    return Array.isArray(parsed) ? parsed : [links];
  } catch(e) { return [links]; }
}

// Matricula URLs only differ by their UI-language segment (the first path
// component: /de/, /en/, /sl/, …) when the underlying record is the same —
// strip it for cross-contributor diffing.
const MATRICULA_LANG_RE = /^(https?:\/\/[^/]+)\/[a-z]{2}\//;
function diffKey(url) {
  return url.includes('matricula-online.eu')
    ? url.replace(MATRICULA_LANG_RE, '$1/')
    : url;
}

export function formatLinks(links, diffAgainst) {
  const linksList = parseLinksList(links);
  if (!linksList.length) return '';

  const otherSet = diffAgainst !== undefined
    ? new Set(parseLinksList(diffAgainst).map(diffKey))
    : null;

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
      ? url.replace(MATRICULA_LANG_RE, `$1/${getCurrentLang()}/`)
      : url;
    const anchor = `<a href="${href}" target="_blank" rel="noopener" title="${titleText}">${icon}</a>`;
    if (otherSet && !otherSet.has(diffKey(url))) {
      return `<span class="match-diff">${anchor}</span>`;
    }
    return anchor;
  }).join(' ');
}