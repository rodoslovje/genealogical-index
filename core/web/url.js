/**
 * Short URL parameter names mapped from API field names.
 * Keeps shared URLs compact.
 */
export const PARAM_MAP = {
  name:             'n',
  surname:          'sn',
  date_of_birth:    'dob',
  place_of_birth:   'pob',
  husband_name:     'hn',
  husband_surname:  'hsn',
  wife_name:        'wn',
  wife_surname:     'wsn',
  children:         'ch',
  date_of_marriage: 'dom',
  place_of_marriage:'pom',
  contributor:          'c',
  has_link:             'hl',
  date_of_birth_to:     'dobt',
  date_of_marriage_to:  'domt',
  date_of_death:        'dod',
  date_of_death_to:     'dodt',
  place_of_death:       'pod',
  place:            'p',
  date_from:        'df',
  date_to:          'dt',
  husband_birth:    'hb',
  husband_birth_to: 'hbt',
  wife_birth:       'wb',
  wife_birth_to:    'wbt',
  // Contributors / matches view: which contributor is active and who they're
  // being compared with; `filter` is the per-view filter input.
  with:             'w',
  filter:           'f',
};

/** Map legacy `t=` values to their new tab. Old shared URLs (birth/death) point at the unified person tab. */
export const LEGACY_TAB_MAP = {
  birth: 'person',
  death: 'person',
};

export const PARAM_MAP_REVERSE = Object.fromEntries(
  Object.entries(PARAM_MAP).map(([field, short]) => [short, field])
);

/** Current URLSearchParams from the browser address bar. */
export function currentParams() {
  return new URLSearchParams(window.location.search);
}

/** Read a param using both the short (PARAM_MAP) and long key forms. */
export function getParam(params, longKey) {
  const short = PARAM_MAP[longKey];
  return (short && params.get(short)) || params.get(longKey) || null;
}

function buildURL(params) {
  const url = new URL(window.location);
  url.search = '';
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  }
  return url;
}

export function toUnicodeSearch(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const str = p.toString().replace(/\+/g, ' ');
  return str.replace(/%[0-9A-F]{2}(?:%[0-9A-F]{2})*/ig, match => {
    try {
      const decoded = decodeURIComponent(match);
      if (/[&+=?#%]/.test(decoded)) return match;
      return decoded;
    } catch (e) {
      return match;
    }
  });
}

export function toUnicodeHref(params) {
  const str = toUnicodeSearch(params);
  return '?' + str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * Updates the browser URL with the given params without adding a history entry.
 * Empty/null/undefined values are omitted.
 */
export function updateURL(params) {
  const url = buildURL(params);
  const search = toUnicodeSearch(url.searchParams);
  history.replaceState(null, '', url.pathname + (search ? '?' + search : ''));
}

/**
 * Pushes a new history entry with the given params.
 * Use this when a user-initiated search is performed.
 */
export function pushURL(params) {
  const url = buildURL(params);
  const search = toUnicodeSearch(url.searchParams);
  history.pushState(null, '', url.pathname + (search ? '?' + search : ''));
}
