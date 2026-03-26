const db = { births: [], families: [], metadata: [] };

// Data column definitions for table rendering
const birthColumns = ['name', 'surname', 'date_of_birth', 'place_of_birth', 'contributor'];
const familyColumns = ['husband_name', 'husband_surname', 'wife_name', 'wife_surname', 'date_of_marriage', 'place_of_marriage', 'contributor'];

async function init() {
  const loading = document.getElementById('loading');
  try {
    const metaRes = await fetch('/data/metadata.json');
    if (!metaRes.ok) throw new Error('metadata.json not found');
    db.metadata = await metaRes.json();

    // Fetch all datasets dynamically based on metadata contents
    const birthPromises = db.metadata.map(m =>
      fetch(`/data/${m.contributor}-births.json`)
        .then(res => res.ok ? res.json() : [])
        .then(data => data.map(d => ({ ...d, contributor: m.contributor })))
    );

    const familyPromises = db.metadata.map(m =>
      fetch(`/data/${m.contributor}-families.json`)
        .then(res => res.ok ? res.json() : [])
        .then(data => data.map(d => ({ ...d, contributor: m.contributor })))
    );

    const birthsArrays = await Promise.all(birthPromises);
    const familiesArrays = await Promise.all(familyPromises);

    db.births = birthsArrays.flat();
    db.families = familiesArrays.flat();

    renderContributors();
    setupAdvancedSearchForm();
    loading.style.display = 'none';

  } catch (err) {
    loading.textContent = 'Error loading data. Make sure to run gedcom-to-json.py to build metadata.json!';
    console.error(err);
  }
}

// Manage Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');
  });
});

// --- General Search ---
document.getElementById('btn-general-search').addEventListener('click', () => {
  const query = document.getElementById('general-query').value.toLowerCase().trim();
  document.getElementById('general-results').style.display = 'block';

  const bRes = db.births.filter(b => Object.values(b).some(v => String(v).toLowerCase().includes(query)));
  const fRes = db.families.filter(f => Object.values(f).some(v => String(v).toLowerCase().includes(query)));

  document.getElementById('count-general-births').textContent = bRes.length;
  document.getElementById('count-general-families').textContent = fRes.length;

  renderTable(bRes, 'table-general-births', birthColumns);
  renderTable(fRes, 'table-general-families', familyColumns);
});

// --- Advanced Search ---
function setupAdvancedSearchForm() {
  const container = document.getElementById('adv-search-controls');

  const renderFields = () => {
    const isBirth = document.getElementById('adv-search-type')?.value !== 'families';
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

function performAdvancedSearch() {
  const isBirth = document.getElementById('adv-search-type').value === 'births';
  const cols = isBirth ? birthColumns : familyColumns;
  const dataset = isBirth ? db.births : db.families;
  document.getElementById('advanced-results').style.display = 'block';

  // Gather query criteria
  const criteria = {};
  cols.filter(c => c !== 'contributor').forEach(c => {
    criteria[c] = document.getElementById(`adv-${c}`).value.toLowerCase().trim();
  });

  // Filter based on all filled criteria fields
  const results = dataset.filter(record => {
    return Object.entries(criteria).every(([key, query]) => {
      if (!query) return true; // ignore empty search boxes
      return (record[key] || '').toLowerCase().includes(query);
    });
  });

  document.getElementById('count-adv-results').textContent = results.length;
  renderTable(results, 'table-adv-results', cols);
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

function renderContributors() {
  const container = document.getElementById('table-contributors');
  if (db.metadata.length === 0) return;

  const dataForTable = db.metadata.map(m => ({
    contributor_ID: m.contributor,
    total_births: m.births_count,
    total_families: m.families_count,
    last_modified: new Date(m.last_modified).toLocaleString()
  }));
  renderTable(dataForTable, 'table-contributors', ['contributor_ID', 'total_births', 'total_families', 'last_modified']);
}

init();