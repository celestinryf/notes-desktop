// @ts-check
// Done in the page, not with Chromium's page-wide find: only the note is searched, the count is exact,
// and it works whether the note is shown rendered (Custom Highlight API) or as source (textarea selection).
/** @type {{ open: boolean, query: string, ranges: Range[], active: number, sourceHits: number[] }} */
export const find = { open: false, query: '', ranges: [], active: -1, sourceHits: [] };
