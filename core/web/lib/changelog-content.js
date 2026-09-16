// Pure string templating for the Changelog, shared by the build-time static
// /changelog page (vite.config.shared.js, in Node) and the client-side
// re-render that swaps the page into the visitor's language (page-lang.js, in
// the browser) — kept in one place so the two can't drift apart.
//
// Entry content comes from core/web/changelog/<lang>.js and is ours, so the
// titles and texts are inserted as written (they carry inline <em>/<a>);
// only the date, which is data, is escaped.

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Merges a translated changelog over the English one: entries are matched by
 *  date, and any date — or any individual item — the translation is missing
 *  falls back to its English original. Lets a locale lag behind a release
 *  without blanking the page or dropping the newest entries. */
export function mergeChangelog(base, translated) {
  if (!translated || !translated.length) return base || [];
  const byDate = new Map(translated.map(e => [e.date, e]));
  return (base || []).map((entry) => {
    const t = byDate.get(entry.date);
    if (!t) return entry;
    const items = entry.items.map((item, i) => t.items?.[i] || item);
    return { ...entry, items };
  });
}

/** Renders the changelog entries to the HTML that goes inside .help-content
 *  (the same wrapper the guide uses, so both pages share their typography). */
export function renderChangelog(entries, strings = {}) {
  const heading = strings.changelog_title || 'Changelog';
  const intro = strings.changelog_intro || '';

  const sections = (entries || []).map(({ date, items }) => {
    const lis = (items || [])
      .map(it => `          <li><strong>${it.title}</strong> — ${it.text}</li>`)
      .join('\n');
    return `      <section class="changelog-entry">
        <h3 class="changelog-date">${escapeHtml(date)}</h3>
        <ul>
${lis}
        </ul>
      </section>`;
  }).join('\n');

  return `      <h2>${escapeHtml(heading)}</h2>
${intro ? `      <p>${intro}</p>\n` : ''}${sections}
`;
}
