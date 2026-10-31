/**
 * Decides whether a link address may be written out as a live link. The
 * address itself always stays in the model; this only governs output (the
 * HTML export and the editor's rendering).
 */

/** Link schemes written as a live `href`. Relative addresses have no scheme and are allowed too. */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const;

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** What a URL parser drops before reading the scheme: tabs and newlines anywhere. */
const IGNORED_IN_URL = /[\t\n\r]/g;
/** C0 controls and the space, which a URL parser trims from both ends. */
const URL_TRIMMED = 0x20;

/**
 * Whether a link address may become a live `href`: a relative address, or one
 * whose scheme is http, https or mailto. The scheme is read the way a browser
 * reads it, so `java\tscript:` and leading control characters do not slip
 * through. The address itself stays in the model either way.
 */
export function isSafeHref(href: string): boolean {
  const chars = Array.from(href.replace(IGNORED_IN_URL, ''));
  const isTrimmed = (char: string) => (char.codePointAt(0) ?? 0) <= URL_TRIMMED;
  const start = chars.findIndex((char) => !isTrimmed(char));
  const scheme = SCHEME.exec(start === -1 ? '' : chars.slice(start).join(''))?.[1];
  if (scheme === undefined) return true;
  return ALLOWED_SCHEMES.some((allowed) => allowed === scheme.toLowerCase());
}
