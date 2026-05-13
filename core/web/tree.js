import { API_BASE_URL } from './config.js';
import { toUnicodeSearch, toUnicodeHref } from './url.js';
import { t } from './i18n.js';
import { isPrivate } from './utils.js';
import { parseDateForSort } from './dates.js';

export function renderDescendantsPage() {
  const params = new URLSearchParams(window.location.search);
  const n = params.get('n') || '';
  const sn = params.get('sn') || '';
  const dob = params.get('dob') || '';
  const c = params.get('c') || '';
  const personName = [n, sn].filter(Boolean).join(' ');

  document.getElementById('descendant-page-title').textContent = `${personName} - ${t('tree_descendants_title')}`;

  const container = document.getElementById('descendant-tree-container');
  const controls = document.getElementById('descendant-tree-controls');
  const sourceEl = document.getElementById('descendant-tree-source');
  const wrapper = document.getElementById('descendant-tree-wrapper');

  if (wrapper) {
    const availableHeight = window.innerHeight - 165;
    wrapper.style.height = `${Math.max(availableHeight, 400)}px`;
  }

  document.getElementById('btn-descendant-zoom-in').innerHTML = `➕`;
  document.getElementById('btn-descendant-zoom-in').title = t('tree_zoom_in');
  document.getElementById('btn-descendant-zoom-out').innerHTML = `➖`;
  document.getElementById('btn-descendant-zoom-out').title = t('tree_zoom_out');
  document.getElementById('btn-descendant-download-svg').title = t('tree_download_svg');

  controls.style.display = 'none';
  if (sourceEl) sourceEl.style.display = 'none';
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  const apiParams = new URLSearchParams();
  if (n) apiParams.set('n', n);
  if (sn) apiParams.set('sn', sn);
  if (dob) apiParams.set('dob', dob);
  if (c) apiParams.set('c', c);

  fetch(`${API_BASE_URL}/api/descendants?${apiParams}`)
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
      if (sourceEl && c) {
        sourceEl.innerHTML = `${t('tree_source')}: <a href="${toUnicodeHref({ t: 'contributors', contributor: c })}" data-spa-nav>${String(c).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`;
        sourceEl.style.display = 'block';
      }
      renderD3DescendantsTree(data, container, personName, c);
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

export function renderAncestorsPage() {
  const params = new URLSearchParams(window.location.search);
  const n = params.get('n') || '';
  const sn = params.get('sn') || '';
  const dob = params.get('dob') || '';
  const c = params.get('c') || '';
  const personName = [n, sn].filter(Boolean).join(' ');

  document.getElementById('ancestor-page-title').textContent = `${personName} - ${t('tree_ancestors_title')}`;

  const container = document.getElementById('ancestor-tree-container');
  const controls = document.getElementById('ancestor-tree-controls');
  const sourceEl = document.getElementById('ancestor-tree-source');
  const wrapper = document.getElementById('ancestor-tree-wrapper');

  if (wrapper) {
    const availableHeight = window.innerHeight - 165;
    wrapper.style.height = `${Math.max(availableHeight, 400)}px`;
  }

  document.getElementById('btn-zoom-in').innerHTML = `➕`;
  document.getElementById('btn-zoom-in').title = t('tree_zoom_in');
  document.getElementById('btn-zoom-out').innerHTML = `➖`;
  document.getElementById('btn-zoom-out').title = t('tree_zoom_out');
  document.getElementById('btn-download-svg').title = t('tree_download_svg');

  controls.style.display = 'none';
  if (sourceEl) sourceEl.style.display = 'none';
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  const apiParams = new URLSearchParams();
  if (n) apiParams.set('n', n);
  if (sn) apiParams.set('sn', sn);
  if (dob) apiParams.set('dob', dob);
  if (c) apiParams.set('c', c);

  fetch(`${API_BASE_URL}/api/ancestors?${apiParams}`)
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
      if (sourceEl && c) {
        sourceEl.innerHTML = `${t('tree_source')}: <a href="${toUnicodeHref({ t: 'contributors', contributor: c })}" data-spa-nav>${String(c).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</a>`;
        sourceEl.style.display = 'block';
      }
      renderD3Tree(data, container, personName, c);
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

function renderD3Tree(data, container, personName, contributorName) {
  const dx = 120;
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
  let y1 = 0;
  root.each(d => {
    if (d.x > x1) x1 = d.x;
    if (d.x < x0) x0 = d.x;
    if (d.y > y1) y1 = d.y;
  });

  const minX = -dy / 3;
  const minY = x0 - dx;
  const maxX = y1 + 250;
  const maxY = x1 + dx;

  const treeWidth = maxX - minX;
  const treeHeight = maxY - minY;

  // Calculate height to fill the available screen space (viewport minus exact headers/footer/margins)
  const availableHeight = window.innerHeight - 165;
  const wrapper = document.getElementById('ancestor-tree-wrapper');
  if (wrapper) {
    wrapper.style.height = `${Math.max(availableHeight, 400)}px`;
  } else {
    container.style.height = `${Math.max(availableHeight, 400)}px`;
  }

  const width = container.clientWidth || 900;
  const height = container.clientHeight || 500;

  const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'width: 100%; height: 100%; font: 14px sans-serif; cursor: grab;');

  const g = svg.append('g');

  const minScale = Math.min(1, width / treeWidth, height / treeHeight);

  const zoom = d3.zoom()
      .scaleExtent([minScale, 4])
      .translateExtent([[minX, minY], [maxX, maxY]])
      .on('zoom', (e) => {
        g.attr('transform', e.transform);
      });

  svg.call(zoom);

  const initialScale = minScale;
  const tx = (width - treeWidth * initialScale) / 2 - minX * initialScale;
  const ty = (height - treeHeight * initialScale) / 2 - minY * initialScale;
  const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(initialScale);
  svg.call(zoom.transform, initialTransform);

  d3.select('#btn-zoom-in').on('click', null).on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  });
  d3.select('#btn-zoom-out').on('click', null).on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
  });

  d3.select('#btn-download-svg').on('click', null).on('click', () => {
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
       p.set('dob', data.date_of_birth);
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
        .text(`${personName} - ${t('tree_ancestors_title')}`);

    const indexUrl = window.location.origin + window.location.pathname;
    const siteTitle = t('site_title');

    overlay.append('a')
        .attr('href', indexUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + padding + 15)
        .attr('text-anchor', 'end')
        .attr('font-size', '14px')
        .attr('fill', '#3498db')
        .text(siteTitle);

    if (contributorName) {
        const sourceLabel = overlay.append('text')
            .attr('x', exportX + padding)
            .attr('y', exportY + exportHeight - padding)
            .attr('font-size', '14px')
            .attr('fill', '#555')
            .text(`${t('tree_source')}:`);

        const labelWidth = sourceLabel.node().getComputedTextLength();

        const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', contributor: contributorName });
        overlay.append('a')
            .attr('href', contribUrl)
            .attr('target', '_blank')
            .append('text')
            .attr('x', exportX + padding + labelWidth + 6)
            .attr('y', exportY + exportHeight - padding)
            .attr('font-size', '14px')
            .attr('fill', '#3498db')
            .text(`${t('col_contributor')} ${contributorName}`);
    }

    overlay.append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + exportHeight - padding)
        .attr('text-anchor', 'end')
        .attr('font-size', '14px')
        .attr('fill', '#555')
        .text(new Date().toLocaleString(document.documentElement.lang || 'en'));

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

  const marriageNode = g.append('g')
    .selectAll('g')
    .data(root.descendants().filter(d => d.children && d.children.length === 2 && d.data.parents_marriage))
    .join('g')
      .attr('transform', d => `translate(${d.children[0].y},${d.x})`);

  const marriageLink = marriageNode.append(d => {
      const husband = d.children[0].data;
      const wife = d.children[1].data;
      const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
      const wPriv = isPrivate(wife.name) || isPrivate(wife.surname);
      return document.createElementNS('http://www.w3.org/2000/svg', (hPriv || wPriv) ? 'g' : 'a');
  })
    .attr('href', d => {
        const husband = d.children[0].data;
        const wife = d.children[1].data;
        const marriage = d.data.parents_marriage;
        const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
        const wPriv = isPrivate(wife.name) || isPrivate(wife.surname);

        if (hPriv || wPriv) return null;

        const params = new URLSearchParams();
        params.set('t', 'family');
        if (husband.name && !hPriv) params.set('hn', husband.name);
        if (husband.surname && !hPriv) params.set('hsn', husband.surname);
        if (husband.date_of_birth && !hPriv) params.set('hb', husband.date_of_birth);
        if (wife.name && !wPriv) params.set('wn', wife.name);
        if (wife.surname && !wPriv) params.set('wsn', wife.surname);
        if (wife.date_of_birth && !wPriv) params.set('wb', wife.date_of_birth);
        if (marriage.date) params.set('dom', marriage.date);
        if (contributorName) params.set('c', contributorName);
        params.set('ex', '1');

        return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
    })
    .attr('data-spa-nav', d => {
        const husband = d.children[0].data;
        const wife = d.children[1].data;
        const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
        const wPriv = isPrivate(wife.name) || isPrivate(wife.surname);
        return (hPriv || wPriv) ? null : '';
    });

  const marriageText = marriageLink.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', d => {
          const husband = d.children[0].data;
          const wife = d.children[1].data;
          const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
          const wPriv = isPrivate(wife.name) || isPrivate(wife.surname);
          return (hPriv || wPriv) ? '#555' : '#3498db';
      });

  marriageText.each(function(d) {
      const el = d3.select(this);
      const m = d.data.parents_marriage;
      const b = m.date ? m.date : '';
      const p = m.place ? m.place.split(',')[0].trim() : '';

      if (b && p) {
          el.append('tspan').attr('x', 0).attr('dy', '-0.2em').text(`⚭ ${b}`);
          el.append('tspan').attr('x', 0).attr('dy', '1.2em').text(p);
      } else {
          el.append('tspan').attr('x', 0).attr('dy', '0.3em').text(`⚭ ${b} ${p}`.trim());
      }
  });

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

  const linkNode = node.append(d => document.createElementNS('http://www.w3.org/2000/svg', (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? 'g' : 'a'))
      .attr('href', d => {
          if (isPrivate(d.data.name) || isPrivate(d.data.surname)) return null;
          const params = new URLSearchParams();
          params.set('t', 'person');
          if (d.data.name) params.set('n', d.data.name);
          if (d.data.surname) params.set('sn', d.data.surname);
          if (d.data.date_of_birth) {
             params.set('dob', d.data.date_of_birth);
          }
          params.set('ex', '1');
          return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
      })
      .attr('data-spa-nav', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? null : '');

  linkNode.append('text')
      .attr('dy', '-0.8em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('font-weight', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? 'normal' : 'bold')
      .attr('fill', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? '#555' : '#3498db')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '))
    .clone(true).lower()
      .attr('stroke', 'white');

  const infoText = node.append('text')
      .attr('dy', '1.4em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '12px');

  infoText.each(function(d) {
      const el = d3.select(this);
      const b = d.data.date_of_birth ? d.data.date_of_birth : '';
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

function renderD3DescendantsTree(data, container, personName, contributorName) {
  const dx = 120;
  const dy = 250;

  const root = d3.hierarchy(data, d => d.children);
  const tree = d3.tree().nodeSize([dx, dy]);

  root.sort((a, b) => {
    if (a.data.is_family && b.data.is_family) {
       const aDate = parseDateForSort(a.data.marriage?.date);
       const bDate = parseDateForSort(b.data.marriage?.date);
       if (aDate !== bDate) {
         if (aDate === 0) return 1;
         if (bDate === 0) return -1;
         return aDate - bDate;
       }
       return 0;
    }

    const aPriv = isPrivate(a.data.name) || isPrivate(a.data.surname);
    const bPriv = isPrivate(b.data.name) || isPrivate(b.data.surname);
    if (aPriv !== bPriv) return aPriv ? 1 : -1;

    const aDob = parseDateForSort(a.data.date_of_birth);
    const bDob = parseDateForSort(b.data.date_of_birth);
    if (aDob !== bDob) {
       if (aDob === 0) return 1;
       if (bDob === 0) return -1;
       return aDob - bDob;
    }

    const aName = a.data.name || '';
    const bName = b.data.name || '';
    return d3.ascending(aName, bName);
  });

  tree(root);

  // Adjust coordinates to bring families closer to parents, and fix generations
  root.each(d => {
    let gen = 0;
    let curr = d;
    while (curr.parent) {
      if (!curr.data.is_family) gen++;
      curr = curr.parent;
    }

    if (d.data.is_family) {
      d.y = (gen * dy) + 50;
      d.x = d.x + 35;
    } else {
      d.y = gen * dy;
    }
  });

  let x0 = Infinity;
  let x1 = -x0;
  let y1 = 0;
  root.each(d => {
    if (d.x > x1) x1 = d.x;
    if (d.x < x0) x0 = d.x;
    if (d.y > y1) y1 = d.y;
  });

  const minX = -dy / 3;
  const minY = x0 - dx;
  const maxX = y1 + 250;
  const maxY = x1 + dx;

  const treeWidth = maxX - minX;
  const treeHeight = maxY - minY;

  const availableHeight = window.innerHeight - 165;
  const wrapper = document.getElementById('descendant-tree-wrapper');
  if (wrapper) {
    wrapper.style.height = `${Math.max(availableHeight, 400)}px`;
  } else {
    container.style.height = `${Math.max(availableHeight, 400)}px`;
  }

  const width = container.clientWidth || 900;
  const height = container.clientHeight || 500;

  const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'width: 100%; height: 100%; font: 14px sans-serif; cursor: grab;');

  const g = svg.append('g');

  const minScale = Math.min(1, width / treeWidth, height / treeHeight);

  const zoom = d3.zoom()
      .scaleExtent([minScale, 4])
      .translateExtent([[minX, minY], [maxX, maxY]])
      .on('zoom', (e) => {
        g.attr('transform', e.transform);
      });

  svg.call(zoom);

  const initialScale = minScale;
  const tx = (width - treeWidth * initialScale) / 2 - minX * initialScale;
  const ty = (height - treeHeight * initialScale) / 2 - minY * initialScale;
  const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(initialScale);
  svg.call(zoom.transform, initialTransform);

  d3.select('#btn-descendant-zoom-in').on('click', null).on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
  });
  d3.select('#btn-descendant-zoom-out').on('click', null).on('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
  });

  d3.select('#btn-descendant-download-svg').on('click', null).on('click', () => {
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
    if (data.date_of_birth) p.set('dob', data.date_of_birth);
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
        .text(`${personName} - ${t('tree_descendants_title')}`);

    const indexUrl = window.location.origin + window.location.pathname;
    overlay.append('a')
        .attr('href', indexUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + padding + 15)
        .attr('text-anchor', 'end')
        .attr('font-size', '14px')
        .attr('fill', '#3498db')
        .text(t('site_title'));

    if (contributorName) {
        const sourceLabel = overlay.append('text')
            .attr('x', exportX + padding)
            .attr('y', exportY + exportHeight - padding)
            .attr('font-size', '14px')
            .attr('fill', '#555')
            .text(`${t('tree_source')}:`);

        const labelWidth = sourceLabel.node().getComputedTextLength();
        const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', contributor: contributorName });
        overlay.append('a')
            .attr('href', contribUrl)
            .attr('target', '_blank')
            .append('text')
            .attr('x', exportX + padding + labelWidth + 6)
            .attr('y', exportY + exportHeight - padding)
            .attr('font-size', '14px')
            .attr('fill', '#3498db')
            .text(`${t('col_contributor')} ${contributorName}`);
    }

    overlay.append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + exportHeight - padding)
        .attr('text-anchor', 'end')
        .attr('font-size', '14px')
        .attr('fill', '#555')
        .text(new Date().toLocaleString(document.documentElement.lang || 'en'));

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
    const safeName = (personName || 'descendants').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `descendants_${safeName}.svg`;
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

  node.filter(d => !d.data.is_family)
      .append('circle')
      .attr('fill', d => d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999'))
      .attr('r', 5);

  node.filter(d => d.data.is_family)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '16px')
      .attr('fill', d => {
          const sex = d.data.partner?.sex;
          return sex === 'm' ? '#3498db' : (sex === 'f' ? '#e83e8c' : '#999');
      })
      .text('⚭')
    .clone(true).lower()
      .attr('stroke', 'white')
      .attr('stroke-width', 3);

  const personNode = node.filter(d => !d.data.is_family);
  const linkNode = personNode.append(d => document.createElementNS('http://www.w3.org/2000/svg', (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? 'g' : 'a'))
      .attr('href', d => {
          if (isPrivate(d.data.name) || isPrivate(d.data.surname)) return null;
          const params = new URLSearchParams();
          params.set('t', 'person');
          if (d.data.name) params.set('n', d.data.name);
          if (d.data.surname) params.set('sn', d.data.surname);
          if (d.data.date_of_birth) params.set('dob', d.data.date_of_birth);
          params.set('ex', '1');
          return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
      })
      .attr('data-spa-nav', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? null : '');

  linkNode.append('text')
      .attr('dy', '-0.8em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('font-weight', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? 'normal' : 'bold')
      .attr('fill', d => (isPrivate(d.data.name) || isPrivate(d.data.surname)) ? '#555' : '#3498db')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '))
    .clone(true).lower()
      .attr('stroke', 'white');

  const infoText = personNode.append('text')
      .attr('dy', '1.4em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '12px');

  infoText.each(function(d) {
      const el = d3.select(this);
      const b = d.data.date_of_birth ? d.data.date_of_birth : '';
      const p = d.data.place_of_birth ? d.data.place_of_birth.split(',')[0].trim() : '';
      if (b) el.append('tspan').attr('x', 0).text(b);
      if (p) el.append('tspan').attr('x', 0).attr('dy', b ? '1.2em' : '0').text(p);
  });
  infoText.clone(true).lower().attr('stroke', 'white');

  const familyNode = node.filter(d => d.data.is_family);
  const familyLink = familyNode.append(d => {
      const person = d.parent.data;
      const partner = d.data.partner;
      const pPriv = isPrivate(person.name) || isPrivate(person.surname);
      const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
      return document.createElementNS('http://www.w3.org/2000/svg', (pPriv || partPriv) ? 'g' : 'a');
  })
      .attr('href', d => {
          const params = new URLSearchParams();
          params.set('t', 'family');
          const person = d.parent.data;
          const partner = d.data.partner;
          const pPriv = isPrivate(person.name) || isPrivate(person.surname);
          const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);

          if (pPriv || partPriv) return null;

          if (person.sex === 'm' || (person.sex !== 'f' && !partner.sex)) {
             if (person.name && !pPriv) params.set('hn', person.name);
             if (person.surname && !pPriv) params.set('hsn', person.surname);
             if (person.date_of_birth && !pPriv) params.set('hb', person.date_of_birth);
             if (partner.name && !partPriv) params.set('wn', partner.name);
             if (partner.surname && !partPriv) params.set('wsn', partner.surname);
             if (partner.date_of_birth && !partPriv) params.set('wb', partner.date_of_birth);
          } else {
             if (partner.name && !partPriv) params.set('hn', partner.name);
             if (partner.surname && !partPriv) params.set('hsn', partner.surname);
             if (partner.date_of_birth && !partPriv) params.set('hb', partner.date_of_birth);
             if (person.name && !pPriv) params.set('wn', person.name);
             if (person.surname && !pPriv) params.set('wsn', person.surname);
             if (person.date_of_birth && !pPriv) params.set('wb', person.date_of_birth);
          }
          if (d.data.marriage) {
             if (d.data.marriage.date) params.set('dom', d.data.marriage.date);
             if (d.data.marriage.place) params.set('pom', d.data.marriage.place);
          }
          if (contributorName) params.set('c', contributorName);
          params.set('ex', '1');
          return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
      })
      .attr('data-spa-nav', d => {
          const person = d.parent.data;
          const partner = d.data.partner;
          const pPriv = isPrivate(person.name) || isPrivate(person.surname);
          const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
          return (pPriv || partPriv) ? null : '';
      });

  const familyText = familyLink.append('text')
      .attr('dy', '0.3em')
      .attr('x', 14)
      .attr('text-anchor', 'start')
      .attr('font-size', '12px')
      .attr('fill', d => {
          const person = d.parent.data;
          const partner = d.data.partner;
          const pPriv = isPrivate(person.name) || isPrivate(person.surname);
          const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
          return (pPriv || partPriv) ? '#555' : '#3498db';
      });

  familyText.each(function(d) {
      const el = d3.select(this);
      const p = d.data.partner;
      const m = d.data.marriage || {};
      const partnerName = [p.name, p.surname].filter(Boolean).join(' ');
      const b = m.date ? m.date : '';
      const pl = m.place ? m.place.split(',')[0].trim() : '';

      let firstLine = true;
      if (partnerName) {
         const isPriv = isPrivate(p.name) || isPrivate(p.surname);
         el.append('tspan').attr('x', 14).attr('font-weight', isPriv ? 'normal' : 'bold').text(partnerName);
         firstLine = false;
      }
      if (b) {
         el.append('tspan').attr('x', 14).attr('dy', firstLine ? '0' : '1.2em').text(b);
         firstLine = false;
      }
      if (pl) {
         el.append('tspan').attr('x', 14).attr('dy', firstLine ? '0' : '1.2em').text(pl);
      }
  });
  familyText.clone(true).lower().attr('stroke', 'white');
}