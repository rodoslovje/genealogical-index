// API base URL — configurable via SGI_API_HOST environment variable
const apiHost = import.meta.env.SGI_API_HOST || 'indeks-api.rodoslovje.si';
const cleanHost = apiHost.replace(/\/+$/, '');
export const API_BASE_URL = cleanHost.startsWith('http') ? cleanHost : `https://${cleanHost}`;

export const birthColumns = ['name', 'surname', 'parents', 'date_of_birth', 'place_of_birth', 'links', 'contributor'];
export const familyColumns = ['husband_name', 'husband_surname', 'wife_name', 'wife_surname', 'parents', 'children', 'date_of_marriage', 'place_of_marriage', 'links', 'contributor'];
export const deathColumns = ['name', 'surname', 'parents', 'date_of_death', 'place_of_death', 'links', 'contributor'];

// Columns excluded from the search form (display-only in results table)
export const DISPLAY_ONLY_COLUMNS = new Set(['links', 'parents']);

// Columns that get a paired "from / to" date range input in the search form
export const DATE_RANGE_COLUMNS = new Set(['date_of_birth', 'date_of_marriage', 'date_of_death']);
