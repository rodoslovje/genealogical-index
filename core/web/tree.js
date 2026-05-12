import { API_BASE_URL } from './config.js';
import { toUnicodeSearch } from './url.js';
import { t } from './i18n.js';

export function showAncestorTree(personId, personName, contributorName) {
  let modal = document.getElementById('ancestor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ancestor-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content ancestor-modal-content">
        <span class="close-modal">&times;</span>
        <h2 id="ancestor-modal-title" style="margin-top: 0;"></h2>
        <div id="ancestor-tree-controls" style="margin-bottom: 10px; display: none; gap: 8px;">
          <button id="btn-zoom-in" class="export-btn" style="padding: 4px 10px;">➕ ${t('tree_zoom_in')}</button>
          <button id="btn-zoom-out" class="export-btn" style="padding: 4px 10px;">➖ ${t('tree_zoom_out')}</button>
          <button id="btn-zoom-reset" class="export-btn" style="padding: 4px 10px;">🔄 ${t('tree_reset')}</button>
          <button id="btn-download-svg" class="export-btn" style="padding: 4px 10px; margin-left: auto;" title="${t('tree_download_svg')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>SVG</button>
        </div>
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

  document.getElementById('ancestor-modal-title').textContent = `${t('tree_ancestors_of')} ${personName}`;
  const container = document.getElementById('ancestor-tree-container');
  const controls = document.getElementById('ancestor-tree-controls');
  controls.style.display = 'none';
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;
  modal.style.display = 'block';

  fetch(`${API_BASE_URL}/api/persons/${personId}/ancestors`)
    .then(r => r.json())
    .then(data => {
      container.innerHTML = '';
      if (!data) {
        container.innerHTML = `<p style="padding: 20px;">${t('no_results')}</p>`;
        return;
      }
      if (typeof d3 === 'undefined') {
        container.innerHTML = `<p style="padding: 20px;">${t('tree_no_d3')}</p>`;
        return;
      }
      controls.style.display = 'flex';
      renderD3Tree(data, container, personName, contributorName);
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

function renderD3Tree(data, container, personName, contributorName) {
  const dx = 55;
  const dy = 250;

  const root = d3.hierarchy(data, d => d.parents);
  const tree = d3.tree().nodeSize([dx, dy]);

  root.sort((a, b) => {
    const sexOrder = { 'm': 1, 'f': 2 };
    const aSex = sexOrder[a.data.sex] || 3;
    const bSex = sexOrder[b.data.sex] || 3;
    if (aSex !== bSex) return aSex - bSex;

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
      .attr('style', 'max-width: 100%; height: auto; font: 14px sans-serif; cursor: grab;');

  const g = svg.append('g');

  const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => {
        g.attr('transform', e.transform);
      });

  svg.call(zoom);

  d3.select('#btn-zoom-in').on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  });
  d3.select('#btn-zoom-out').on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
  });
  d3.select('#btn-zoom-reset').on('click', () => {
    svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  });

  d3.select('#btn-download-svg').on('click', () => {
    const originalTransform = g.attr('transform');
    g.attr('transform', null);

    const bbox = g.node().getBBox();
    const padding = 20;
    const headerHeight = 50;
    const footerHeight = 40;

    const exportX = bbox.x - padding;
    const exportY = bbox.y - padding - headerHeight;
    const exportWidth = bbox.width + padding * 2;
    const exportHeight = bbox.height + padding * 2 + headerHeight + footerHeight;

    const vb = svg.property('viewBox').baseVal;
    const originalViewBox = `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
    const originalWidth = svg.attr('width');
    const originalHeight = svg.attr('height');

    svg.attr('viewBox', `${exportX} ${exportY} ${exportWidth} ${exportHeight}`);
    svg.attr('width', exportWidth);
    svg.attr('height', exportHeight);

    const bg = svg.insert('rect', ':first-child')
        .attr('class', 'export-only')
        .attr('x', exportX)
        .attr('y', exportY)
        .attr('width', exportWidth)
        .attr('height', exportHeight)
        .attr('fill', 'white');

    const overlay = svg.append('g').attr('class', 'export-only');

    const p = new URLSearchParams();
    p.set('t', 'person');
    if (data.name) p.set('n', data.name);
    if (data.surname) p.set('sn', data.surname);
    if (data.date_of_birth) {
       const m = String(data.date_of_birth).match(/\d{4}/);
       if (m) p.set('dob', m[0]);
    }
    p.set('ex', '1');
    const rootUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch(p);

    overlay.append('a')
        .attr('href', rootUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + padding)
        .attr('y', exportY + padding + 15)
        .attr('font-size', '18px')
        .attr('font-weight', 'bold')
        .attr('fill', '#3498db')
        .text(`${t('tree_ancestors_of')} ${personName}`);

    const indexUrl = window.location.origin + window.location.pathname;
    const siteTitle = t('site_title');

    overlay.append('a')
        .attr('href', indexUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + padding)
        .attr('y', exportY + exportHeight - padding)
        .attr('font-size', '14px')
        .attr('fill', '#3498db')
        .text(siteTitle);

    if (contributorName) {
        const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', contributor: contributorName });
        overlay.append('a')
            .attr('href', contribUrl)
            .attr('target', '_blank')
            .append('text')
            .attr('x', exportX + exportWidth - padding)
            .attr('y', exportY + exportHeight - padding)
            .attr('text-anchor', 'end')
            .attr('font-size', '14px')
            .attr('fill', '#3498db')
            .text(`${t('tree_source')}: ${t('col_contributor')} ${contributorName}`);
    }

    const svgNode = svg.node();
    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgNode);
    if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    source = '<?xml version="1.0" standalone="no"?>\r\n' + source;

    svg.selectAll('.export-only').remove();
    svg.attr('viewBox', originalViewBox);
    svg.attr('width', originalWidth);
    svg.attr('height', originalHeight);
    g.attr('transform', originalTransform);

    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = (personName || 'ancestors').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `ancestors_${safeName}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

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
      .attr('fill', d => d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999'))
      .attr('r', 5);

  const linkNode = node.append('a')
      .attr('href', d => {
          const params = new URLSearchParams();
          params.set('t', 'person');
          if (d.data.name) params.set('n', d.data.name);
          if (d.data.surname) params.set('sn', d.data.surname);
          if (d.data.date_of_birth) {
             const m = String(d.data.date_of_birth).match(/\d{4}/);
             if (m) params.set('dob', m[0]);
          }
          params.set('ex', '1');
          return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
      })
      .attr('target', '_blank');

  linkNode.append('text')
      .attr('dy', '-0.8em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('font-weight', 'bold')
      .attr('fill', '#3498db')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '))
    .clone(true).lower()
      .attr('stroke', 'white');

  const infoText = node.append('text')
      .attr('dy', '1.2em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '12px');

  infoText.each(function(d) {
      const el = d3.select(this);
      const b = d.data.date_of_birth ? `*${d.data.date_of_birth}` : '';
      const p = d.data.place_of_birth ? d.data.place_of_birth.split(',')[0].trim() : '';

      if (b) {
          el.append('tspan')
            .attr('x', 0)
            .text(b);
      }
      if (p) {
          el.append('tspan')
            .attr('x', 0)
            .attr('dy', b ? '1.2em' : '0')
            .text(p);
      }
  });

  infoText.clone(true).lower()
      .attr('stroke', 'white');
}