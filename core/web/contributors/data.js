import { API_BASE_URL } from '../config.js';

// --- Module-private caches ---------------------------------------------------
let cachedData = null;
let fetchPromise = null;

let timelineData = null;
let timelinePromise = null;

let matchCountsData = null;
let matchCountsPromise = null;

// --- Helpers -----------------------------------------------------------------

function _toPart(p) {
  if (!p) return null;
  return {
    contributor_ID: p.name,
    total_persons: p.persons_count || 0,
    total_families: p.families_count || 0,
    total: (p.persons_count || 0) + (p.families_count || 0),
    total_links: p.links_count || 0,
    last_modified: p.last_modified ? p.last_modified.slice(0, 10) : '',
    _url: p.url || '',
  };
}

/** Returns the cached contributors list synchronously, or null if not loaded yet. */
export function getCachedData() {
  return cachedData;
}

/** Returns the cached match-counts map synchronously, or null if not loaded yet. */
export function getCachedMatchCounts() {
  return matchCountsData;
}

/** Fetches /api/contributors/ once and caches the merged-by-base result. */
export function ensureData() {
  if (cachedData) return Promise.resolve(cachedData);
  if (!fetchPromise) {
    fetchPromise = fetch(`${API_BASE_URL}/api/contributors/`)
      .then(r => r.json())
      .then(metadata => {
        // Backend returns one entry per base contributor with summed totals
        // and an optional tree/matricula breakdown.
        cachedData = metadata.map(m => ({
          contributor_ID: m.name,
          total_persons: m.persons_count || 0,
          total_families: m.families_count || 0,
          total: (m.persons_count || 0) + (m.families_count || 0),
          total_links: m.links_count || 0,
          last_modified: m.last_modified ? m.last_modified.slice(0, 10) : '',
          _url: m.url || '',
          _tree: _toPart(m.tree),
          _matricula: _toPart(m.matricula),
        }));
        return cachedData;
      });
  }
  return fetchPromise;
}

export function ensureTimelineData() {
  if (timelineData) return Promise.resolve(timelineData);
  if (!timelinePromise) {
    timelinePromise = fetch(`${API_BASE_URL}/api/stats/timeline`)
      .then(r => r.json())
      .then(data => { timelineData = data; return data; });
  }
  return timelinePromise;
}

export function ensureMatchCounts() {
  if (matchCountsData) return Promise.resolve(matchCountsData);
  if (!matchCountsPromise) {
    matchCountsPromise = fetch(`${API_BASE_URL}/api/matches/counts`)
      .then(r => r.json())
      .then(data => {
        matchCountsData = Object.fromEntries(data.map(d => [d.contributor, d.partners_count]));
        return matchCountsData;
      })
      .catch(() => { matchCountsData = {}; return matchCountsData; });
  }
  return matchCountsPromise;
}

/** Annotate each row with `matches_count` from the cached match-counts map. */
export function enrichWithMatchCounts(data) {
  if (!matchCountsData) return data;
  return data.map(d => ({ ...d, matches_count: matchCountsData[d.contributor_ID] || 0 }));
}

/** Expands aggregated rows back to underlying DB contributor IDs (`Kovačič` +
 *  `Kovačič-matricula`) so surname-cloud / search queries include both. */
export function expandContributorNames(rows) {
  const names = [];
  rows.forEach(r => {
    if (r._tree)      names.push(r._tree.contributor_ID);
    if (r._matricula) names.push(r._matricula.contributor_ID);
    if (!r._tree && !r._matricula) names.push(r.contributor_ID);
  });
  return names;
}

/** Map of every contributor (base + matricula alias) → external URL. */
export function getContributorUrlMap() {
  if (!cachedData) return {};
  const map = {};
  cachedData.forEach(d => {
    if (d._url) map[d.contributor_ID] = d._url;
    // Also map raw -matricula IDs so links from partners that still use the
    // suffixed name resolve to the correct URL.
    if (d._tree?._url)      map[d._tree.contributor_ID]      = d._tree._url;
    if (d._matricula?._url) map[d._matricula.contributor_ID] = d._matricula._url;
  });
  return map;
}

/** Warm all caches in parallel. Errors are swallowed (it's a prefetch). */
export function prefetchContributors() {
  ensureData().catch(() => {});
  ensureTimelineData().catch(() => {});
  ensureMatchCounts().catch(() => {});
}
