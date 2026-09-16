import {
  boundsFromPoints, sexTint, isNodePrivate, personHref, personLabel, birthPlaceShort,
} from './shared.js';
import { descendantFamilyHref, partnerLabel, isPartnerUnknown } from './descendants.js';
import { ancestorMarriageHref } from './ancestors.js';
import { isPrivate } from '../lib/utils.js';

// "Fan" chart (and "Circle" = fan with a full 360° arc): generations as
// concentric rings, people as wedges.
//   Ancestors — classic fan: each generation's ring is split into 2^gen equal
//   wedges and every ancestor sits in the wedge of its Ahnentafel slot, so a
//   missing parent leaves an empty wedge (never computed by leaf count). A
//   thin band under each parent pair carries their marriage date / place.
//   Descendants — wedge width follows the number of leaves below (d3.partition);
//   family nodes become thin bands carrying the partner / marriage.
//   Both sides share the ring radii (person ring + family band per
//   generation), so the halves of a bowtie line up.
//   Bowtie — ancestors fill the top half, descendants the bottom half.
// Angles follow d3.arc: radians, 0 at 12 o'clock, clockwise.
// d3 is loaded globally from the CDN, so it isn't imported.

const R0 = 70;        // focus-person disc radius
const RING = 118;     // person ring width
const FAM_RING = 34;  // family / marriage band width
const TAU = 2 * Math.PI;
const CHAR_W = 6.6;   // approx. glyph width at the 12px label size, for fitting
const GLYPH_MIN = 7;  // smallest font size a lone ⚭ is still legible at
const BOWTIE_GAP = 0.06;  // radians trimmed from each half at the horizontal axis (~3.5°)

// How wedges are painted and linked. The tree page uses the defaults (sex
// tints, links to the person / family search); the compare view swaps in its
// comparison-status palette and drops the links, since a wedge there opens the
// side-by-side detail panel instead.
const DEFAULT_DECOR = {
  fill: d => {
    if (d.data.is_family) return '#f3f3f3';
    if (isNodePrivate(d)) return '#ececec';
    return sexTint(d.data.sex);
  },
  // Colour of a wedge's first (name) line; null leaves it the body colour.
  nameFill: () => '#1a5f8f',
  href: (d, ctx) => wedgeHref(d, ctx.contributorName),
};

export function layoutFan(sides, { dir, arc, decor }) {
  const { anc, desc } = sides;
  const both = dir === 'both';
  const dec = { ...DEFAULT_DECOR, ...decor };

  // Angular window per side as [start, end] in fraction→angle terms. A single
  // fan opens upward from 9 to 3 o'clock, so the father's line is on the left
  // and the mother's on the right; the circle keeps that split (father's half
  // on the left, mother's on the right) by running from 6 o'clock clockwise
  // round to 6 o'clock. A bowtie keeps the ancestors fan in the top half and
  // mirrors the descendants into the bottom half (first child on the left, as
  // in the fan), with a small angular gap on each side of the horizontal axis
  // so the two halves read as separate fans.
  const single = arc === 360 ? [-Math.PI, Math.PI] : [-Math.PI / 2, Math.PI / 2];
  const ancWindow  = both ? [-Math.PI / 2 + BOWTIE_GAP, Math.PI / 2 - BOWTIE_GAP] : single;
  const descWindow = both ? [3 * Math.PI / 2 - BOWTIE_GAP, Math.PI / 2 + BOWTIE_GAP] : single;

  const ancBands = anc ? placeAncestors(anc, ancWindow) : [];
  if (desc) placeDescendants(desc, descWindow);

  const anchorNode = anc || desc;
  const nodes = [
    ...(anc ? anc.descendants() : []),
    ...ancBands,
    ...(desc ? desc.descendants().filter(d => !(anc && d === desc)) : []),
  ];

  // Bounds from the wedge outlines (outer-arc endpoints plus any axis
  // crossing inside the wedge), not just the centroids.
  const points = [[0, 0]];
  nodes.forEach(d => {
    const angles = [d.a0, d.a1];
    for (let k = Math.ceil(d.a0 / (Math.PI / 2)); k * (Math.PI / 2) < d.a1; k++) angles.push(k * (Math.PI / 2));
    angles.forEach(a => points.push([d.r1 * Math.sin(a), -d.r1 * Math.cos(a)]));
  });
  const bounds = boundsFromPoints(points, { left: 40, right: 40, top: 40, bottom: 40 });

  return {
    nodes,
    links: [],
    anchorNode,
    bounds,
    anchor: 'fit',
    linkPath: null,
    draw(g, ctx) { return drawWedges(g, nodes, ctx, dec); },
  };
}

// Converts a wedge's [f0, f1] share of a side's window into ascending angles.
function windowAngles(window, f0, f1) {
  const [s, e] = window;
  const x = s + f0 * (e - s);
  const y = s + f1 * (e - s);
  return x < y ? [x, y] : [y, x];
}

function setGeometry(d, a0, a1, r0, r1) {
  d.a0 = a0; d.a1 = a1; d.r0 = r0; d.r1 = r1;
  const aMid = (a0 + a1) / 2;
  const rMid = (r0 + r1) / 2;
  // Screen coordinates of the wedge centroid for the minimap / pan-to-node.
  d.y = rMid * Math.sin(aMid);
  d.x = -rMid * Math.cos(aMid);
}

// Outer radius of the person ring at generation g (every generation adds a
// family / marriage band plus a person ring). Shared by both sides.
const ringOuter = g => R0 + g * (FAM_RING + RING);

// Places the ancestor wedges and returns the synthetic marriage-band nodes:
// one per person with both parents known and a recorded marriage, spanning the
// person's own wedge (the union of the two parent wedges) just inside the
// parents' ring. Without marriage data there is nothing to put in the band, so
// the ring gap is left empty (the cartesian layout skips it the same way, and
// the compare view's merged trees never carry ancestor marriages).
function placeAncestors(root, window) {
  const bands = [];
  root.each(d => {
    const [a0, a1] = windowAngles(window, d.slotFrac0, d.slotFrac1);
    if (d.gen === 0) setGeometry(d, 0, TAU, 0, R0);
    else setGeometry(d, a0, a1, ringOuter(d.gen) - RING, ringOuter(d.gen));

    const marriage = d.data.parents_marriage;
    if (d.children && d.children.length === 2 && marriage) {
      const band = {
        gen: d.gen,
        side: 'anc',
        data: {
          is_family: true,
          is_marriage: true,
          marriage,
          husband: d.children[0].data,
          wife: d.children[1].data,
        },
      };
      setGeometry(band, a0, a1, ringOuter(d.gen), ringOuter(d.gen) + FAM_RING);
      bands.push(band);
    }
  });
  return bands;
}

function placeDescendants(root, window) {
  root.count();
  d3.partition().size([1, 1])(root);
  root.each(d => {
    if (d.gen === 0 && !d.data.is_family) { setGeometry(d, 0, TAU, 0, R0); return; }
    const [a0, a1] = windowAngles(window, d.x0, d.x1);
    if (d.data.is_family) {
      setGeometry(d, a0, a1, ringOuter(d.gen), ringOuter(d.gen) + FAM_RING);
    } else {
      setGeometry(d, a0, a1, ringOuter(d.gen) - RING, ringOuter(d.gen));
    }
  });
}

// --- Drawing -----------------------------------------------------------------

const deg = rad => (rad * 180 / Math.PI) % 360;

function wedgeHref(d, contributorName) {
  if (d.data.is_marriage) return ancestorMarriageHref(d.data.husband, d.data.wife, d.data.marriage, contributorName);
  if (d.data.is_family) return descendantFamilyHref(d.parent.data, d.data.partner, d.data.marriage, contributorName);
  return personHref(d, contributorName);
}

// Text lines for a wedge: [main, ...info]. Ancestor marriage bands show the
// marriage date and place; descendant family bands the partner and the
// marriage date; persons show name, birth date, birth place.
function wedgeLines(d) {
  if (d.data.is_marriage) {
    const m = d.data.marriage;
    const place = m.place ? m.place.split(',')[0].trim() : '';
    return [`⚭ ${m.date || ''}`.trim(), place].filter(Boolean);
  }
  if (d.data.is_family) {
    const p = d.data.partner;
    const m = d.data.marriage || {};
    return [`⚭ ${partnerLabel(p)}`, m.date || ''].filter(Boolean);
  }
  return [personLabel(d) || '?', d.data.date_of_birth || '', birthPlaceShort(d)].filter(Boolean);
}

const yearOf = date => ((date || '').match(/\d{4}/g) || []).pop() || '';

// Progressively poorer versions of a marriage band's text, richest first. The
// thin bands rarely fit their full text, and a cut-off "⚭ Ma…" says nothing —
// so they drop detail instead of ellipsizing, down to the bare ⚭ ring, and the
// tooltip keeps everything. Person wedges keep their one (ellipsizable)
// variant: a shortened name still identifies someone.
function wedgeVariants(d) {
  if (d.data.is_marriage) {
    const m = d.data.marriage;
    const date = (m.date || '').trim();
    const place = m.place ? m.place.split(',')[0].trim() : '';
    return dropRepeats([
      [`⚭ ${date}`.trim(), place],
      [`⚭ ${date}`.trim()],
      [`⚭ ${yearOf(date)}`.trim()],
      ['⚭'],
    ]);
  }
  if (d.data.is_family) {
    const p = d.data.partner;
    const date = ((d.data.marriage || {}).date || '').trim();
    const full = partnerLabel(p);
    const short = isPartnerUnknown(p) ? '' : (p.surname || p.name || '');
    return dropRepeats([
      [`⚭ ${full}`, date],
      [`⚭ ${full}`],
      [`⚭ ${short}`.trim()],
      ['⚭'],
    ]);
  }
  return [wedgeLines(d)];
}

// Drops empty lines, then variants that ended up identical to an earlier one.
function dropRepeats(variants) {
  const out = [];
  variants.map(v => v.filter(Boolean)).forEach(v => {
    if (v.length && out.every(prev => prev.join('\n') !== v.join('\n'))) out.push(v);
  });
  return out;
}

// Everything the wedge knows, for the hover tooltip — full places and the
// details the wedge itself had no room for.
function wedgeTitle(d) {
  if (d.data.is_marriage) {
    const m = d.data.marriage;
    return [`⚭ ${m.date || ''}`.trim(), m.place || ''].filter(Boolean).join(' · ');
  }
  if (d.data.is_family) {
    const m = d.data.marriage || {};
    return [`⚭ ${partnerLabel(d.data.partner)}`, m.date || '', m.place || ''].filter(Boolean).join(' · ');
  }
  return [personLabel(d) || '?', d.data.date_of_birth || '', d.data.place_of_birth || ''].filter(Boolean).join(' · ');
}

function isTextPrivate(d) {
  if (d.data.is_marriage) {
    const { husband: h, wife: w } = d.data;
    return isPrivate(h.name) || isPrivate(h.surname) || isPrivate(w.name) || isPrivate(w.surname);
  }
  if (d.data.is_family) {
    const p = d.data.partner;
    return isPartnerUnknown(p) || isPrivate(p?.name) || isPrivate(p?.surname);
  }
  return isNodePrivate(d);
}

// Truncates a line to what fits in `width` px at the label font size.
function fit(text, width) {
  const max = Math.floor(width / CHAR_W);
  if (max < 2) return '';
  return text.length <= max ? text : text.slice(0, Math.max(1, max - 1)) + '…';
}

const fitsWhole = (text, width) => text.length * CHAR_W <= width;

// The lines to actually draw, given at most `maxLines` rows and `widthOf(i, n)`
// px available for line i of an n-line block (both already normalised to the
// 12px reference size). Marriage bands take the richest variant that fits
// whole — or nothing, if not even a ⚭ fits; persons take their single variant,
// ellipsized.
function chooseLines(d, maxLines, widthOf) {
  const variants = wedgeVariants(d);
  if (!d.data.is_family) {
    const lines = variants[0].slice(0, maxLines);
    return lines.map((l, i) => fit(l, widthOf(i, lines.length))).filter(Boolean);
  }
  for (const variant of variants) {
    const lines = variant.slice(0, maxLines);
    if (lines.every((l, i) => fitsWhole(l, widthOf(i, lines.length)))) return lines;
  }
  return [];
}

function drawWedges(g, nodes, ctx, dec) {
  const arcGen = d3.arc()
      .startAngle(d => d.a0).endAngle(d => d.a1)
      .innerRadius(d => d.r0).outerRadius(d => d.r1);

  const node = g.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g');

  // On the group, not the wedge path, so the tooltip also shows over the label
  // — which is where a band that had to drop detail needs it most.
  node.append('title')
      .text(wedgeTitle);

  node.append('path')
      .attr('d', arcGen)
      .attr('fill', dec.fill)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5);

  const hrefOf = d => dec.href(d, ctx);
  const label = node.append(d =>
      document.createElementNS('http://www.w3.org/2000/svg', hrefOf(d) ? 'a' : 'g'))
    .attr('href', hrefOf)
    .attr('data-spa-nav', d => hrefOf(d) ? '' : null);

  // textPath needs element ids; keep them unique across re-renders and inside
  // an exported SVG.
  const idPrefix = `fan${Date.now().toString(36)}`;
  let idSeq = 0;

  label.each(function(d) {
    const el = d3.select(this);
    const isRoot = d.r0 === 0;
    const aMid = (d.a0 + d.a1) / 2;
    const rMid = (d.r0 + d.r1) / 2;
    const arcLen = (d.a1 - d.a0) * rMid;
    const depth = d.r1 - d.r0;
    const priv = isTextPrivate(d);
    const isName = i => i === 0 && !priv && !d.data.is_family;
    const lineStyle = (sel, i) => sel
        .attr('font-weight', isName(i) ? 'bold' : 'normal')
        .attr('fill', isName(i) ? dec.nameFill(d) : null);
    const baseFill = d.data.is_family ? '#555' : (priv ? '#555' : '#1f2d3d');

    // Root: plain centred text. Otherwise the text follows the ring (curved
    // along an arc) when the wedge is wider than it is deep, else runs along
    // the radius.
    if (isRoot) {
      const width = 2 * R0 * 0.9, height = 2 * R0 * 0.9;
      const size = 12, lineH = size * 1.2;
      const fitted = chooseLines(d, Math.floor(height / lineH), () => width);
      const text = el.append('text').attr('text-anchor', 'middle').attr('font-size', `${size}px`).attr('fill', baseFill);
      fitted.forEach((line, i) => lineStyle(text.append('tspan')
          .attr('x', 0)
          .attr('dy', i === 0 ? `${0.35 - 0.6 * (fitted.length - 1)}em` : '1.2em'), i).text(line));
      return;
    }

    if (arcLen >= depth) {
      // Curved: one arc path per line, the text centred on it. In the bottom
      // half the path runs the other way so the text stays upright, which also
      // puts the first line nearest the reader's "top" (the centre side).
      const a = ((deg(aMid) % 360) + 360) % 360;
      const flip = a > 90 && a < 270;
      const height = depth * 0.85;
      const size = arcLen < 70 ? 10 : 12;
      const lineH = size * 1.2;
      // Radius of line i of an n-line block: stacked outward→inward for upright
      // wedges, inward→outward when flipped.
      const radiusOf = (i, n) => flip ? rMid - ((n - 1) / 2 - i) * lineH : rMid + ((n - 1) / 2 - i) * lineH;
      const widthOf = (i, n) => (d.a1 - d.a0) * radiusOf(i, n) * 0.9 * (12 / size);
      const lines = chooseLines(d, Math.max(1, Math.floor(height / lineH)), widthOf);
      const n = lines.length;
      lines.forEach((line, i) => {
        const r = radiusOf(i, n);
        const id = `${idPrefix}-${++idSeq}`;
        el.append('path')
            .attr('id', id)
            .attr('fill', 'none')
            .attr('d', arcPath(r, d.a0, d.a1, flip));
        const text = el.append('text')
            .attr('font-size', `${size}px`)
            .attr('fill', baseFill)
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central');
        lineStyle(text.append('textPath')
            .attr('href', `#${id}`)
            .attr('xlink:href', `#${id}`)
            .attr('startOffset', '50%'), i).text(line);
      });
      return;
    }

    // Radial: straight text along the radius, flipped on the left so it
    // reads outward-to-inward but upright.
    const a = ((deg(aMid) % 360) + 360) % 360;
    const flip = a > 180;
    const transform = `rotate(${a - 90}) translate(${rMid},0) rotate(${flip ? 180 : 0})`;
    const width = depth * 0.9, height = arcLen * 0.85;
    if (width < 2 * CHAR_W || height < 11) {
      // Too thin for a line of text. A marriage band still marks itself with a
      // ⚭ shrunk to the band's width — the ring is the information, the
      // tooltip has the rest — while a person wedge stays blank.
      if (!d.data.is_family) return;
      const size = Math.min(12, Math.floor(height));
      if (size < GLYPH_MIN || width < GLYPH_MIN) return;
      el.append('text')
          .attr('transform', transform)
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', `${size}px`)
          .attr('fill', baseFill)
          .text('⚭');
      return;
    }
    const size = width < 70 ? 10 : 12;
    const lineH = size * 1.2;
    const fitted = chooseLines(d, Math.max(1, Math.floor(height / lineH)), () => width * (12 / size));
    if (!fitted.length) return;
    const text = el.append('text')
        .attr('transform', transform)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${size}px`)
        .attr('fill', baseFill);
    fitted.forEach((line, i) => lineStyle(text.append('tspan')
        .attr('x', 0)
        .attr('dy', i === 0 ? `${0.35 - 0.6 * (fitted.length - 1)}em` : '1.2em'), i).text(line));
  });

  return node;
}

// SVG arc from angle a0 to a1 at radius r (d3 angles: 0 at 12 o'clock,
// clockwise). `reverse` runs it counter-clockwise so text on it stays upright
// in the bottom half.
function arcPath(r, a0, a1, reverse) {
  const pt = a => `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  return reverse
    ? `M ${pt(a1)} A ${r} ${r} 0 ${large} 0 ${pt(a0)}`
    : `M ${pt(a0)} A ${r} ${r} 0 ${large} 1 ${pt(a1)}`;
}
