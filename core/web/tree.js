import { API_BASE_URL } from './config.js';

export function showAncestorTree(personId, personName) {
  let modal = document.getElementById('ancestor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ancestor-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content ancestor-modal-content">
        <span class="close-modal">&times;</span>
        <h2 id="ancestor-modal-title" style="margin-top: 0;"></h2>
        <div id="ancestor-tree-container"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  document.getElementById('ancestor-modal-title').textContent = `Ancestors of ${personName}`;
  const container = document.getElementById('ancestor-tree-container');
  container.innerHTML = '<p style="padding: 20px;">Loading...</p>';
  modal.style.display = 'block';

  fetch(`${API_BASE_URL}/api/persons/${personId}/ancestors`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = '';
      if (!data) {
        container.innerHTML = '<p style="padding: 20px;">No data found.</p>';
        return;
      }
      if (typeof d3 === 'undefined') {
        container.innerHTML = '<p style="padding: 20px;">Error: D3.js library not loaded.</p>';
        return;
      }
      renderD3Tree(data, container);
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = '<p style="padding: 20px;">Error loading tree.</p>';
    });
}

function renderD3Tree(data, container) {
  const dx = 40;
  const dy = 250;

  const root = d3.hierarchy(data, d => d.parents);
  const tree = d3.tree().nodeSize([dx, dy]);

  root.sort((a, b) => {
    const aName = a.data.name || '';
    const bName = b.data.name || '';
    return d3.ascending(aName, bName);
  });

  tree(root);

  let x0 = Infinity;
  let x1 = -x0;
  root.each(d => {
    if (d.x > x1) x1 = d.x;
    if (d.x < x0) x0 = d.x;
  });

  const width = Math.max(900, container.clientWidth);
  const height = x1 - x0 + dx * 2;

  const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [-dy / 3, x0 - dx, width, height])
      .attr('style', 'max-width: 100%; height: auto; font: 14px sans-serif;');

  const g = svg.append('g');

  const link = g.append('g')
      .attr('fill', 'none')
      .attr('stroke', '#ccc')
      .attr('stroke-width', 2)
    .selectAll('path')
    .data(root.links())
    .join('path')
      .attr('d', d3.linkHorizontal()
          .x(d => d.y)
          .y(d => d.x));

  const node = g.append('g')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-width', 3)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`);

  node.append('circle')
      .attr('fill', d => d.children ? '#3498db' : '#999')
      .attr('r', 5);

  node.append('text')
      .attr('dy', '-0.3em')
      .attr('x', d => d.children ? -8 : 8)
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('font-weight', 'bold')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '))
    .clone(true).lower()
      .attr('stroke', 'white');

  node.append('text')
      .attr('dy', '1.2em')
      .attr('x', d => d.children ? -8 : 8)
      .attr('text-anchor', d => d.children ? 'end' : 'start')
      .attr('fill', '#555')
      .attr('font-size', '12px')
      .text(d => {
          let b = d.data.date_of_birth ? `*${d.data.date_of_birth}` : '';
          let p = d.data.place_of_birth ? ` ${d.data.place_of_birth}` : '';
          return (b + p).trim();
      })
    .clone(true).lower()
      .attr('stroke', 'white');
}