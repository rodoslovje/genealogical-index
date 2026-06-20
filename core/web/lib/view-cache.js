// Caches a view's rendered DOM (plus any small bit of associated JS state)
// keyed by the full URL it was shown at, so SPA back/forward between heavy
// views (a contributor's matches table, ...) is instant and preserves scroll
// position instead of re-fetching and rebuilding from scratch. Detached DOM
// nodes keep their event listeners, so widgets inside a restored view (sort
// headers, filter checkboxes, expand toggles, ...) keep working with no
// re-wiring.

const MAX_ENTRIES = 8;
const cache = new Map(); // url -> { frag, scrollY, title, extra }
let current = null;      // { key, container, captureExtra }

/** Detaches the currently-tracked view's content into the cache. Call before
 *  routing to a different view so its DOM survives the trip away. */
export function leaveCurrentView() {
  if (!current) return;
  const { key, container, captureExtra } = current;
  current = null;
  if (!container || !container.isConnected) return;

  // Capture scroll position before detaching: removing the container's
  // (possibly very tall) content shrinks the document height immediately,
  // and the browser clamps window.scrollY to the new max right away — so
  // reading it after detaching would record the clamped value, not where
  // the user actually was.
  const scrollY = window.scrollY;

  const frag = document.createDocumentFragment();
  while (container.firstChild) frag.appendChild(container.firstChild);

  cache.delete(key); // re-insert at the end so the Map stays in recency order
  cache.set(key, {
    frag,
    scrollY,
    title: document.title,
    extra: captureExtra ? captureExtra() : undefined,
  });
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

/** Restores a previously cached view into `container` if one exists for
 *  `key`. Returns true on a hit, in which case the caller should skip its
 *  normal (re-fetch + rebuild) render path. */
export function tryRestoreView(key, container, { restoreExtra, captureExtra } = {}) {
  const entry = cache.get(key);
  if (!entry || !container) return false;

  container.replaceChildren(entry.frag);
  document.title = entry.title;
  if (restoreExtra) restoreExtra(entry.extra);
  current = { key, container, captureExtra };

  // Two rAFs: the first lets the browser apply the just-swapped-in layout,
  // the second runs after that layout has settled, so scrollTo isn't clamped
  // against the stale (pre-swap) scroll height.
  requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, entry.scrollY)));
  return true;
}

/** Marks `container` as showing `key` right now, so a later leaveCurrentView()
 *  caches it. Call after a fresh (non-cached) render. */
export function markCurrentView(key, container, captureExtra) {
  current = { key, container, captureExtra };
}

/** Re-points the currently-tracked view at `key` — call after a replaceState
 *  that changes the URL (e.g. a sidebar filter) while that view stays mounted,
 *  so a later leaveCurrentView() caches it under the URL it'll actually be
 *  returned to on Back, not the stale one captured by markCurrentView. No-op
 *  if no view is currently tracked (e.g. the contributors list view). */
export function updateCurrentKey(key) {
  if (current) current.key = key;
}

/** Drops every cached view — e.g. after a language switch, since cached
 *  markup would otherwise show in the previous language until re-visited. */
export function clearViewCache() {
  cache.clear();
  current = null;
}
