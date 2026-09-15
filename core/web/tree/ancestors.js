import { isPrivate } from '../lib/utils.js';
import { toUnicodeSearch } from '../lib/url.js';
import { orderSpouses, personRow } from './shared.js';

// Ancestors-specific pieces: the CSV / GEDCOM walkers over the raw API tree and
// the marriage glyph drawn between a node's two parents in the tree layout. Layout and chrome live in the layout modules / svg.js.
// d3 is loaded globally from the CDN, so it isn't imported.

// Flattens the ancestors tree into one CSV row per person. Generation 0 is the
// focus person; each step up the tree (parents, grandparents, …) increments it.
// A person's marriage is their union with their co-parent, so for any node with
// two parents that node's `parents_marriage` (plus the other parent as partner)
// is attached to each of the two parent rows.
export function buildAncestorRows(rootData) {
  const rows = [];

  // `partner`/`marriage` describe THIS node's union, as determined by its child.
  const walk = (node, generation, partner, marriage) => {
    rows.push(personRow(node, generation, partner, marriage));
    const parents = node.parents || [];
    const m = node.parents_marriage || null;
    if (parents.length === 2) {
      walk(parents[0], generation + 1, parents[1], m);
      walk(parents[1], generation + 1, parents[0], m);
    } else if (parents.length === 1) {
      walk(parents[0], generation + 1, null, null);
    }
  };

  walk(rootData, 0, null, null);
  return rows;
}

// Adds the ancestors tree to a GEDCOM model whose focus person is already
// `rootIndi`. For each node with parents we create the parents' family (with
// the node as a CHIL) and carry that node's `parents_marriage` onto the FAM's
// MARR. A node with a single known parent still yields a one-spouse family.
// Shared with the descendants walker so a bowtie export emits the focus person
// once.
export function addAncestorsToGedcom(model, rootData, rootIndi) {
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

// Family-search URL for the marriage of a node's two parents, or null when
// either parent is private.
export function ancestorMarriageHref(husband, wife, marriage, contributorName) {
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
  if (marriage?.date)        params.set('dom', marriage.date);
  if (contributorName)       params.set('c',   contributorName);
  params.set('ex', '1');
  return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
}

// Marriage rendering for the tree layout: between the two parents of any node
// that has both, show a ⚭ glyph + marriage date/place, linked to the family
// search where possible. Positioned at the parents' column, level with the
// child, around which the tidy tree places the parents symmetrically.
export function appendAncestorMarriageNodes(g, root, contributorName) {
  const marriageNode = g.append('g')
    .selectAll('g')
    .data(root.descendants().filter(d => d.children && d.children.length === 2 && d.data.parents_marriage))
    .join('g')
      .attr('transform', d => `translate(${d.children[0].y},${d.x})`);

  const hrefOf = d => ancestorMarriageHref(d.children[0].data, d.children[1].data, d.data.parents_marriage, contributorName);

  const marriageLink = marriageNode.append(d =>
      document.createElementNS('http://www.w3.org/2000/svg', hrefOf(d) ? 'a' : 'g'))
    .attr('href', hrefOf)
    .attr('data-spa-nav', d => hrefOf(d) ? '' : null);

  const marriageText = marriageLink.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', d => hrefOf(d) ? '#3498db' : '#555');

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
