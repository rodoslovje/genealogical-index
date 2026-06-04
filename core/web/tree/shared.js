import { toUnicodeSearch } from '../url.js';
import { t } from '../i18n.js';
import { isPrivate, downloadBlob, formatExportFilename } from '../utils.js';

// Shared layout / chrome helpers used by both the ancestors and descendants
// trees. d3 is loaded globally from the CDN (see ensureD3), so it isn't imported.

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

export function createSvgWithZoom(container, bounds, root, ids) {
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
    const updateMinimap = addMinimap(ids.wrapper, root, bounds, width, height, svg, zoom);
    zoom.on('zoom.minimap', (e) => updateMinimap(e.transform));
    updateMinimap(d3.zoomTransform(svg.node()));
  }

  return { svg, g };
}

// Small top-left overview that shows the entire tree plus a rectangle
// indicating the currently visible portion of the main view. Clicking the
// minimap re-centers the main view at the chosen tree coordinate.
// Returns an `update(transform)` callback the caller must invoke whenever
// the main view's zoom transform changes.
function addMinimap(wrapperId, root, bounds, viewWidth, viewHeight, mainSvg, zoom) {
  const wrapper = document.getElementById(wrapperId);
  if (!wrapper) return () => {};

  // Clear any leftover minimap from a prior render of this page.
  wrapper.querySelectorAll('.tree-minimap').forEach(el => el.remove());

  const maxMmSize = 200;
  const mmPad = 6;

  const treeW = Math.max(bounds.treeWidth, 1);
  const treeH = Math.max(bounds.treeHeight, 1);
  const treeAspect = treeW / treeH;

  let mmContentWidth, mmContentHeight;
  if (treeAspect > 1) {
    mmContentWidth = maxMmSize - mmPad * 2;
    mmContentHeight = mmContentWidth / treeAspect;
  } else {
    mmContentHeight = maxMmSize - mmPad * 2;
    mmContentWidth = mmContentHeight * treeAspect;
  }

  const mmWidth = mmContentWidth + mmPad * 2;
  const mmHeight = mmContentHeight + mmPad * 2;
  const mmScale = mmContentWidth / treeW;

  const offsetX = mmPad;
  const offsetY = mmPad;

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
      .attr('fill', d => d.data.sex === 'm' ? '#3498db' : (d.data.sex === 'f' ? '#e83e8c' : '#999'));

  mmG.append('g')
    .selectAll('circle')
    .data(root.descendants().filter(d => d.data.is_family))
    .join('circle')
      .attr('cx', d => d.y)
      .attr('cy', d => d.x)
      .attr('r', 4 / mmScale)
      .attr('fill', 'none')
      .attr('stroke', d => {
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
export function attachSvgExport({ svg, g, downloadBtnId, data, personName, contributorName, titleText, filePrefix }) {
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
      const contribUrl = window.location.origin + window.location.pathname + '?' + toUnicodeSearch({ t: 'contributors', c: contributorName });
      const contribText = overlay.append('a')
          .attr('href', contribUrl)
          .attr('target', '_blank')
          .append('text')
          .attr('x', footerLeftX + labelWidth + 6)
          .attr('y', exportY + exportHeight - footerHeight / 2)
          .attr('dominant-baseline', 'central')
          .attr('font-size', '14px')
          .attr('fill', '#3498db')
          .text(`${t('col_contributor')} ${contributorName}`);

      const contribWidth = contribText.node().getComputedTextLength();

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

    const dateStr = new Date().toLocaleDateString(document.documentElement.lang || 'en');
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

    const safeName = (personName || filePrefix).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    downloadBlob(
      new Blob([source], { type: 'image/svg+xml;charset=utf-8;' }),
      `${filePrefix}_${safeName}.svg`
    );
  });
}

// CSV columns shared by both trees, in output order. Row objects produced by
// the per-tree row builders use these same keys; headers come from `col_<key>`.
// The husband/wife layout mirrors the families CSV export so the two downloads
// line up column-for-column.
const CSV_COLUMNS = [
  'generation',
  'husband_name',
  'husband_surname',
  'husband_birth',
  'wife_name',
  'wife_surname',
  'wife_birth',
  'date_of_marriage',
  'place_of_marriage',
];

const csvCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

// Builds one CSV row from a couple. `personA`/`personB` are person/partner dicts
// (either may be null); they're sorted into husband/wife slots by sex, matching
// the families export. Used for both a marriage and a lone person (partner null).
export function marriageRow({ personA, personB, marriage, generation }) {
  const [husband, wife] = orderSpouses(personA, personB);
  return {
    generation,
    husband_name: husband?.name || '',
    husband_surname: husband?.surname || '',
    husband_birth: husband?.date_of_birth || '',
    wife_name: wife?.name || '',
    wife_surname: wife?.surname || '',
    wife_birth: wife?.date_of_birth || '',
    date_of_marriage: marriage?.date || '',
    place_of_marriage: marriage?.place || '',
  };
}

// Wires the CSV-download button. `buildRows()` is supplied by each tree and
// returns one row object per person (with an extra row per marriage), keyed by
// CSV_COLUMNS. The flat list keeps a `generation` column so the tree structure
// survives the export, and marriage rows carry partner + date/place of marriage.
// A small provenance footer (subject, source contributor, site, timestamp)
// mirrors the SVG export.
export function attachCsvExport({ downloadBtnId, buildRows, personName, contributorName, titleText, filePrefix }) {
  const btn = document.getElementById(downloadBtnId);
  if (!btn) return;
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    // Ascending by generation (0, 1, 2, …); the stable sort preserves each
    // tree's natural within-generation traversal order.
    const rows = (buildRows() || []).slice().sort((a, b) => a.generation - b.generation);

    const header = CSV_COLUMNS.map(col => csvCell(t('col_' + col))).join(',');
    const body = rows.map(row => CSV_COLUMNS.map(col => csvCell(row[col])).join(','));

    const footer = [];
    if (titleText) footer.push(csvCell(titleText));
    if (contributorName) footer.push(`${csvCell(t('tree_source'))},${csvCell(contributorName)}`);
    footer.push(csvCell(t('site_title')));
    footer.push(csvCell(window.location.origin));
    footer.push(csvCell(new Date().toLocaleString()));

    const csvContent = [header, ...body].join('\n') + '\n\n' + footer.join('\n');

    const filename = formatExportFilename(`${filePrefix}-${personName || filePrefix}`, 'csv');
    downloadBlob(new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' }), filename);
  });
}

// --- GEDCOM (.ged) export ---------------------------------------------------
// The per-tree builders return a model of { individuals, families } using the
// shapes below; `serializeGedcom` turns that into a GEDCOM 5.5.1 file.
//   individual: { id, name, surname, sex, birth:{date,place}, fams:[famId], famc:famId|null }
//   family:     { id, husband:indiId|null, wife:indiId|null, children:[indiId], marriage:{date,place}|null }
// Dates are passed through verbatim (the index stores free-form date strings),
// which GEDCOM readers tolerate in DATE values.

const GED_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function gedHeaderDate(d) {
  return `${String(d.getDate()).padStart(2, '0')} ${GED_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function serializeGedcom({ individuals, families }) {
  const lines = [];
  const sysId = 'GenealogicalIndex';
  const submId = 'SUBM1';

  lines.push('0 HEAD');
  lines.push(`1 SOUR ${sysId}`);
  lines.push(`2 NAME ${t('site_title')}`);
  lines.push(`2 CORP ${window.location.hostname}`);
  lines.push(`1 DATE ${gedHeaderDate(new Date())}`);
  lines.push('1 GEDC');
  lines.push('2 VERS 5.5.1');
  lines.push('2 FORM LINEAGE-LINKED');
  lines.push('1 CHAR UTF-8');
  lines.push(`1 SUBM @${submId}@`);

  lines.push(`0 @${submId}@ SUBM`);
  lines.push(`1 NAME ${t('site_title')}`);

  for (const indi of individuals) {
    lines.push(`0 @${indi.id}@ INDI`);
    if (indi.name || indi.surname) {
      lines.push(`1 NAME ${`${(indi.name || '').trim()} /${(indi.surname || '').trim()}/`.trim()}`);
    }
    if (indi.sex === 'm') lines.push('1 SEX M');
    else if (indi.sex === 'f') lines.push('1 SEX F');
    if (indi.birth && (indi.birth.date || indi.birth.place)) {
      lines.push('1 BIRT');
      if (indi.birth.date) lines.push(`2 DATE ${indi.birth.date}`);
      if (indi.birth.place) lines.push(`2 PLAC ${indi.birth.place}`);
    }
    for (const f of indi.fams) lines.push(`1 FAMS @${f}@`);
    if (indi.famc) lines.push(`1 FAMC @${indi.famc}@`);
  }

  for (const fam of families) {
    lines.push(`0 @${fam.id}@ FAM`);
    if (fam.husband) lines.push(`1 HUSB @${fam.husband}@`);
    if (fam.wife) lines.push(`1 WIFE @${fam.wife}@`);
    for (const c of fam.children) lines.push(`1 CHIL @${c}@`);
    if (fam.marriage && (fam.marriage.date || fam.marriage.place)) {
      lines.push('1 MARR');
      if (fam.marriage.date) lines.push(`2 DATE ${fam.marriage.date}`);
      if (fam.marriage.place) lines.push(`2 PLAC ${fam.marriage.place}`);
    }
  }

  lines.push('0 TRLR');
  return lines.join('\n') + '\n';
}

// Factory the per-tree builders use to allocate sequentially-numbered records.
export function createGedcomModel() {
  const individuals = [];
  const families = [];
  let iSeq = 0;
  let fSeq = 0;
  return {
    individuals,
    families,
    // person: a tree person/partner dict (place_of_birth may be absent).
    addIndividual(person) {
      const indi = {
        id: `I${++iSeq}`,
        name: person?.name || '',
        surname: person?.surname || '',
        sex: person?.sex || '',
        birth: { date: person?.date_of_birth || '', place: person?.place_of_birth || '' },
        fams: [],
        famc: null,
      };
      individuals.push(indi);
      return indi;
    },
    // Links a husband/wife (either may be null) and returns the new family.
    addFamily(husband, wife, marriage) {
      const fam = {
        id: `F${++fSeq}`,
        husband: husband ? husband.id : null,
        wife: wife ? wife.id : null,
        children: [],
        marriage: marriage || null,
      };
      families.push(fam);
      if (husband) husband.fams.push(fam.id);
      if (wife) wife.fams.push(fam.id);
      return fam;
    },
  };
}

// Wires the GEDCOM-download button. `buildModel()` returns { individuals, families }.
export function attachGedExport({ downloadBtnId, buildModel, personName, filePrefix }) {
  const btn = document.getElementById(downloadBtnId);
  if (!btn) return;
  d3.select(`#${downloadBtnId}`).on('click', null).on('click', () => {
    const ged = serializeGedcom(buildModel());
    const filename = formatExportFilename(`${filePrefix}-${personName || filePrefix}`, 'ged');
    downloadBlob(new Blob([ged], { type: 'text/plain;charset=utf-8;' }), filename);
  });
}

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
