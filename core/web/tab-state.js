// Tab ids that currently hold rendered search results. Kept in its own leaf
// module so the router (which reads it when switching tabs) and search.js
// (which adds to it after a search completes) can both import it without
// creating an import cycle through main.js.
export const tabsWithResults = new Set();
