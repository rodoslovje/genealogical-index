import { isPrivate } from '../lib/utils.js';
import { parseDateForSort } from '../lib/dates.js';

// Turns the raw API trees into d3 hierarchies the layouts can share, and
// prunes them to a generation limit. Layout-independent: every chart (tree,
// fan, circle, bowtie) starts from the hierarchies built here.
//
// Vocabulary used across the tree module (charts: tree, fan, circle, bowtie):
//   side  — 'anc' (ancestors tree, nodes link via `parents`) or 'desc'
//           (descendants tree, person nodes alternate with `is_family` nodes
//           via `children`).
//   dir   — what the page shows: 'anc', 'desc', or 'both' (the bowtie).
//   gen   — generation distance from the focus person (0 = the person).
//           Family nodes in a descendants tree share their parent's gen.
//   slot  — ancestors only: Ahnentafel number (1 = person, father 2k,
//           mother 2k+1). The fan places ancestors by slot so a missing
//           parent leaves an empty wedge instead of shifting siblings.
// d3 is loaded globally from the CDN (see ensureD3), so it isn't imported.

export const DIRS = ['anc', 'desc', 'both'];
export const CHARTS = ['tree', 'fan', 'circle'];

// --- Generation pruning -----------------------------------------------------

// Returns a copy of `data` cut to `gens` generations (0 = unlimited). The API
// already returns the full tree; the fan, which can't cope with unbounded
// depth, trims it client side, and the exports follow what's shown.
export function pruneGenerations(data, side, gens) {
  if (!data || !gens) return data;
  return side === 'anc' ? pruneAncestors(data, 0, gens) : pruneDescendants(data, 0, gens);
}

function pruneAncestors(node, gen, gens) {
  const parents = gen < gens ? (node.parents || []).map(p => pruneAncestors(p, gen + 1, gens)) : [];
  return { ...node, parents };
}

// Persons at the last generation keep their family nodes (partner + marriage
// stay visible) but lose the children, mirroring the API's own depth limit.
function pruneDescendants(person, gen, gens) {
  const children = (person.children || []).map(fam => {
    if (!fam.is_family) return pruneDescendants(fam, gen + 1, gens);
    const kids = gen < gens ? (fam.children || []).map(c => pruneDescendants(c, gen + 1, gens)) : [];
    return { ...fam, children: kids };
  });
  return { ...person, children };
}

// Deepest generation present in a raw API tree (0 for a lone person), used to
// cap the toolbar's generation choices at what the data can actually show.
// Family nodes in a descendants tree share their person's generation.
export function treeDepth(data, side) {
  if (!data) return 0;
  let max = 0;
  if (side === 'anc') {
    const walk = (node, gen) => {
      if (gen > max) max = gen;
      (node.parents || []).forEach(p => walk(p, gen + 1));
    };
    walk(data, 0);
  } else {
    const walk = (node, gen) => {
      if (!node.is_family && gen > max) max = gen;
      (node.children || []).forEach(c => walk(c, node.is_family ? gen + 1 : gen));
    };
    walk(data, 0);
  }
  return max;
}

// --- Hierarchies -------------------------------------------------------------

const SEX_ORDER = { m: 1, f: 2 };

// Father above mother, unknown sex last, then by name.
function ancestorSort(a, b) {
  const aSex = SEX_ORDER[a.data.sex] || 3;
  const bSex = SEX_ORDER[b.data.sex] || 3;
  if (aSex !== bSex) return aSex - bSex;
  return d3.ascending(a.data.name || '', b.data.name || '');
}

// Families by marriage date (undated last); persons by birth date (private
// records last, undated last), then by name.
function descendantSort(a, b) {
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
}

// Builds the sorted d3 hierarchy for one side and annotates every node with
// `gen`, `side` and (ancestors) `slot`. Returns null for empty data.
export function buildHierarchy(data, side) {
  if (!data) return null;
  const root = side === 'anc'
    ? d3.hierarchy(data, d => d.parents)
    : d3.hierarchy(data, d => d.children);
  root.sort(side === 'anc' ? ancestorSort : descendantSort);

  root.each(d => {
    d.side = side;
    if (!d.parent) d.gen = 0;
    else d.gen = d.data.is_family ? d.parent.gen : d.parent.gen + 1;
  });

  if (side === 'anc') assignSlots(root);
  return root;
}

// Ahnentafel numbering. Two parents: first (father after sorting) 2k, second
// 2k+1. A lone parent goes to the mother's slot only when known to be female.
function assignSlots(root) {
  root.slot = 1;
  root.each(d => {
    const kids = d.children || [];
    if (!kids.length) return;
    if (kids.length >= 2) {
      kids.forEach((k, i) => { k.slot = 2 * d.slot + Math.min(i, 1); });
    } else {
      kids[0].slot = 2 * d.slot + (kids[0].data.sex === 'f' ? 1 : 0);
    }
  });
  root.each(d => {
    // 0-based index within the generation and the centre of its equal share
    // of the generation's span (used as row position / angular position).
    const perGen = 2 ** d.gen;
    d.slotIndex = d.slot - perGen;
    d.slotFrac0 = d.slotIndex / perGen;
    d.slotFrac1 = (d.slotIndex + 1) / perGen;
  });
}

// Deepest generation present in a hierarchy (0 for a lone root).
export function maxGen(root) {
  let m = 0;
  if (root) root.each(d => { if (d.gen > m) m = d.gen; });
  return m;
}
