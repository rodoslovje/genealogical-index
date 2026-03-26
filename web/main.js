// Define the base URL for the backend API
const apiHost = import.meta.env.SGI_API_HOST || 'sgi-api.renko.fyi';

// Strip trailing slashes to prevent 404 double-slash errors (e.g., https://domain.com//api/...)
const cleanHost = apiHost.replace(/\/+$/, '');
const API_BASE_URL = cleanHost.startsWith('http') ? cleanHost : `https://${cleanHost}`;

// Data column definitions for table rendering
const birthColumns = ['name', 'surname', 'date_of_birth', 'place_of_birth', 'contributor'];
const familyColumns = ['husband_name', 'husband_surname', 'wife_name', 'wife_surname', 'date_of_marriage', 'place_of_marriage', 'contributor'];

async function init() {
  const loading = document.getElementById('loading');
  loading.style.display = 'none'; // Hide loading text by default

  try {
    setupAdvancedSearchForm();
  } catch (err) {
    loading.textContent = 'Error initializing the application.';
    console.error(err);
  }
}

// Manage Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // If contributors tab is clicked, fetch and render the data
    if (btn.dataset.target === 'tab-contributors') {
      renderContributors();
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// --- General Search ---
document.getElementById('btn-general-search').addEventListener('click', async () => {
  const query = document.getElementById('general-query').value.toLowerCase().trim();
  if (!query) return;

  document.getElementById('general-results').style.display = 'block';
  document.getElementById('table-general-births').innerHTML = '<p>Searching...</p>';
  document.getElementById('table-general-families').innerHTML = '<p>Searching...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/search/general?q=${encodeURIComponent(query)}`);
    const results = await response.json();

    document.getElementById('count-general-births').textContent = results.births.length;
    document.getElementById('count-general-families').textContent = results.families.length;
    renderTable(results.births, 'table-general-births', birthColumns);
    renderTable(results.families, 'table-general-families', familyColumns);
  } catch (error) {
    console.error("Search failed:", error);
    document.getElementById('general-results').innerHTML = '<p>Search failed. Check API connection.</p>';
  }
});

// --- Advanced Search ---
function setupAdvancedSearchForm() {
  const container = document.getElementById('adv-search-controls');

  const renderFields = () => {
    const isBirth = document.getElementById('adv-search-type')?.value !== 'families'; // Default to births
    const cols = isBirth ? birthColumns : familyColumns;

    let html = `<select id="adv-search-type">
      <option value="births" ${isBirth ? 'selected' : ''}>Births</option>
      <option value="families" ${!isBirth ? 'selected' : ''}>Families</option>
    </select>`;

    cols.filter(c => c !== 'contributor').forEach(col => {
        const label = col.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        html += `<input type="text" id="adv-${col}" placeholder="${label}" />`;
    });
    html += `<button id="btn-adv-search">Search</button>`;
    container.innerHTML = html;

    document.getElementById('adv-search-type').addEventListener('change', renderFields);
    document.getElementById('btn-adv-search').addEventListener('click', performAdvancedSearch);
  };
  renderFields();
}

async function performAdvancedSearch() {
  const isBirth = document.getElementById('adv-search-type').value === 'births';
  const cols = isBirth ? birthColumns : familyColumns;

  document.getElementById('advanced-results').style.display = 'block';
  document.getElementById('table-adv-results').innerHTML = '<p>Searching...</p>';

  // Gather query criteria dynamically
  const params = new URLSearchParams();
  cols.filter(c => c !== 'contributor').forEach(c => {
    const val = document.getElementById(`adv-${c}`).value.trim();
    if (val) params.append(c, val);
  });

  if (params.toString() === '') {
    document.getElementById('table-adv-results').innerHTML = '<p>Please enter at least one search criterion.</p>';
    document.getElementById('count-adv-results').textContent = '0';
    return;
  }

  const endpoint = isBirth ? 'births' : 'families';
  try {
    const response = await fetch(`${API_BASE_URL}/api/search/advanced/${endpoint}?${params.toString()}`);
    const results = await response.json();

    document.getElementById('count-adv-results').textContent = results.length;
    renderTable(results, 'table-adv-results', cols);
  } catch (error) {
    console.error("Advanced search failed:", error);
    document.getElementById('table-adv-results').innerHTML = '<p>Search failed. Check API connection.</p>';
  }
}

// --- Table Generation Helpers ---
function renderTable(data, containerId, columns) {
  const container = document.getElementById(containerId);
  if (data.length === 0) {
    container.innerHTML = '<p>No results found.</p>';
    return;
  }

  let html = '<table><thead><tr>';
  columns.forEach(col => {
    const header = col.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    html += `<th>${header}</th>`;
  });
  html += '</tr></thead><tbody>';

  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => html += `<td>${row[col] || ''}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

async function renderContributors() {
  const container = document.getElementById('table-contributors');
  container.innerHTML = '<p>Loading contributors...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/contributors/`);
    const metadata = await response.json();

    const dataForTable = metadata.map(m => ({
      contributor_ID: m.name,
      total_births: m.births_count,
      total_families: m.families_count,
      last_modified: new Date(m.last_modified).toLocaleString()
    }));
    renderTable(dataForTable, 'table-contributors', ['contributor_ID', 'total_births', 'total_families', 'last_modified']);
  } catch (error) {
    container.innerHTML = '<p>Could not load contributor data.</p>';
  }
}

init();