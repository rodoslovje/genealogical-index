import { isPrivate } from '../utils.js';
import { toUnicodeSearch } from '../url.js';
import { computeBounds, createSvgWithZoom, attachSvgExport, attachCsvExport, attachGedExport, createGedcomModel, orderSpouses, marriageRow, appendLinks, decoratePersonNodes } from './shared.js';

export function renderD3AncestorsTree(data, container, personName, contributorName, ids, exportOpts) {
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
  const { svg, g } = createSvgWithZoom(container, bounds, root, ids);

  attachSvgExport({
    svg, g, downloadBtnId: ids.downloadSvg,
    data, personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  attachCsvExport({
    downloadBtnId: ids.downloadCsv,
    buildRows: () => buildAncestorRows(data),
    personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  attachGedExport({
    downloadBtnId: ids.downloadGed,
    buildModel: () => buildAncestorGedcom(data),
    personName,
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

// Flattens the ancestors tree into CSV rows using the husband/wife layout of the
// families export. Generation 0 is the focus person (a lone row, since their
// spouse isn't part of an ancestors view); every node with parents then yields
// one couple row (husband, wife, marriage) at the next generation up. Each
// ancestor therefore appears exactly once — as a spouse in their child's couple
// row — without the duplication a per-person layout would produce.
function buildAncestorRows(rootData) {
  const rows = [];
  rows.push(marriageRow({ personA: rootData, personB: null, marriage: null, generation: 0 }));

  const walk = (node, generation) => {
    const parents = node.parents || [];
    if (!parents.length) return;
    rows.push(marriageRow({
      personA: parents[0],
      personB: parents[1] || null,
      marriage: node.parents_marriage,
      generation: generation + 1,
    }));
    parents.forEach(p => walk(p, generation + 1));
  };

  walk(rootData, 0);
  return rows;
}

// Builds a GEDCOM model from the ancestors tree. Every node is an individual;
// for each node with parents we create the parents' family (with the node as a
// CHIL) and carry that node's `parents_marriage` onto the FAM's MARR. A node
// with a single known parent still yields a one-spouse family.
function buildAncestorGedcom(rootData) {
  const model = createGedcomModel();
  const rootIndi = model.addIndividual(rootData);

  const walk = (node, indi) => {
    const parents = node.parents || [];
    if (!parents.length) return;
    const parentIndis = parents.map(p => model.addIndividual(p));

    let husband = null;
    let wife = null;
    if (parentIndis.length === 2) {
      [husband, wife] = orderSpouses(parentIndis[0], parentIndis[1]);
    } else if (parentIndis[0].sex === 'f') {
      wife = parentIndis[0];
    } else {
      husband = parentIndis[0];
    }

    const fam = model.addFamily(husband, wife, node.parents_marriage);
    fam.children.push(indi.id);
    indi.famc = fam.id;

    parents.forEach((p, i) => walk(p, parentIndis[i]));
  };

  walk(rootData, rootIndi);
  return model;
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
