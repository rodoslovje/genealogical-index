// Pure string templating for the User Guide, shared by the in-app modal
// (help.js, runs in the browser with the live i18n strings) and the
// build-time static /guide page (vite.config.shared.js, runs in Node against
// a single locale module) — kept in one place so the two can't drift apart.

export const USER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-bottom;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

/** Resolves the {auth_*} / {USER_ICON} placeholders in help_manual against a
 *  given strings object (either the live i18n lookup or a static locale
 *  module). `hasAuth` gates the login-only sections. */
export function renderGuideManual(strings, hasAuth) {
  const authNav = hasAuth ? (strings.help_auth_nav || '').replace('{USER_ICON}', USER_ICON) : '';
  const authTree = hasAuth ? (strings.help_auth_tree || '') : '';
  const authMatch = hasAuth ? (strings.help_auth_match || '') : '';
  const authSection = hasAuth ? (strings.help_auth_section || '').replace('{USER_ICON}', USER_ICON) : '';

  return (strings.help_manual || '')
    .replace('{auth_nav}', authNav)
    .replace('{auth_tree}', authTree)
    .replace('{auth_match}', authMatch)
    .replace('{auth_section}', authSection);
}
