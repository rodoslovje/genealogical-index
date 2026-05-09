import siteConfig from '@site-config';

const apiHost = siteConfig.apiHost;
const cleanHost = apiHost.replace(/\/+$/, '');
export const API_BASE_URL = cleanHost.startsWith('http') ? cleanHost : `https://${cleanHost}`;

export const personColumns = ['name', 'surname', 'parents', 'partners',
  'date_of_birth', 'place_of_birth', 'date_of_death', 'place_of_death',
  'links', 'contributor'];
export const familyColumns = ['husband_name', 'husband_surname', 'wife_name', 'wife_surname',
  'parents', 'date_of_marriage', 'place_of_marriage', 'children',
  'links', 'contributor'];

// Columns excluded from the search form (display-only in results table)
export const DISPLAY_ONLY_COLUMNS = new Set(['links', 'parents', 'partners']);

// Columns that get a paired "from / to" date range input in the search form
export const DATE_RANGE_COLUMNS = new Set(['date_of_birth', 'date_of_marriage', 'date_of_death']);
