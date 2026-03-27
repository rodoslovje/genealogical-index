// API base URL — configurable via SGI_API_HOST environment variable
const apiHost = import.meta.env.SGI_API_HOST || 'sgi-api.renko.fyi';
const cleanHost = apiHost.replace(/\/+$/, '');
export const API_BASE_URL = cleanHost.startsWith('http') ? cleanHost : `https://${cleanHost}`;

export const birthColumns = ['name', 'surname', 'date_of_birth', 'place_of_birth', 'contributor'];
export const familyColumns = ['husband_name', 'husband_surname', 'wife_name', 'wife_surname', 'date_of_marriage', 'place_of_marriage', 'contributor'];
