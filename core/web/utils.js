export function isPrivate(val) {
  if (!val) return false;
  const v = String(val).toLowerCase();
  return v === 'private' || v === '<private>' || v === 'unknown';
}

const collator = new Intl.Collator('sl', { sensitivity: 'base' });

export function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a ?? ''), String(b ?? ''));
}

export function getExpandCollapseIcon(isOpen) {
  return isOpen
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
}

export function shortenUrlLabel(urlStr) {
  try {
    const u = new URL(urlStr);
    const domain = u.hostname.replace(/^www\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 1) {
      return `${domain}/${parts[0]}/...`;
    }
    return `${domain}${u.pathname !== '/' ? u.pathname : ''}`;
  } catch (e) {
    return urlStr;
  }
}