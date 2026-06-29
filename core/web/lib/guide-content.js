// Pure string templating for the User Guide, shared by the in-app modal
// (help.js, runs in the browser with the live i18n strings) and the
// build-time static /guide page (vite.config.shared.js, runs in Node against
// a single locale module) — kept in one place so the two can't drift apart.

export const USER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

/** Resolves the {auth_*} / {source_type_item} / {matricula_cols} /
 *  {matricula_mark} / {USER_ICON} placeholders in help_manual against a
 *  given strings object
 *  (either the live i18n lookup or a static locale module). `hasAuth` gates the
 *  login-only sections; `siteConfig.gatedFeatures` gates the special-source
 *  text so the guide doesn't describe UI a site has hidden. */
export function renderGuideManual(strings, hasAuth, siteConfig = {}) {
  const authNav = hasAuth ? (strings.help_auth_nav || '').replace('{USER_ICON}', USER_ICON) : '';
  const authTree = hasAuth ? (strings.help_auth_tree || '') : '';
  const authMatch = hasAuth ? (strings.help_auth_match || '') : '';
  const authSection = hasAuth ? (strings.help_auth_section || '').replace('{USER_ICON}', USER_ICON) : '';

  const gated = siteConfig.gatedFeatures || [];
  // The source-type dropdown is hidden (search.js) only when every special
  // source is gated, so drop its guide bullet under the same condition.
  const sourceSelectorHidden = ['matricula', 'geneanet', 'military'].every(f => gated.includes(f));
  const sourceTypeItem = sourceSelectorHidden ? '' : (strings.help_source_type_item || '');
  const matriculaGated = gated.includes('matricula');
  // Only the trailing sentence about the Total/Tree/Matricula column split is
  // Matricula-specific; the bullet's first sentence is always true, so it stays
  // inline and only this clause is gated.
  const matriculaCols = matriculaGated ? '' : (strings.help_matricula_cols || '');
  // The ⛪ marginal mark only ever appears on Matricula sources, so drop its
  // mid-sentence clause from the "Icons in rows" paragraph when matricula is gated.
  const matriculaMark = matriculaGated ? '' : (strings.help_matricula_mark || '');

  return (strings.help_manual || '')
    .replace('{auth_nav}', authNav)
    .replace('{auth_tree}', authTree)
    .replace('{auth_match}', authMatch)
    .replace('{auth_section}', authSection)
    .replace('{source_type_item}', sourceTypeItem)
    .replace('{matricula_cols}', matriculaCols)
    .replace('{matricula_mark}', matriculaMark);
}
