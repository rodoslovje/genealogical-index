import { getParam } from '../lib/url.js';

// --- View state owned by this module -----------------------------------------
// Shared between renderMatchesPage (writer) and the view cache (reader), so it
// lives here as the single owning seam.

let currentMatchesData = null;
let currentMatchesContributor = null;

export const contributorColumns = ['contributor_ID', 'total_persons', 'total_families', 'total', 'total_links', 'matches', 'last_modified'];

/** Read the active-contributor / partner URL params. Use the shared getParam
 *  so short `c=` / `w=` and legacy `contributor=` / `with=` forms both work. */
export const readContributorParam = (p) => getParam(p, 'contributor');
export const readWithParam        = (p) => getParam(p, 'with');

/** Called by matches.js after a successful matches-summary fetch so a
 *  restored view (browser Back/Forward) can recover the partner list without
 *  re-fetching. */
export function setCurrentMatches(data, contributor) {
  currentMatchesData = data;
  currentMatchesContributor = contributor;
}

/** Snapshot of the partner-list state, read by the view cache so a restored
 *  single-contributor view has its matches data back. */
export function getCurrentMatches() {
  return { data: currentMatchesData, contributor: currentMatchesContributor };
}
