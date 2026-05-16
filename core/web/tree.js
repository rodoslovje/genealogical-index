import { API_BASE_URL } from './config.js';
import { toUnicodeSearch, toUnicodeHref, currentParams } from './url.js';
import { t } from './i18n.js';
import { isPrivate, escapeHtml, downloadBlob } from './utils.js';
import { parseDateForSort } from './dates.js';

// --- DOM id maps for each variant. The two tree pages re-use the same HTML
// shell with slightly different ids; everything else is shared. -------------

const ANCESTORS_IDS = {
  pageTitle:  'ancestor-page-title',
  container:  'ancestor-tree-container',
  controls:   'ancestor-tree-controls',
  source:     'ancestor-tree-source',
  wrapper:    'ancestor-tree-wrapper',
  zoomIn:     'btn-zoom-in',
  zoomOut:    'btn-zoom-out',
  downloadSvg:'btn-download-svg',
};
const DESCENDANTS_IDS = {
  pageTitle:  'descendant-page-title',
  container:  'descendant-tree-container',
  controls:   'descendant-tree-controls',
  source:     'descendant-tree-source',
  wrapper:    'descendant-tree-wrapper',
  zoomIn:     'btn-descendant-zoom-in',
  zoomOut:    'btn-descendant-zoom-out',
  downloadSvg:'btn-descendant-download-svg',
};

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function renderAncestorsPage()   { renderTreePage('ancestors'); }
export function renderDescendantsPage() { renderTreePage('descendants'); }

function renderTreePage(kind) {
  const config = kind === 'ancestors'
    ? { ids: ANCESTORS_IDS,   titleKey: 'tree_ancestors_title',   apiPath: 'ancestors',   filePrefix: 'ancestors',   renderTree: renderD3AncestorsTree }
    : { ids: DESCENDANTS_IDS, titleKey: 'tree_descendants_title', apiPath: 'descendants', filePrefix: 'descendants', renderTree: renderD3DescendantsTree };

  const params = currentParams();
  const n = params.get('n') || '';
  const sn = params.get('sn') || '';
  const dob = params.get('dob') || '';
  const c = params.get('c') || '';
  const personName = [n, sn].filter(Boolean).join(' ');

  const pageTitle = personName ? `${personName} - ${t(config.titleKey)}` : t(config.titleKey);
  document.getElementById(config.ids.pageTitle).textContent = pageTitle;
  document.title = `${pageTitle} | ${t('site_title')}`;

  const container = document.getElementById(config.ids.container);
  const controls = document.getElementById(config.ids.controls);
  const sourceEl = document.getElementById(config.ids.source);
  const wrapper = document.getElementById(config.ids.wrapper);

  if (wrapper) {
    wrapper.style.height = `${Math.max(window.innerHeight - 165, 400)}px`;
  }

  const zoomInBtn = document.getElementById(config.ids.zoomIn);
  if (zoomInBtn) { zoomInBtn.innerHTML = '➕'; zoomInBtn.title = t('tree_zoom_in'); }
  const zoomOutBtn = document.getElementById(config.ids.zoomOut);
  if (zoomOutBtn) { zoomOutBtn.innerHTML = '➖'; zoomOutBtn.title = t('tree_zoom_out'); }
  const downloadBtn = document.getElementById(config.ids.downloadSvg);
  if (downloadBtn) downloadBtn.title = t('tree_download_svg');

  controls.style.display = 'none';
  if (sourceEl) sourceEl.style.display = 'none';
  container.innerHTML = `<p style="padding: 20px;">${t('tree_loading')}</p>`;

  const apiParams = new URLSearchParams();
  if (n) apiParams.set('n', n);
  if (sn) apiParams.set('sn', sn);
  if (dob) apiParams.set('dob', dob);
  if (c) apiParams.set('c', c);

  fetch(`${API_BASE_URL}/api/${config.apiPath}?${apiParams}`)
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
        sourceEl.innerHTML = `${t('tree_source')}: <a href="${toUnicodeHref({ t: 'contributors', c })}" data-spa-nav>${escapeHtml(c)}</a>`;
        sourceEl.style.display = 'block';
      }
      config.renderTree(data, container, personName, c, config.ids, {
        titleText: `${personName} - ${t(config.titleKey)}`,
        filePrefix: config.filePrefix,
      });
    })
    .catch(err => {
      console.error(err);
      container.innerHTML = `<p style="padding: 20px;">${t('tree_error')}</p>`;
    });
}

// ---------------------------------------------------------------------------
// Shared layout / chrome helpers
// ---------------------------------------------------------------------------

function computeBounds(root, dx, dy) {
  let x0 = Infinity, x1 = -x0, y1 = 0;
  root.each(d => {
    if (d.x > x1) x1 = d.x;
    if (d.x < x0) x0 = d.x;
    if (d.y > y1) y1 = d.y;
  });
  const minX = -dy / 3;
  const minY = x0 - dx;
  const maxX = y1 + 250;
  const maxY = x1 + dx;
  return { minX, minY, maxX, maxY, treeWidth: maxX - minX, treeHeight: maxY - minY };
}

function sizeContainerToViewport(container, wrapperId) {
  const availableHeight = Math.max(window.innerHeight - 165, 400);
  const wrapper = document.getElementById(wrapperId);
  if (wrapper) wrapper.style.height = `${availableHeight}px`;
  else container.style.height = `${availableHeight}px`;
}

function createSvgWithZoom(container, bounds, zoomInId, zoomOutId) {
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 500;

  const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'width: 100%; height: 100%; font: 14px sans-serif; cursor: grab;');
  const g = svg.append('g');

  const minScale = Math.min(1, width / bounds.treeWidth, height / bounds.treeHeight);
  const zoom = d3.zoom()
      .scaleExtent([minScale, 4])
      .translateExtent([[bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]])
      .on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);

  const tx = (width - bounds.treeWidth * minScale) / 2 - bounds.minX * minScale;
  const ty = (height - bounds.treeHeight * minScale) / 2 - bounds.minY * minScale;
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(minScale));

  d3.select(`#${zoomInId}`).on('click', null).on('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1.3));
  d3.select(`#${zoomOutId}`).on('click', null).on('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3));

  return { svg, g };
}

// Wires the SVG-download button. Both trees produce the same export chrome
// (title at top-left, site title at top-right, contributor + timestamp at the
// bottom), only the heading text and output filename differ.
function attachSvgExport({ svg, g, downloadBtnId, data, personName, contributorName, titleText, filePrefix }) {
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
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

    svg.insert('rect', ':first-child')
        .attr('class', 'export-only')
        .attr('x', exportX).attr('y', exportY)
        .attr('width', exportWidth).attr('height', exportHeight)
        .attr('fill', 'white');

    const overlay = svg.append('g').attr('class', 'export-only');

    const rootParams = new URLSearchParams();
    rootParams.set('t', 'person');
    if (data.name) rootParams.set('n', data.name);
    if (data.surname) rootParams.set('sn', data.surname);
    if (data.date_of_birth) rootParams.set('dob', data.date_of_birth);
    if (contributorName) rootParams.set('c', contributorName);
    rootParams.set('ex', '1');
    const rootUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch(rootParams);

    overlay.append('a')
        .attr('href', rootUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + padding)
        .attr('y', exportY + padding + 15)
        .attr('font-size', '18px')
        .attr('font-weight', 'bold')
        .attr('fill', '#3498db')
        .text(titleText);

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
      const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', c: contributorName });
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

    const safeName = (personName || filePrefix).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadBlob(
      new Blob([source], { type: 'image/svg+xml;charset=utf-8;' }),
      `${filePrefix}_${safeName}.svg`
    );
  });
}

// Horizontal link paths between parent/child nodes — identical in both trees.
function appendLinks(g, root) {
  return g.append('g')
      .attr('fill', 'none')
      .attr('stroke', '#ccc')
      .attr('stroke-width', 2)
    .selectAll('path')
    .data(root.links())
    .join('path')
      .attr('d', d3.linkHorizontal().x(d => d.y).y(d => d.x));
}

// Helpers for the person-node "look": coloured dot, clickable name, info text.
const isNodePrivate = (d) => isPrivate(d.data.name) || isPrivate(d.data.surname);

function personHrefBuilder(contributorName) {
  return (d) => {
    if (isNodePrivate(d)) return null;
    const params = new URLSearchParams();
    params.set('t', 'person');
    if (d.data.name) params.set('n', d.data.name);
    if (d.data.surname) params.set('sn', d.data.surname);
    if (d.data.date_of_birth) params.set('dob', d.data.date_of_birth);
    if (contributorName) params.set('c', contributorName);
    params.set('ex', '1');
    return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
  };
}

// Appends circle + clickable name + birth/place info text to a person-node
// selection. Used by both trees.
function decoratePersonNodes(selection, contributorName) {
  selection.append('circle')
      .attr('fill', d => d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999'))
      .attr('r', 5);

  const linkNode = selection.append(d =>
      document.createElementNS('http://www.w3.org/2000/svg', isNodePrivate(d) ? 'g' : 'a'))
      .attr('href', personHrefBuilder(contributorName))
      .attr('data-spa-nav', d => isNodePrivate(d) ? null : '');

  linkNode.append('text')
      .attr('dy', '-0.8em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('font-weight', d => isNodePrivate(d) ? 'normal' : 'bold')
      .attr('fill', d => isNodePrivate(d) ? '#555' : '#3498db')
      .text(d => [d.data.name, d.data.surname].filter(Boolean).join(' '))
    .clone(true).lower()
      .attr('stroke', 'white');

  const infoText = selection.append('text')
      .attr('dy', '1.4em')
      .attr('x', 0)
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '12px');

  infoText.each(function(d) {
    const el = d3.select(this);
    const b = d.data.date_of_birth || '';
    const p = d.data.place_of_birth ? d.data.place_of_birth.split(',')[0].trim() : '';
    if (b) el.append('tspan').attr('x', 0).text(b);
    if (p) el.append('tspan').attr('x', 0).attr('dy', b ? '1.2em' : '0').text(p);
  });

  infoText.clone(true).lower().attr('stroke', 'white');
}

// ---------------------------------------------------------------------------
// Ancestors tree
// ---------------------------------------------------------------------------

function renderD3AncestorsTree(data, container, personName, contributorName, ids, exportOpts) {
  const dx = 120, dy = 250;

  const root = d3.hierarchy(data, d => d.parents);
  d3.tree().nodeSize([dx, dy])(root.sort((a, b) => {
    const sexOrder = { 'm': 1, 'f': 2 };
    const aSex = sexOrder[a.data.sex] || 3;
    const bSex = sexOrder[b.data.sex] || 3;
    if (aSex !== bSex) return aSex - bSex;
    return d3.ascending(a.data.name || '', b.data.name || '');
  }));

  const bounds = computeBounds(root, dx, dy);
  sizeContainerToViewport(container, ids.wrapper);
  const { svg, g } = createSvgWithZoom(container, bounds, ids.zoomIn, ids.zoomOut);

  attachSvgExport({
    svg, g, downloadBtnId: ids.downloadSvg,
    data, personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  appendLinks(g, root);
  appendAncestorMarriageNodes(g, root, contributorName);

  const node = g.append('g')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-width', 3)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`);

  decoratePersonNodes(node, contributorName);
}

// Marriage rendering specific to the ancestors view: between the two parents
// of any node that has both, show a ⚭ glyph + marriage date/place, linked to
// the family search where possible.
function appendAncestorMarriageNodes(g, root, contributorName) {
  const marriageNode = g.append('g')
    .selectAll('g')
    .data(root.descendants().filter(d => d.children && d.children.length === 2 && d.data.parents_marriage))
    .join('g')
      .attr('transform', d => `translate(${d.children[0].y},${d.x})`);

  const marriageLink = marriageNode.append(d => {
    const husband = d.children[0].data;
    const wife = d.children[1].data;
    const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
    const wPriv = isPrivate(wife.name)    || isPrivate(wife.surname);
    return document.createElementNS('http://www.w3.org/2000/svg', (hPriv || wPriv) ? 'g' : 'a');
  })
    .attr('href', d => {
      const husband = d.children[0].data;
      const wife = d.children[1].data;
      const marriage = d.data.parents_marriage;
      const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
      const wPriv = isPrivate(wife.name)    || isPrivate(wife.surname);
      if (hPriv || wPriv) return null;

      const params = new URLSearchParams();
      params.set('t', 'family');
      if (husband.name)          params.set('hn',  husband.name);
      if (husband.surname)       params.set('hsn', husband.surname);
      if (husband.date_of_birth) params.set('hb',  husband.date_of_birth);
      if (wife.name)             params.set('wn',  wife.name);
      if (wife.surname)          params.set('wsn', wife.surname);
      if (wife.date_of_birth)    params.set('wb',  wife.date_of_birth);
      if (marriage.date)         params.set('dom', marriage.date);
      if (contributorName)       params.set('c',   contributorName);
      params.set('ex', '1');
      return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
    })
    .attr('data-spa-nav', d => {
      const husband = d.children[0].data;
      const wife = d.children[1].data;
      const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
      const wPriv = isPrivate(wife.name)    || isPrivate(wife.surname);
      return (hPriv || wPriv) ? null : '';
    });

  const marriageText = marriageLink.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', d => {
        const husband = d.children[0].data;
        const wife = d.children[1].data;
        const hPriv = isPrivate(husband.name) || isPrivate(husband.surname);
        const wPriv = isPrivate(wife.name)    || isPrivate(wife.surname);
        return (hPriv || wPriv) ? '#555' : '#3498db';
      });

  marriageText.each(function(d) {
    const el = d3.select(this);
    const m = d.data.parents_marriage;
    const date = m.date || '';
    const place = m.place ? m.place.split(',')[0].trim() : '';
    if (date && place) {
      el.append('tspan').attr('x', 0).attr('dy', '-0.2em').text(`⚭ ${date}`);
      el.append('tspan').attr('x', 0).attr('dy', '1.2em').text(place);
    } else {
      el.append('tspan').attr('x', 0).attr('dy', '0.3em').text(`⚭ ${date} ${place}`.trim());
    }
  });
}

// ---------------------------------------------------------------------------
// Descendants tree
// ---------------------------------------------------------------------------

function renderD3DescendantsTree(data, container, personName, contributorName, ids, exportOpts) {
  const dx = 120, dy = 250;

  const root = d3.hierarchy(data, d => d.children);
  d3.tree().nodeSize([dx, dy])(root.sort((a, b) => {
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

    return d3.ascending(a.data.name || '', b.data.name || '');
  }));

  // Bring family nodes closer to their parent person and snap generations to columns.
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

  const bounds = computeBounds(root, dx, dy);
  sizeContainerToViewport(container, ids.wrapper);
  const { svg, g } = createSvgWithZoom(container, bounds, ids.zoomIn, ids.zoomOut);

  attachSvgExport({
    svg, g, downloadBtnId: ids.downloadSvg,
    data, personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  appendLinks(g, root);

  const node = g.append('g')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-width', 3)
    .selectAll('g')
    .data(root.descendants())
    .join('g')
      .attr('transform', d => `translate(${d.y},${d.x})`);

  // Family nodes: a ⚭ glyph + the partner / marriage info as a clickable
  // family-search link.
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

  // Person nodes get the standard person decoration.
  const personNode = node.filter(d => !d.data.is_family);
  decoratePersonNodes(personNode, contributorName);

  appendDescendantFamilyLinks(node, contributorName);
}

// Family-side info text + clickable link beside the ⚭ glyph.
function appendDescendantFamilyLinks(node, contributorName) {
  const familyNode = node.filter(d => d.data.is_family);

  const familyLink = familyNode.append(d => {
    const person = d.parent.data;
    const partner = d.data.partner;
    const pPriv = isPrivate(person.name) || isPrivate(person.surname);
    const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
    return document.createElementNS('http://www.w3.org/2000/svg', (pPriv || partPriv) ? 'g' : 'a');
  })
    .attr('href', d => {
      const person = d.parent.data;
      const partner = d.data.partner;
      const pPriv = isPrivate(person.name) || isPrivate(person.surname);
      const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
      if (pPriv || partPriv) return null;

      const params = new URLSearchParams();
      params.set('t', 'family');

      const personIsHusband = person.sex === 'm' || (person.sex !== 'f' && !partner.sex);
      const husband = personIsHusband ? person : partner;
      const wife    = personIsHusband ? partner : person;
      if (husband.name)          params.set('hn',  husband.name);
      if (husband.surname)       params.set('hsn', husband.surname);
      if (husband.date_of_birth) params.set('hb',  husband.date_of_birth);
      if (wife.name)             params.set('wn',  wife.name);
      if (wife.surname)          params.set('wsn', wife.surname);
      if (wife.date_of_birth)    params.set('wb',  wife.date_of_birth);

      if (d.data.marriage) {
        if (d.data.marriage.date)  params.set('dom', d.data.marriage.date);
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
    const date = m.date || '';
    const place = m.place ? m.place.split(',')[0].trim() : '';

    let firstLine = true;
    if (partnerName) {
      const isPriv = isPrivate(p.name) || isPrivate(p.surname);
      el.append('tspan').attr('x', 14).attr('font-weight', isPriv ? 'normal' : 'bold').text(partnerName);
      firstLine = false;
    }
    if (date) {
      el.append('tspan').attr('x', 14).attr('dy', firstLine ? '0' : '1.2em').text(date);
      firstLine = false;
    }
    if (place) {
      el.append('tspan').attr('x', 14).attr('dy', firstLine ? '0' : '1.2em').text(place);
    }
  });

  familyText.clone(true).lower().attr('stroke', 'white');
}
