/**
 * Converts between a document and markdown (CommonMark with GFM
 * strikethrough).
 *
 * Round trip: for every document, `parseMarkdown(serializeMarkdown(doc))`
 * equals `canonical(doc)`, ignoring block ids. A document already in canonical
 * form therefore round-trips unchanged. What `canonical` gives up is listed on
 * it: whitespace at the edge of bold, italic or strike loses the mark, NUL
 * becomes U+FFFD, and code that would turn a line into a link definition loses
 * its code mark. Use the editor's JSON output when a lossless copy is needed.
 */
export { canonical, serializeMarkdown } from './serialize';
export { parseMarkdown } from './parse';
export { rawRenderer, type RawHtmlOptions, type RawRenderer } from './render';
export { MARKDOWN_SYNTAX, markSyntax } from './syntax';
