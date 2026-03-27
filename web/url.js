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
  date_of_marriage: 'dom',
  place_of_marriage:'pom',
};

export const PARAM_MAP_REVERSE = Object.fromEntries(
  Object.entries(PARAM_MAP).map(([field, short]) => [short, field])
);

/**
 * Updates the browser URL with the given params without adding a history entry.
 * Empty/null/undefined values are omitted.
 */
export function updateURL(params) {
  const url = new URL(window.location);
  url.search = '';
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  }
  history.replaceState(null, '', url);
}
