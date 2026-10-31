/**
 * The framework-free part of the package, for code that handles documents
 * without an editor on screen: converting between markdown, the JSON storage
 * format and HTML, on a server or in a build step. Nothing here touches the
 * DOM.
 *
 * Only what such code needs is exported. The editing machinery (steps,
 * transactions, history, commands, input rules) is internal and may change in
 * any release; the editor exposes what it offers through `useMdEditor()`.
 *
 * @packageDocumentation
 */
export {
  HEADING_LEVELS,
  MARK_TYPES,
  MAX_INDENT,
  listNumbers,
  type Block,
  type Doc,
  type HeadingLevel,
  type Inline,
  type InlineAtom,
  type Mark,
  type MarkType,
  type TextRun,
} from './model';
export { parseMarkdown, serializeMarkdown } from './markdown';
export { serializeHtml } from './html';
export {
  SCHEMA_VERSION,
  SchemaError,
  fromJSON,
  toJSON,
  type MdJSON,
  type StoredBlock,
} from './json';
