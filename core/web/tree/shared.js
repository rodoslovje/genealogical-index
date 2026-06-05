import { toUnicodeSearch } from '../lib/url.js';
import { isPrivate } from '../lib/utils.js';

// Person-node rendering helpers shared by the ancestors and descendants trees,
// plus a barrel that re-exports the layout/SVG, CSV, and GEDCOM modules so
// callers can keep importing everything tree-related from './shared.js'.
// d3 is loaded globally from the CDN (see ensureD3), so it isn't imported.

export * from './svg.js';
export * from './csv.js';
export * from './gedcom.js';

// Picks (husband, wife) from two individuals using whatever sex info exists,
// falling back to the given order when neither side is determinative.
export function orderSpouses(a, b) {
  if (a && a.sex === 'm') return [a, b];
  if (a && a.sex === 'f') return [b, a];
  if (b && b.sex === 'f') return [a, b];
  if (b && b.sex === 'm') return [b, a];
  return [a, b];
}

// Horizontal link paths between parent/child nodes — identical in both trees.
export function appendLinks(g, root) {
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
    if (d.data.ext_id) params.set('id', d.data.ext_id);
    params.set('ex', '1');
    return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
  };
}

// Appends circle + clickable name + birth/place info text to a person-node
// selection. Used by both trees.
export function decoratePersonNodes(selection, contributorName) {
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
