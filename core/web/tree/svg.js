import { toUnicodeSearch } from '../lib/url.js';
import { t } from '../i18n.js';
import { downloadBlob, formatExportFilename } from '../lib/utils.js';
import { exportDateStr } from '../lib/csv.js';

// Tree layout, zoom/minimap chrome, and SVG export — shared by the ancestors
// and descendants trees. d3 is loaded globally from the CDN (see ensureD3), so
// it isn't imported here. Re-exported via tree/shared.js.

export function computeBounds(root, dx, dy) {
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
  const initialScale = Math.max(minScale, 1);

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

  // Initial view: anchor the root node near the left border, vertically
  // centered, so the branches (which expand to the right) fill the rest
  // of the viewport. A small left margin keeps the centered name label
  // from being clipped against the edge.
  let tx, ty;
  if (root) {
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
    const updateMinimap = addMinimap(ids.wrapper, root, bounds, width, height, svg, zoom, opts.nodeColor);
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
// (compare mode passes the comparison-status palette).
function addMinimap(wrapperId, root, bounds, viewWidth, viewHeight, mainSvg, zoom, nodeColor) {
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
    .data(root.links())
    .join('path')
      .attr('d', d3.linkHorizontal().x(d => d.y).y(d => d.x));

  // Person nodes as small coloured dots; family nodes (partners) as rings of
  // the same size — the ⚭ glyph is illegible at minimap scale, but skipping
  // them entirely makes the map look broken when a person has a partner.
  mmG.append('g')
    .selectAll('circle')
    .data(root.descendants().filter(d => !d.data.is_family))
    .join('circle')
      .attr('cx', d => d.y)
      .attr('cy', d => d.x)
      .attr('r', 4 / mmScale)
      .attr('fill', d => nodeColor ? nodeColor(d) : (d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999')));

  mmG.append('g')
    .selectAll('circle')
    .data(root.descendants().filter(d => d.data.is_family))
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

// Wires the SVG-download button. Both trees produce the same export chrome
// (title at top-left, site title at top-right, contributor + timestamp at the
// bottom), only the heading text and output filename differ.
export function attachSvgExport({ svg, g, downloadBtnId, data, personName, contributorName, sourceText, titleText, filePrefix }) {
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    const originalTransform = g.attr('transform');
    g.attr('transform', null);

    const bbox = g.node().getBBox();
    const padding = 20;
    const diagramPadding = 20;
    const headerHeight = 50;
    const footerHeight = 40;

    const exportX = bbox.x - padding;
    const exportY = bbox.y - diagramPadding - headerHeight;
    const exportWidth = bbox.width + padding * 2;
    const exportHeight = bbox.height + diagramPadding * 2 + headerHeight + footerHeight;

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
          .attr('href', window.location.origin + '/srd-logo-transparent.png')
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
      // The source value is either a single linked contributor (the regular
      // trees) or a plain comma-separated list of both genealogists when a
      // `sourceText` is supplied (the compare view).
      let contribWidth;
      if (sourceText) {
        const node = overlay.append('text')
            .attr('x', footerLeftX + labelWidth + 6)
            .attr('y', exportY + exportHeight - footerHeight / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', '14px')
            .attr('fill', '#555')
            .text(sourceText);
        contribWidth = node.node().getComputedTextLength();
      } else {
        const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', c: contributorName });
        const node = overlay.append('a')
            .attr('href', contribUrl)
            .attr('target', '_blank')
            .append('text')
            .attr('x', footerLeftX + labelWidth + 6)
            .attr('y', exportY + exportHeight - footerHeight / 2)
            .attr('dominant-baseline', 'central')
            .attr('font-size', '14px')
            .attr('fill', '#3498db')
            .text(`${t('col_contributor')} ${contributorName}`);
        contribWidth = node.node().getComputedTextLength();
      }

      const commaNode = overlay.append('text')
          .attr('x', footerLeftX + labelWidth + 6 + contribWidth)
          .attr('y', exportY + exportHeight - footerHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', '14px')
          .attr('fill', '#555')
          .text(', ');

      const commaWidth = commaNode.node().getComputedTextLength();
      overlay.append('a')
          .attr('href', window.location.origin + window.location.pathname)
          .attr('target', '_blank')
          .append('text')
          .attr('x', footerLeftX + labelWidth + 6 + contribWidth + commaWidth)
          .attr('y', exportY + exportHeight - footerHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', '14px')
          .attr('fill', '#3498db')
          .text(t('site_title'));
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
