import { boundsFromPoints, appendLinks, decoratePersonNodes, horizontalLinkPath } from './shared.js';
import { appendAncestorMarriageNodes } from './ancestors.js';
import { decorateDescendantFamilies } from './descendants.js';

// "Tree" chart: the compact tidy layout (d3.tree). Ancestors and descendants
// grow to the right of the focus person; in a bowtie the ancestors side is
// mirrored to the left so both share the person at the origin.
//
// Every layout module exports one function `(sides, opts) → view` where
// `sides` is { anc, desc } (d3 hierarchies from data.js, either may be null)
// and the view is:
//   nodes, links   — everything to draw / show on the minimap
//   bounds         — svg.js bounds (minX/maxX horizontal, minY/maxY vertical)
//   anchor         — 'left' | 'center' initial view (see createSvgWithZoom)
//   anchorNode     — the focus person's node
//   linkPath       — path generator for minimap links
//   draw(g, ctx)   — renders into the zoomable <g>; ctx = { contributorName }
// Layouts write SCREEN coordinates into d.x (vertical) / d.y (horizontal), the
// convention the shared chrome relies on.
// d3 is loaded globally from the CDN, so it isn't imported.

export const DX = 120;  // vertical spacing between sibling rows
export const DY = 250;  // horizontal spacing between generations

export function layoutTree(sides, { dir }) {
  const { anc, desc } = sides;
  if (anc) {
    d3.tree().nodeSize([DX, DY])(anc);
    if (dir === 'both') anc.each(d => { d.y = -d.y; });
  }
  if (desc) {
    d3.tree().nodeSize([DX, DY])(desc);
    snapDescendantColumns(desc);
  }
  return cartesianView(sides, { dir });
}

// Family nodes sit between generations in the descendants hierarchy; snap
// persons to generation columns and pull each family in towards its person.
export function snapDescendantColumns(root) {
  root.each(d => {
    if (d.data.is_family) { d.y = d.gen * DY + 50; d.x = d.x + 35; }
    else d.y = d.gen * DY;
  });
}

// Assembles the view for a placement that keeps nodes on a horizontal
// generation axis with dot + text nodes. In a bowtie both
// hierarchies start with the focus person; it is drawn once, from the
// ancestors side, while the descendants root only contributes its links.
export function cartesianView(sides, { dir }) {
  const { anc, desc } = sides;
  const both = !!(anc && desc);
  const anchorNode = anc || desc;
  const nodes = [
    ...(anc ? anc.descendants() : []),
    ...(desc ? desc.descendants().filter(d => !(both && d === desc)) : []),
  ];
  const links = [...(anc ? anc.links() : []), ...(desc ? desc.links() : [])];
  const bounds = boundsFromPoints(nodes.map(d => [d.y, d.x]), { left: 150, right: 250, top: DX, bottom: DX });

  return {
    nodes,
    links,
    anchorNode,
    bounds,
    anchor: dir === 'both' ? 'center' : 'left',
    linkPath: horizontalLinkPath(),
    draw(g, ctx) {
      appendLinks(g, links);
      if (anc) appendAncestorMarriageNodes(g, anc, ctx.contributorName);

      const node = g.append('g')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-width', 3)
        .selectAll('g')
        .data(nodes)
        .join('g')
          .attr('transform', d => `translate(${d.y},${d.x})`);

      decorateDescendantFamilies(node, ctx.contributorName);
      decoratePersonNodes(node.filter(d => !d.data.is_family), ctx.contributorName);
    },
  };
}
