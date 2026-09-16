import { toUnicodeSearch } from '../lib/url.js';
import { t } from '../i18n.js';
import { downloadBlob, formatExportFilename } from '../lib/utils.js';
import { exportDateStr } from '../lib/csv.js';
import siteConfig from '@site-config';

// Zoom/minimap chrome and SVG export — shared by every tree layout and the
// compare view. d3 is loaded globally from the CDN (see ensureD3), so it isn't
// imported here. Re-exported via tree/shared.js.
//
// Coordinate convention (inherited from d3.tree): `d.x` is VERTICAL and `d.y`
// is HORIZONTAL screen position. Bounds use minX/maxX for the horizontal
// extent and minY/maxY for the vertical one. Every layout writes screen
// coordinates into d.x/d.y so this chrome works for all of them.

// Bounds around a list of [horizontal, vertical] points, padded per side.
export function boundsFromPoints(points, { left = 0, right = 0, top = 0, bottom = 0 } = {}) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [h, v] of points) {
    if (h < minX) minX = h;
    if (h > maxX) maxX = h;
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  if (!isFinite(minX)) { minX = maxX = minY = maxY = 0; }
  minX -= left; maxX += right; minY -= top; maxY += bottom;
  return { minX, minY, maxX, maxY, treeWidth: maxX - minX, treeHeight: maxY - minY };
}

// `root` is the node the initial view anchors on (and, unless opts.nodes /
// opts.links are given, the hierarchy the minimap draws). Options:
//   nodes, links — explicit node list / {source,target} links for the minimap
//                  (layouts that draw several hierarchies or none pass these);
//   linkPath     — path generator for minimap links (default: horizontal cubic);
//   anchor       — 'left' (root near the left border, tree grows right),
//                  'center' (root in the middle at 1×: bowtie) or 'fit' (whole
//                  chart visible: fan, circle);
//   nodeColor    — overrides the sex-based minimap dot colour.
export function createSvgWithZoom(container, bounds, root, ids, opts = {}) {
  const width = container.clientWidth || 900;
  const height = container.clientHeight || 500;

  const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'width: 100%; height: 100%; font: 14px sans-serif; cursor: grab;');
  const g = svg.append('g');

  const minScale = Math.min(1, width / bounds.treeWidth, height / bounds.treeHeight);
  // 'fit' starts zoomed out so the whole chart is visible (radial charts read
  // as a shape first); the others start at 1× on the root so the names are
  // legible immediately.
  const initialScale = opts.anchor === 'fit' ? minScale : Math.max(minScale, 1);

  // Relax the translate extent by ~half a viewport on each side. Without
  // this, the root (which sits at the left edge of the tree's natural
  // bounds) gets pinned to the left edge of the wrapper when we try to
  // center it at scale 1×. Slightly more pan-headroom is fine; the
  // alternative (centering the *content*) pushes the root off-screen on
  // deep ancestor/descendant trees.
  const halfVw = (width / initialScale) / 2;
  const halfVh = (height / initialScale) / 2;
  const extent = [
    [Math.min(bounds.minX, -halfVw), Math.min(bounds.minY, -halfVh)],
    [Math.max(bounds.maxX, halfVw), Math.max(bounds.maxY, halfVh)],
  ];
  const zoom = d3.zoom()
      .scaleExtent([minScale, 4])
      .translateExtent(extent)
      .on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);

  // Initial view. 'left': anchor the root node near the left border,
  // vertically centered, so the branches (which expand to the right) fill the
  // rest of the viewport; a small left margin keeps the centered name label
  // from being clipped against the edge. 'center': root in the middle of the
  // viewport (layouts that grow in every direction). 'fit': the whole chart
  // centered at the fitting scale.
  let tx, ty;
  if (root && opts.anchor === 'fit') {
    tx = width / 2 - (bounds.minX + bounds.treeWidth / 2) * initialScale;
    ty = height / 2 - (bounds.minY + bounds.treeHeight / 2) * initialScale;
  } else if (root && opts.anchor === 'center') {
    tx = width / 2 - root.y * initialScale;
    ty = height / 2 - root.x * initialScale;
  } else if (root) {
    const leftMargin = 120;
    tx = leftMargin - root.y * initialScale;
    ty = height / 2 - root.x * initialScale;
  } else {
    tx = width / 2 - (bounds.minX + bounds.treeWidth / 2) * initialScale;
    ty = height / 2 - (bounds.minY + bounds.treeHeight / 2) * initialScale;
  }
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(initialScale));

  d3.select(`#${ids.zoomIn}`).on('click', null).on('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1.3));
  d3.select(`#${ids.zoomOut}`).on('click', null).on('click', () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3));

  // Minimap on desktop and large-tablet sized viewports. Below ~1024px the
  // overlay would just steal real-estate from the tree itself.
  if (root && ids.wrapper && window.innerWidth >= 1024) {
    const mmNodes = opts.nodes || root.descendants();
    const mmLinks = opts.links || root.links();
    const updateMinimap = addMinimap(ids.wrapper, mmNodes, mmLinks, opts.linkPath, bounds, width, height, svg, zoom, opts.nodeColor);
    zoom.on('zoom.minimap', (e) => updateMinimap(e.transform));
    updateMinimap(d3.zoomTransform(svg.node()));
  }

  // Smoothly recenter the view on a laid-out node (d.x vertical, d.y horizontal),
  // zooming in to at least 1× so the target is legible. Used by the compare
  // view's "jump to person" list.
  function panToNode(node, targetScale) {
    if (!node) return;
    const k = targetScale || Math.max(d3.zoomTransform(svg.node()).k, 1);
    const tx = width / 2 - node.y * k;
    const ty = height / 2 - node.x * k;
    svg.transition().duration(500).call(
      zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k)
    );
  }

  return { svg, g, panToNode };
}

// Small top-left overview that shows the entire tree plus a rectangle
// indicating the currently visible portion of the main view. Clicking the
// minimap re-centers the main view at the chosen tree coordinate.
// Returns an `update(transform)` callback the caller must invoke whenever
// the main view's zoom transform changes.
// `nodeColor(d)` optionally overrides the default sex-based dot/ring colour
// (compare mode passes the comparison-status palette). `linkPath` is the path
// generator for the simplified links (default: horizontal cubic).
function addMinimap(wrapperId, nodes, links, linkPath, bounds, viewWidth, viewHeight, mainSvg, zoom, nodeColor) {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return () => {};

  // Clear any leftover minimap from a prior render of this page.
  wrapper.querySelectorAll('.tree-minimap').forEach(el => el.remove());

  const maxMmSize = 200;
  const mmPad = 6;

  const treeW = Math.max(bounds.treeWidth, 1);
  const treeH = Math.max(bounds.treeHeight, 1);
  const treeAspect = treeW / treeH;

  // Fit the tree into a maxMmSize box, preserving aspect ratio.
  let mmContentWidth, mmContentHeight;
  if (treeAspect > 1) {
    mmContentWidth = maxMmSize - mmPad * 2;
    mmContentHeight = mmContentWidth / treeAspect;
  } else {
    mmContentHeight = maxMmSize - mmPad * 2;
    mmContentWidth = mmContentHeight * treeAspect;
  }

  // A very tall/wide tree would otherwise collapse the minimap to a useless
  // sliver. Guarantee a minimum width and let the height grow to keep the
  // aspect ratio, capped (relative to the viewport) so it can't run off-screen.
  const minMmContentWidth = 90;
  const maxMmContentHeight = Math.max(maxMmSize, Math.min(viewHeight * 0.8, 500)) - mmPad * 2;
  if (mmContentWidth < minMmContentWidth) {
    mmContentWidth = minMmContentWidth;
    mmContentHeight = Math.min(mmContentWidth / treeAspect, maxMmContentHeight);
  }

  const mmWidth = mmContentWidth + mmPad * 2;
  const mmHeight = mmContentHeight + mmPad * 2;
  // Uniform "contain" scale; identical to width-fit in the normal case, but
  // when the height cap clamps a sliver-thin tree it keeps the whole tree
  // visible (centered) inside the min-width box rather than clipping it.
  const mmScale = Math.min(mmContentWidth / treeW, mmContentHeight / treeH);

  const offsetX = mmPad + (mmContentWidth - treeW * mmScale) / 2;
  const offsetY = mmPad + (mmContentHeight - treeH * mmScale) / 2;

  const mm = d3.select(wrapper).append('svg')
      .attr('class', 'tree-minimap')
      .attr('width', mmWidth)
      .attr('height', mmHeight);

  // Tree origin maps to the computed centered offsets
  const mmG = mm.append('g')
      .attr('transform', `translate(${offsetX - bounds.minX * mmScale}, ${offsetY - bounds.minY * mmScale}) scale(${mmScale})`);

  // Simplified links — stroke width compensates for the scale so it
  // stays ~1px on screen regardless of how zoomed-out the tree is.
  mmG.append('g')
      .attr('fill', 'none')
      .attr('stroke', '#bbb')
      .attr('stroke-width', 1 / mmScale)
    .selectAll('path')
    .data(links)
    .join('path')
      .attr('d', linkPath || d3.linkHorizontal().x(d => d.y).y(d => d.x));

  // Person nodes as small coloured dots; family nodes (partners) as rings of
  // the same size — the ⚭ glyph is illegible at minimap scale, but skipping
  // them entirely makes the map look broken when a person has a partner.
  mmG.append('g')
    .selectAll('circle')
    .data(nodes.filter(d => !d.data.is_family))
    .join('circle')
      .attr('cx', d => d.y)
      .attr('cy', d => d.x)
      .attr('r', 4 / mmScale)
      .attr('fill', d => nodeColor ? nodeColor(d) : (d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999')));

  mmG.append('g')
    .selectAll('circle')
    .data(nodes.filter(d => d.data.is_family))
    .join('circle')
      .attr('cx', d => d.y)
      .attr('cy', d => d.x)
      // Stroke straddles the path, so subtract half its width to match the
      // filled person dot's outer radius (4) rather than ending up larger.
      .attr('r', (4 - 0.75) / mmScale)
      .attr('fill', 'none')
      .attr('stroke', d => {
        if (nodeColor) return nodeColor(d);
        const sex = d.data.partner?.sex;
        return sex === 'm' ? '#3498db' : (sex === 'f' ? '#e83e8c' : '#999');
      })
      .attr('stroke-width', 1.5 / mmScale);

  // Viewport rectangle, drawn on top of the minimap content.
  const viewport = mm.append('rect')
      .attr('class', 'tree-minimap-viewport')
      .attr('fill', 'rgba(52, 152, 219, 0.18)')
      .attr('stroke', '#3498db')
      .attr('stroke-width', 1.5)
      .attr('pointer-events', 'none');

  // Click-to-pan: clicking anywhere on the minimap re-centers the main
  // view at the corresponding tree position, preserving the current zoom.
  mm.style('cursor', 'pointer').on('click', (event) => {
    const [mx, my] = d3.pointer(event, mm.node());
    const treeY = (mx - offsetX) / mmScale + bounds.minX;
    const treeX = (my - offsetY) / mmScale + bounds.minY;
    const current = d3.zoomTransform(mainSvg.node());
    const k = current.k;
    const newTx = viewWidth / 2 - treeY * k;
    const newTy = viewHeight / 2 - treeX * k;
    mainSvg.transition().duration(300).call(
      zoom.transform,
      d3.zoomIdentity.translate(newTx, newTy).scale(k)
    );
  });

  return function update(transform) {
    const k = transform.k;
    // Visible tree rect in tree coordinates (note: d3.tree rotates so y is
    // horizontal, x is vertical).
    const treeHorizMin = (0 - transform.x) / k;
    const treeHorizMax = (viewWidth - transform.x) / k;
    const treeVertMin  = (0 - transform.y) / k;
    const treeVertMax  = (viewHeight - transform.y) / k;

    // Map to minimap pixels, clamped to the bounds so the rectangle
    // never extends past the minimap edges when the view is zoomed out.
    const x0 = Math.max(0, offsetX + (treeHorizMin - bounds.minX) * mmScale);
    const y0 = Math.max(0, offsetY + (treeVertMin  - bounds.minY) * mmScale);
    const x1 = Math.min(mmWidth, offsetX + (treeHorizMax - bounds.minX) * mmScale);
    const y1 = Math.min(mmHeight, offsetY + (treeVertMax  - bounds.minY) * mmScale);

    viewport
      .attr('x', x0)
      .attr('y', y0)
      .attr('width',  Math.max(0, x1 - x0))
      .attr('height', Math.max(0, y1 - y0));
  };
}

// --- Export legend ----------------------------------------------------------
// An optional band of coloured swatches drawn between the diagram and the
// footer, so an exported comparison carries the same key as the page does.

const LEGEND_SWATCH_R = 6;   // matches the 12px round .compare-swatch
const LEGEND_GAP = 8;        // swatch → label
const LEGEND_ITEM_GAP = 24;  // between entries
const LEGEND_ROW_H = 22;
const LEGEND_PAD = 14;       // above the first row / below the last

// One entry's text: "<label> (<count>)", the count bold as in the HTML legend.
function legendLabel(sel, item) {
  const text = sel.append('text')
      .attr('font-size', '14px')
      .attr('fill', '#333');
  text.append('tspan').text(item.label);
  if (item.count != null) text.append('tspan').attr('font-weight', 'bold').text(` (${item.count})`);
  return text;
}

// Drawn width of every entry. Text has to be in the DOM to be measurable, so
// the probe is appended hidden and removed before anything else is drawn.
function measureLegend(svg, items) {
  if (!items || !items.length) return [];
  const probe = svg.append('g').attr('visibility', 'hidden');
  const measured = items.map(item => ({
    item,
    width: LEGEND_SWATCH_R * 2 + LEGEND_GAP + legendLabel(probe, item).node().getComputedTextLength(),
  }));
  probe.remove();
  return measured;
}

// Greedy packing into rows no wider than `maxWidth`.
function packLegend(measured, maxWidth) {
  const rows = [];
  let row = [], rowWidth = 0;
  measured.forEach(m => {
    const advance = row.length ? LEGEND_ITEM_GAP + m.width : m.width;
    if (row.length && rowWidth + advance > maxWidth) {
      rows.push(row);
      row = []; rowWidth = 0;
    }
    rowWidth += row.length ? advance : m.width;
    row.push(m);
  });
  if (row.length) rows.push(row);
  return rows;
}

// Each row centred in the export width, swatch and label on one baseline.
function drawLegend(overlay, rows, centerX, top) {
  rows.forEach((row, ri) => {
    const rowWidth = row.reduce((sum, m) => sum + m.width, 0) + LEGEND_ITEM_GAP * (row.length - 1);
    const yc = top + ri * LEGEND_ROW_H + LEGEND_ROW_H / 2;
    let x = centerX - rowWidth / 2;
    row.forEach(m => {
      overlay.append('circle')
          .attr('cx', x + LEGEND_SWATCH_R)
          .attr('cy', yc)
          .attr('r', LEGEND_SWATCH_R)
          .attr('fill', m.item.color);
      legendLabel(overlay, m.item)
          .attr('x', x + LEGEND_SWATCH_R * 2 + LEGEND_GAP)
          .attr('y', yc)
          .attr('dominant-baseline', 'central');
      x += m.width + LEGEND_ITEM_GAP;
    });
  });
}

// Wires the SVG-download button. Both trees produce the same export chrome
// (title at top-left, site title at top-right, contributor + timestamp at the
// bottom), only the heading text and output filename differ. `legendItems` is
// optional: a function returning [{ color, label, count }] for a legend band
// under the diagram (the compare view's status key). It is called on download,
// not at attach time, so the labels follow the current language.
export function attachSvgExport({ svg, g, downloadBtnId, data, personName, contributorName, sourceContributors, titleText, filePrefix, legendItems }) {
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    const originalTransform = g.attr('transform');
    g.attr('transform', null);

    const bbox = g.node().getBBox();
    const padding = 20;
    const diagramPadding = 20;
    const headerHeight = 50;
    const footerHeight = 40;

    // The legend is measured before the canvas is sized: a narrow chart widens
    // the export rather than letting an entry run off the edge, and the number
    // of rows it wraps into decides how much height the band needs.
    const measuredLegend = measureLegend(svg, legendItems && legendItems());
    const widestItem = measuredLegend.reduce((w, m) => Math.max(w, m.width), 0);
    const contentWidth = Math.max(bbox.width, widestItem);
    const legendRows = packLegend(measuredLegend, contentWidth);
    const legendHeight = legendRows.length ? legendRows.length * LEGEND_ROW_H + LEGEND_PAD * 2 : 0;

    const exportX = bbox.x - padding - (contentWidth - bbox.width) / 2;
    const exportY = bbox.y - diagramPadding - headerHeight;
    const exportWidth = contentWidth + padding * 2;
    const exportHeight = bbox.height + diagramPadding * 2 + headerHeight + legendHeight + footerHeight;

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

    // Add header and footer background using --srd-brand-tint
    overlay.append('rect')
        .attr('x', exportX)
        .attr('y', exportY)
        .attr('width', exportWidth)
        .attr('height', headerHeight)
        .attr('fill', '#e8eef6');

    overlay.append('rect')
        .attr('x', exportX)
        .attr('y', exportY + exportHeight - footerHeight)
        .attr('width', exportWidth)
        .attr('height', footerHeight)
        .attr('fill', '#e8eef6');

    if (legendRows.length) {
      drawLegend(
        overlay, legendRows,
        exportX + exportWidth / 2,
        bbox.y + bbox.height + diagramPadding + LEGEND_PAD,
      );
    }

    const rootParams = new URLSearchParams();
    rootParams.set('t', 'person');
    if (data.name) rootParams.set('n', data.name);
    if (data.surname) rootParams.set('sn', data.surname);
    if (data.date_of_birth) rootParams.set('dob', data.date_of_birth);
    if (contributorName) rootParams.set('c', contributorName);
    if (data.ext_id) rootParams.set('id', data.ext_id);
    rootParams.set('ex', '1');
    const rootUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch(rootParams);

    overlay.append('a')
        .attr('href', rootUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + padding)
        .attr('y', exportY + headerHeight / 2)
        .attr('dominant-baseline', 'central')
        .attr('font-size', '18px')
        .attr('font-weight', 'bold')
        .attr('fill', '#3498db')
        .text(titleText);

    const domainUrl = window.location.origin;
    const domainText = window.location.hostname;
    overlay.append('a')
        .attr('href', domainUrl)
        .attr('target', '_blank')
        .append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + headerHeight / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('font-size', '12px')
        .attr('fill', '#3498db')
        .text(domainText);

    let footerLeftX = exportX + padding;
    if (contributorName) {
      overlay.append('image')
          .attr('href', window.location.origin + siteConfig.logo)
          .attr('x', footerLeftX)
          .attr('y', exportY + exportHeight - footerHeight / 2 - 16)
          .attr('width', 32)
          .attr('height', 32);

      footerLeftX += 40;

      const sourceLabel = overlay.append('text')
          .attr('x', footerLeftX)
          .attr('y', exportY + exportHeight - footerHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', '14px')
          .attr('fill', '#555')
          .text(`${t('tree_source')}:`);

      const labelWidth = sourceLabel.node().getComputedTextLength();
      // Lay out the source value as a row of text/link segments, advancing a
      // cursor by each segment's measured width. The value is either a single
      // linked contributor (the regular trees) or a comma-separated list of the
      // genealogists compared (the compare view) — every name links to its
      // contributor page. The site title closes the line.
      let cursorX = footerLeftX + labelWidth + 6;
      const footerYc = exportY + exportHeight - footerHeight / 2;
      const contribUrl = (name) =>
        window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', c: name });
      const appendSegment = (label, href, fill) => {
        const host = href
          ? overlay.append('a').attr('href', href).attr('target', '_blank')
          : overlay;
        const node = host.append('text')
            .attr('x', cursorX)
            .attr('y', footerYc)
            .attr('dominant-baseline', 'central')
            .attr('font-size', '14px')
            .attr('fill', fill)
            .text(label);
        cursorX += node.node().getComputedTextLength();
      };

      if (sourceContributors && sourceContributors.length) {
        sourceContributors.forEach((name, i) => {
          if (i > 0) appendSegment(', ', null, '#555');
          appendSegment(name, contribUrl(name), '#3498db');
        });
      } else {
        appendSegment(`${t('col_contributor')} ${contributorName}`, contribUrl(contributorName), '#3498db');
      }

      appendSegment(', ', null, '#555');
      appendSegment(t('site_title'), window.location.origin + window.location.pathname, '#3498db');
    }

    const dateStr = exportDateStr();
    overlay.append('text')
        .attr('x', exportX + exportWidth - padding)
        .attr('y', exportY + exportHeight - footerHeight / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('font-size', '14px')
        .attr('fill', '#555')
        .text(`${t('tree_created')}: ${dateStr}`);

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

    // Match the hyphenated, diacritic-stripped naming used by every other
    // export (CSV/GEDCOM/surname cloud) so downloads sort together.
    const filename = formatExportFilename(`${filePrefix}-${personName || filePrefix}`, 'svg');
    downloadBlob(new Blob([source], { type: 'image/svg+xml;charset=utf-8;' }), filename);
  });
}
