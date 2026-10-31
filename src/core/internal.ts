/**
 * What the editor's own layers (view, editor, react) use from core: the public
 * `./core` entry plus the editing machinery behind it. Not a package entry
 * point: nothing outside `src/` can import it, so it may change in any
 * release.
 *
 * @internal
 */
export {
  HEADING_LEVELS,
  MARK_TYPES,
  MAX_HEADING_LEVEL,
  MAX_INDENT,
  MAX_ORDERED_START,
  listNumbers,
  idCounter,
  normalizeDoc,
  slice,
  sortMarks,
  type Block,
  type CreateId,
  type Doc,
  type Fragment,
  type HeadingLevel,
  type Inline,
  type InlineAtom,
  type Mark,
  type MarkType,
  type Pos,
  type TextBlockAttrs,
  type TextRun,
} from './model';
export { assertNever } from './lang';
export { FORMATS, isFormat, type BlockAttrs, type Format, type FormatSpec } from './formats';
export { StepError, type BlockKind, type Step } from './transform';
export {
  applyTransaction,
  caretOf,
  changesNothing,
  createState,
  isCollapsed,
  isValidSelection,
  normalizeSelection,
  sameSelection,
  selectionAtPlace,
  selectionBetween,
  selectionRange,
  selectionTransaction,
  startSelection,
  textSelection,
  withOrigin,
  withTime,
  TransactionError,
  type EditorState,
  type BlockSelection,
  type GapSelection,
  type Selection,
  type TextSelection,
  type Transaction,
  type TransactionOrigin,
} from './state';
export {
  createHistory,
  lastOrigin,
  recordTransaction,
  redo,
  undo,
  type HistoryOptions,
  type HistoryState,
} from './history';
export { activeMarks, arrowSelection, formatStates, isActive, type FormatState } from './queries';
export {
  deleteTargetRange,
  deleteSelectedBlock,
  exitEmptyBlock,
  indentList,
  insertFragment,
  insertText,
  joinBackward,
  joinForward,
  outdentList,
  outdentListAtStart,
  resetBlockAtStart,
  selectBlockBackward,
  selectBlockForward,
  splitBlock,
  toggleFormat,
  type Command,
  type CommandEnv,
} from './commands';
export { applyInputRules, undoInputRule } from './input-rules';
export {
  canonical,
  parseMarkdown,
  rawRenderer,
  serializeMarkdown,
  type RawHtmlOptions,
  type RawRenderer,
} from './markdown';
export { MARK_TAGS, serializeHtml } from './html';
export {
  SCHEMA_VERSION,
  SchemaError,
  fromJSON,
  toJSON,
  type MdJSON,
  type StoredBlock,
} from './json';
export { isSafeHref } from './url-policy';
