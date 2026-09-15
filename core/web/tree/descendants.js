import { isPrivate } from '../lib/utils.js';
import { toUnicodeSearch } from '../lib/url.js';
import { orderSpouses, personRow, sexColor } from './shared.js';

// Descendants-specific pieces: the CSV / GEDCOM walkers over the raw API tree
// and the family-node decoration (⚭ glyph + partner / marriage link) used by
// the cartesian layouts. Layout and chrome live in the layout modules / svg.js.
// d3 is loaded globally from the CDN, so it isn't imported.

// Flattens the descendants tree into one CSV row per person. Generation 0 is the
// focus person; their children are generation 1, and so on (family nodes don't
// count as a generation). A person is emitted once per marriage so each row
// carries that marriage's partner + date/place; persons with no recorded family
// still get a single row with empty marriage columns.
export function buildDescendantRows(rootData) {
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

// Adds the descendants tree to a GEDCOM model whose focus person is already
// `rootIndi`. Each family node becomes a FAM linking the person, the partner
// (also an individual), the marriage (MARR) and the family's children (CHIL),
// recursing into those children. Shared with the ancestors walker so a bowtie
// export emits the focus person once.
export function addDescendantsToGedcom(model, rootData, rootIndi) {
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

export const isPartnerUnknown = p => !p?.name && !p?.surname;

// Family-search URL for a person's union with `partner`, or null when either
// side is private or the partner is unknown.
export function descendantFamilyHref(person, partner, marriage, contributorName) {
  const pPriv = isPrivate(person.name) || isPrivate(person.surname);
  const partPriv = isPrivate(partner?.name) || isPrivate(partner?.surname);
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

  if (marriage) {
    if (marriage.date)  params.set('dom', marriage.date);
    if (marriage.place) params.set('pom', marriage.place);
  }
  if (contributorName) params.set('c', contributorName);
  params.set('ex', '1');
  return window.location.origin + window.location.pathname + '?' + toUnicodeSearch(params);
}

// Partner display name for a family node ('<unknown>' when nothing is known).
export function partnerLabel(partner) {
  return isPartnerUnknown(partner) ? '<unknown>' : [partner.name, partner.surname].filter(Boolean).join(' ');
}

// Cartesian family-node decoration: a ⚭ glyph coloured by the partner's sex,
// then the partner name + marriage date/place beside it as a clickable
// family-search link.
export function decorateDescendantFamilies(node, contributorName) {
  const familyNode = node.filter(d => d.data.is_family);

  familyNode.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', '16px')
      .attr('fill', d => sexColor(d.data.partner?.sex))
      .text('⚭')
    .clone(true).lower()
      .attr('stroke', 'white')
      .attr('stroke-width', 3);

  const hrefOf = d => descendantFamilyHref(d.parent.data, d.data.partner, d.data.marriage, contributorName);

  const familyLink = familyNode.append(d =>
      document.createElementNS('http://www.w3.org/2000/svg', hrefOf(d) ? 'a' : 'g'))
    .attr('href', hrefOf)
    .attr('data-spa-nav', d => hrefOf(d) ? '' : null);

  const familyText = familyLink.append('text')
      .attr('dy', '0.3em')
      .attr('x', 14)
      .attr('text-anchor', 'start')
      .attr('font-size', '12px')
      .attr('fill', d => hrefOf(d) ? '#3498db' : '#555');

  familyText.each(function(d) {
    const el = d3.select(this);
    const p = d.data.partner;
    const m = d.data.marriage || {};
    const partUnknown = isPartnerUnknown(p);
    const partnerName = partnerLabel(p);
    const date = m.date || '';
    const place = m.place ? m.place.split(',')[0].trim() : '';

    let firstLine = true;
    if (partnerName) {
      const isPriv = isPrivate(p?.name) || isPrivate(p?.surname);
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
