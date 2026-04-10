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
};

export const PARAM_MAP_REVERSE = Object.fromEntries(
  Object.entries(PARAM_MAP).map(([field, short]) => [short, field])
);

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

/**
 * Updates the browser URL with the given params without adding a history entry.
 * Empty/null/undefined values are omitted.
 */
export function updateURL(params) {
  history.replaceState(null, '', buildURL(params));
}

/**
 * Pushes a new history entry with the given params.
 * Use this when a user-initiated search is performed.
 */
export function pushURL(params) {
  history.pushState(null, '', buildURL(params));
}
