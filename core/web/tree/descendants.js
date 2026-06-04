import { isPrivate } from '../utils.js';
import { toUnicodeSearch } from '../url.js';
import { parseDateForSort } from '../dates.js';
import { computeBounds, createSvgWithZoom, attachSvgExport, attachCsvExport, attachGedExport, createGedcomModel, orderSpouses, personRow, appendLinks, decoratePersonNodes } from './shared.js';

export function renderD3DescendantsTree(data, container, personName, contributorName, ids, exportOpts) {
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
  const { svg, g } = createSvgWithZoom(container, bounds, root, ids);

  attachSvgExport({
    svg, g, downloadBtnId: ids.downloadSvg,
    data, personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  attachCsvExport({
    downloadBtnId: ids.downloadCsv,
    buildRows: () => buildDescendantRows(data),
    personName, contributorName,
    titleText: exportOpts.titleText,
    filePrefix: exportOpts.filePrefix,
  });

  attachGedExport({
    downloadBtnId: ids.downloadGed,
    buildModel: () => buildDescendantGedcom(data),
    personName,
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

// Flattens the descendants tree into one CSV row per person. Generation 0 is the
// focus person; their children are generation 1, and so on (family nodes don't
// count as a generation). A person is emitted once per marriage so each row
// carries that marriage's partner + date/place; persons with no recorded family
// still get a single row with empty marriage columns.
function buildDescendantRows(rootData) {
  const rows = [];

  const walk = (person, generation) => {
    const families = (person.children || []).filter(c => c.is_family);
    if (!families.length) {
      rows.push(personRow(person, generation, null, null));
      return;
    }
    families.forEach(fam => {
      rows.push(personRow(person, generation, fam.partner, fam.marriage));
      (fam.children || [])
        .filter(c => !c.is_family)
        .forEach(child => walk(child, generation + 1));
    });
  };

  walk(rootData, 0);
  return rows;
}

// Builds a GEDCOM model from the descendants tree. Each person is an individual
// and each family node becomes a FAM linking the person, the partner (also an
// individual), the marriage (MARR) and the family's children (CHIL), recursing
// into those children.
function buildDescendantGedcom(rootData) {
  const model = createGedcomModel();
  const rootIndi = model.addIndividual(rootData);

  const walk = (person, indi) => {
    (person.children || []).filter(c => c.is_family).forEach(fam => {
      const partnerIndi = model.addIndividual(fam.partner || {});

      let husband;
      let wife;
      if (indi.sex === 'm') { husband = indi; wife = partnerIndi; }
      else if (indi.sex === 'f') { husband = partnerIndi; wife = indi; }
      else { [husband, wife] = orderSpouses(indi, partnerIndi); }

      const famRec = model.addFamily(husband, wife, fam.marriage);

      (fam.children || []).filter(c => !c.is_family).forEach(child => {
        const childIndi = model.addIndividual(child);
        childIndi.famc = famRec.id;
        famRec.children.push(childIndi.id);
        walk(child, childIndi);
      });
    });
  };

  walk(rootData, rootIndi);
  return model;
}

// Family-side info text + clickable link beside the ⚭ glyph.
function appendDescendantFamilyLinks(node, contributorName) {
  const familyNode = node.filter(d => d.data.is_family);

  const isPartnerUnknown = p => !p?.name && !p?.surname;

  const familyLink = familyNode.append(d => {
    const person = d.parent.data;
    const partner = d.data.partner;
    const pPriv = isPrivate(person.name) || isPrivate(person.surname);
    const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
    const partUnknown = isPartnerUnknown(partner);
    return document.createElementNS('http://www.w3.org/2000/svg', (pPriv || partPriv || partUnknown) ? 'g' : 'a');
  })
    .attr('href', d => {
      const person = d.parent.data;
      const partner = d.data.partner;
      const pPriv = isPrivate(person.name) || isPrivate(person.surname);
      const partPriv = isPrivate(partner.name) || isPrivate(partner.surname);
      if (pPriv || partPriv || isPartnerUnknown(partner)) return null;

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
      return (pPriv || partPriv || isPartnerUnknown(partner)) ? null : '';
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
        return (pPriv || partPriv || isPartnerUnknown(partner)) ? '#555' : '#3498db';
      });

  familyText.each(function(d) {
    const el = d3.select(this);
    const p = d.data.partner;
    const m = d.data.marriage || {};
    const partUnknown = isPartnerUnknown(p);
    const partnerName = partUnknown ? '<unknown>' : [p.name, p.surname].filter(Boolean).join(' ');
    const date = m.date || '';
    const place = m.place ? m.place.split(',')[0].trim() : '';

    let firstLine = true;
    if (partnerName) {
      const isPriv = isPrivate(p.name) || isPrivate(p.surname);
      const bold = !partUnknown && !isPriv;
      el.append('tspan').attr('x', 14).attr('font-weight', bold ? 'bold' : 'normal').text(partnerName);
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
