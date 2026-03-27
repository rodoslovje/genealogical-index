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
    // Render initial search form into sidebar
    setupAdvancedSearchForm();
    // Ensure sidebar is visible on desktop, or hidden on mobile
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.add('open');

    // Activate the general search tab by default on load
    document.querySelector('.tab-btn[data-target="tab-general"]').click();
  } catch (err) {
    loading.textContent = 'Error initializing the application.';
    console.error(err);
  }
}

// --- Top Navigation & Tab Management ---
const hamburgerBtn = document.querySelector('.hamburger-btn');
const sidebar = document.getElementById('sidebar');

hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.target;

    // If contributors tab is clicked, fetch and render the data
    // Also, add a class to the body to adjust the layout for a full-width view.
    if (targetTab === 'tab-contributors') {
      document.body.classList.add('contributors-view');
      renderContributors();
    } else {
      document.body.classList.remove('contributors-view');
    }

    // Clear previous search results when switching tabs
    document.getElementById('general-results').style.display = 'none';
    document.getElementById('advanced-results').style.display = 'none';

    // Close mobile nav if open
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) { // Only close on mobile
      sidebar.classList.remove('open');
    }

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Manage sidebar sections visibility
    document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));
    if (targetTab === 'tab-general') {
      document.getElementById('general-search-sidebar').classList.add('active');
    } else if (targetTab === 'tab-advanced') {
      document.getElementById('advanced-search-sidebar').classList.add('active');
    }

    // Add active class to all buttons representing this tab (both header and sidebar)
    document.querySelectorAll(`.tab-btn[data-target="${targetTab}"]`).forEach(b => b.classList.add('active'));
    document.getElementById(targetTab).classList.add('active');
  });
});

function handleSearchOnEnter(event) {
  if (event.key === 'Enter' && event.target.value.trim() !== '') {
    // Find the button within the same search-box and click it
    const searchButton = event.target.closest('.search-box').querySelector('button');
    if (searchButton) {
      searchButton.click();
    }
  }
}

// --- General Search ---
document.getElementById('btn-general-search').addEventListener('click', async () => {
  const query = document.getElementById('general-query').value.trim();
  if (!query) return;

  document.getElementById('general-results').style.display = 'block';
  document.getElementById('table-general-births').innerHTML = '<p>Searching...</p>';
  document.getElementById('table-general-families').innerHTML = '<p>Searching...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/search/general?q=${encodeURIComponent(query)}`);
    const results = await response.json();

    document.getElementById('count-general-births').textContent = results.births.length;
    document.getElementById('count-general-families').textContent = results.families.length;
    renderTable(results.births, 'table-general-births', birthColumns, 'surname', true);
    renderTable(results.families, 'table-general-families', familyColumns, 'husband_surname', true);
  } catch (error) {
    console.error("Search failed:", error);
    document.getElementById('general-results').innerHTML = '<p>Search failed. Check API connection.</p>';
  }
});
document.getElementById('general-query').addEventListener('keydown', handleSearchOnEnter);


// --- Advanced Search ---
function setupAdvancedSearchForm() { // This now renders into #advanced-search-sidebar
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
    container.querySelectorAll('input[type="text"]').forEach(input => {
      input.addEventListener('keydown', handleSearchOnEnter);
    });
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
    renderTable(results, 'table-adv-results', cols, isBirth ? 'surname' : 'husband_surname', true);
  } catch (error) {
    console.error("Advanced search failed:", error);
    document.getElementById('table-adv-results').innerHTML = '<p>Search failed. Check API connection.</p>';
  }
}

// --- Data Parsing Helpers ---
function parseDateForSort(dateStr) {
  if (!dateStr) return 0;
  let str = String(dateStr).toLowerCase();

  // Strip common genealogical modifiers
  str = str.replace(/(abt\.?|about|bef\.?|before|aft\.?|after|cal|est\.?)\s*/g, '').trim();

  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  let year = 0, month = 0, day = 0;

  // Extract year (4 digits)
  const yearMatch = str.match(/\b(\d{4})\b/);
  if (yearMatch) year = parseInt(yearMatch[1], 10);

  // Extract month (3 letters)
  const monthMatch = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/);
  if (monthMatch) month = months[monthMatch[1]];

  // Extract day (1-2 digits)
  const parts = str.split(/[\s\-.\/]+/);
  for (const part of parts) {
    if (/^\d{1,2}$/.test(part) && parseInt(part, 10) <= 31) {
      day = parseInt(part, 10);
      break;
    }
  }

  // Return comparable integer format: YYYYMMDD
  return year * 10000 + month * 100 + day;
}

// --- Table Generation Helpers ---
function renderTable(data, containerId, columns, defaultSortColumn = null, defaultSortAscending = true) {
  const container = document.getElementById(containerId);
  if (data.length === 0) {
    container.innerHTML = '<p>No results found.</p>';
    return;
  }

  // Initialize or retrieve sort state, applying default if not already set
  if (!container._sortState || (container._sortState.column === null && defaultSortColumn)) {
    container._sortState = { column: defaultSortColumn, ascending: defaultSortAscending };
  }

  let html = '<table><thead><tr>';
  columns.forEach(col => {
    const header = col.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let sortIndicator = '';
    if (container._sortState.column === col) {
      sortIndicator = container._sortState.ascending ? ' ▲' : ' ▼';
    }
    html += `<th data-col="${col}" class="sortable">${header}${sortIndicator}</th>`;
  });
  html += '</tr></thead><tbody>';

  // Apply initial sort if a column is set in _sortState
  if (container._sortState.column) {
    const col = container._sortState.column;
    const asc = container._sortState.ascending ? 1 : -1;
    const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage';
    const isNumeric = ['total_births', 'total_families', 'total'].includes(col);

    data.sort((a, b) => {
      if (isGedcomDate) {
        const valA = parseDateForSort(a[col]);
        const valB = parseDateForSort(b[col]);
        if (valA < valB) return -1 * asc;
        if (valA > valB) return 1 * asc;
        return 0;
      } else if (isNumeric) {
        const valA = Number(a[col] || 0);
        const valB = Number(b[col] || 0);
        if (valA < valB) return -1 * asc;
        if (valA > valB) return 1 * asc;
        return 0;
      } else {
        const valA = String(a[col] || '').toLowerCase();
        const valB = String(b[col] || '').toLowerCase();
        if (valA < valB) return -1 * asc;
        if (valA > valB) return 1 * asc;
        return 0;
      }
    });
  }

  data.forEach(row => {
    html += '<tr>';
    columns.forEach(col => html += `<td>${row[col] || ''}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;

  // Add click event listeners for sorting
  container.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (container._sortState.column === col) {
        container._sortState.ascending = !container._sortState.ascending;
      } else {
        container._sortState.column = col;
        container._sortState.ascending = true;
      }

      const asc = container._sortState.ascending ? 1 : -1;
      const isGedcomDate = col === 'date_of_birth' || col === 'date_of_marriage';
      const isNumeric = ['total_births', 'total_families', 'total'].includes(col);

      data.sort((a, b) => {
        if (isGedcomDate) {
          const valA = parseDateForSort(a[col]);
          const valB = parseDateForSort(b[col]);
          if (valA < valB) return -1 * asc;
          if (valA > valB) return 1 * asc;
          return 0;
        } else if (isNumeric) {
          const valA = Number(a[col] || 0);
          const valB = Number(b[col] || 0);
          if (valA < valB) return -1 * asc;
          if (valA > valB) return 1 * asc;
          return 0;
        } else {
          const valA = String(a[col] || '').toLowerCase();
          const valB = String(b[col] || '').toLowerCase();
          if (valA < valB) return -1 * asc;
          if (valA > valB) return 1 * asc;
          return 0;
        }
      });

      renderTable(data, containerId, columns);
    });
  });
}

async function renderContributors() {
  const container = document.getElementById('table-contributors');
  container.innerHTML = '<p>Loading contributors...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/api/contributors/`);
    const metadata = await response.json();

    const dataForTable = metadata.map((m) => ({
      contributor_ID: m.name,
      total_births: m.births_count,
      total_families: m.families_count,
      total: m.births_count + m.families_count,
      last_modified: new Date(m.last_modified).toLocaleString(),
    }));
    const contributorColumns = ['contributor_ID', 'total_births', 'total_families', 'total', 'last_modified'];
    renderTable(dataForTable, 'table-contributors', contributorColumns, 'total', false);
  } catch (error) {
    container.innerHTML = '<p>Could not load contributor data.</p>';
  }
}

init();