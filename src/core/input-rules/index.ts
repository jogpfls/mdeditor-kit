import { toggleFormat, type CommandEnv } from '../commands';
import { FORMATS, headingFormat, type Format, type FormatSpec } from '../formats';
import { lastOrigin, undo, type HistoryState } from '../history';
import { assertNever, charClass, escapeRegExp } from '../lang';
import { MARKDOWN_SYNTAX, markSyntax } from '../markdown';
import {
  ATOM_CHAR,
  MARK_TYPES,
  MAX_HEADING_LEVEL,
  blockIndex,
  contentLength,
  contentText,
  hasMark,
  isHeadingLevel,
  isTextBlock,
  makeTextBlock,
  marksAt,
  sameMark,
  sliceContent,
  startsOrderedRun,
  type Mark,
  type TextBlock,
} from '../model';
import {
  applyTransaction,
  caretOf,
  followedBy,
  textSelection,
  transaction,
  withOrigin,
  type EditorState,
  type Transaction,
} from '../state';
import { Draft } from '../transform';

/** What a block rule turns the paragraph into; `start` is the number an ordered list was typed with. */
type BlockChange = { readonly format: Format; readonly start?: number };

type BlockRule = {
  readonly pattern: RegExp;
  readonly change: (match: RegExpExecArray) => BlockChange | null;
  /** The rule needs the whole line to match, not only the text before the caret. */
  readonly wholeLine?: boolean;
};

type InlineRule = { readonly mark: Mark; readonly delimiter: string; readonly pattern: RegExp };

const { heading, quote, bullet, ordered, divider } = MARKDOWN_SYNTAX;

/**
 * Block rules, derived from the markdown syntax. They apply in a paragraph
 * when the text from the start of the block to the caret matches as a whole.
 */
const BLOCK_RULES: readonly BlockRule[] = [
  {
    pattern: new RegExp(`^((?:${escapeRegExp(heading.marker)}){1,${MAX_HEADING_LEVEL}}) $`),
    change: (match) => {
      const level = (match[1] ?? '').length / heading.marker.length;
      return isHeadingLevel(level) ? { format: headingFormat(level) } : null;
    },
  },
  { pattern: new RegExp(`^${escapeRegExp(quote.marker)} $`), change: () => ({ format: 'quote' }) },
  { pattern: new RegExp(`^${charClass(bullet.markers)} $`), change: () => ({ format: 'bullet' }) },
  {
    pattern: new RegExp(`^(\\d{1,${ordered.maxDigits}})${charClass(ordered.delimiters)} $`),
    change: (match) => ({ format: 'ordered', start: Number(match[1]) }),
  },
  {
    pattern: new RegExp(`^${escapeRegExp(divider.written)}$`),
    change: () => ({ format: 'divider' }),
    wholeLine: true,
  },
];

/**
 * Inline rules, one per mark format, matched against the text ending at the
 * caret. Only the first rule that matches is considered: code first, since its
 * content is literal, then longer delimiters before shorter ones.
 */
const INLINE_RULES: readonly InlineRule[] = Object.values(FORMATS)
  .flatMap((value) => {
    const spec: FormatSpec = value;
    switch (spec.kind) {
      case 'mark':
        return inlineRule(spec.mark);
      case 'block':
      case 'insert':
        return [];
      default:
        return assertNever(spec);
    }
  })
  .sort((a, b) => precedence(a) - precedence(b));

/** Matches any one character but these, and never an atom: rules do not reach across atoms. */
function except(chars: string): string {
  return `[^${chars}${ATOM_CHAR}]`;
}

/**
 * The rule for one mark. A delimited mark's text may not start or end with
 * whitespace, as in CommonMark. A delimiter that begins a longer one (`*` in
 * `**`) does not fire right after its own character, so typing towards `**`
 * does not trigger the shorter rule on the way.
 */
function inlineRule(mark: Mark): InlineRule[] {
  const syntax = markSyntax(mark.type);
  switch (syntax.kind) {
    case 'code': {
      const { delimiter } = syntax;
      const open = escapeRegExp(delimiter);
      const inner = `${except(escapeRegExp(delimiter.slice(0, 1)))}+`;
      return [{ mark, delimiter, pattern: new RegExp(`${open}(${inner})${open}$`) }];
    }
    case 'delimited': {
      const { delimiter } = syntax;
      const char = escapeRegExp(delimiter.slice(0, 1));
      const open = escapeRegExp(delimiter);
      const guard = isPrefixOfLonger(delimiter) ? `(?<!${char})` : '';
      const edge = except(`${char}\\s`);
      const inner = `${edge}(?:${except(char)}*${edge})?`;
      return [{ mark, delimiter, pattern: new RegExp(`${guard}${open}(${inner})${open}$`) }];
    }
    case 'link':
      return [];
    default:
      return assertNever(syntax);
  }
}

/** Whether a longer delimiter of another mark starts with this one (`*` in `**`). */
function isPrefixOfLonger(delimiter: string): boolean {
  return MARK_TYPES.some((type) => {
    const syntax = markSyntax(type);
    switch (syntax.kind) {
      case 'delimited':
      case 'code':
        return syntax.delimiter.length > delimiter.length && syntax.delimiter.startsWith(delimiter);
      case 'link':
        return false;
      default:
        return assertNever(syntax);
    }
  });
}

function precedence(rule: InlineRule): number {
  const syntax = markSyntax(rule.mark.type);
  switch (syntax.kind) {
    case 'code':
      return 0;
    case 'delimited':
      return 1 / syntax.delimiter.length;
    case 'link':
      return 1;
    default:
      return assertNever(syntax);
  }
}

/**
 * Turns markdown typed at the caret into formatting, after text was inserted.
 *
 * A block rule removes its syntax (`# `, `- `, `---` …) and changes the block.
 * An inline rule removes the delimiters and marks the text between them; the
 * caret then leaves that mark, so the next character is typed outside it. A
 * match that contains code is not formatted by the other inline rules.
 */
export function applyInputRules(state: EditorState, env: CommandEnv): Transaction | null {
  const caret = caretOf(state.selection);
  if (caret === null) return null;
  const block = state.doc.blocks[blockIndex(state.doc, caret)];
  if (block === undefined || !isTextBlock(block)) return null;
  const before = contentText(block.content).slice(0, caret.offset);

  if (block.type === 'paragraph') {
    const lineLength = contentLength(block.content);
    for (const rule of BLOCK_RULES) {
      const match = rule.pattern.exec(before);
      if (match === null || (rule.wholeLine === true && caret.offset !== lineLength)) continue;
      const change = rule.change(match);
      if (change !== null) return applyBlockRule(state, block, caret.offset, change, env);
    }
  }

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(before);
    if (match !== null) return applyInlineRule(state, block, caret.offset, match, rule);
  }
  return null;
}

const DEFAULT_START = 1;

/**
 * Removes the typed syntax and applies the format. An ordered list typed with
 * a number keeps it as its start number when the item starts a run; an item
 * that continues a run counts on from it, whatever was typed.
 */
function applyBlockRule(
  state: EditorState,
  block: TextBlock,
  offset: number,
  change: BlockChange,
  env: CommandEnv,
): Transaction | null {
  const caret = { blockId: block.id, offset: 0 };
  const draft = new Draft(state.doc).apply({
    type: 'replaceText',
    blockId: block.id,
    from: 0,
    to: offset,
    content: [],
  });
  const removed = transaction(draft, textSelection(caret), 'input-rule');
  const formatted = toggleFormat(change.format)(applyTransaction(state, removed), undefined, env);
  if (formatted === null) return null;
  const done = followedBy(removed, formatted);
  const numbered = change.start === undefined ? null : withStart(done, block.id, change.start);
  return withOrigin(numbered === null ? done : followedBy(done, numbered), 'input-rule');
}

/**
 * Gives the ordered item a start number, if it starts a run and the number is
 * not 1, the default; `null` when nothing changes.
 */
function withStart(tr: Transaction, blockId: string, start: number): Transaction | null {
  if (start === DEFAULT_START) return null;
  const draft = new Draft(tr.doc);
  const target = draft.at(blockId);
  if (target === null || target.block.type !== 'ordered') return null;
  if (!startsOrderedRun(tr.doc.blocks, target.index)) return null;
  const { index, block } = target;
  draft.apply({
    type: 'replaceBlocks',
    from: index,
    to: index + 1,
    blocks: [
      makeTextBlock(block.id, { type: 'ordered', indent: block.indent, start }, block.content),
    ],
  });
  return draft.hasSteps ? transaction(draft, tr.selection, 'input-rule', tr.storedMarks) : null;
}

function applyInlineRule(
  state: EditorState,
  block: TextBlock,
  offset: number,
  match: RegExpExecArray,
  rule: InlineRule,
): Transaction | null {
  const inner = match[1] ?? '';
  const start = offset - match[0].length;
  const size = rule.delimiter.length;
  const code: Mark = { type: 'code' };
  const containsCode = sliceContent(block.content, start, offset).some((inline) =>
    hasMark(inline.marks, code),
  );
  if (containsCode && !sameMark(rule.mark, code)) return null;

  const end = start + inner.length;
  const draft = new Draft(state.doc)
    .apply({ type: 'replaceText', blockId: block.id, from: offset - size, to: offset, content: [] })
    .apply({ type: 'replaceText', blockId: block.id, from: start, to: start + size, content: [] })
    .apply({
      type: 'addMark',
      from: { blockId: block.id, offset: start },
      to: { blockId: block.id, offset: end },
      mark: rule.mark,
    });
  const marked = draft.at(block.id)?.block;
  const outside = marked !== undefined && isTextBlock(marked) ? marksAt(marked.content, end) : [];
  const caret = { blockId: block.id, offset: end };
  return transaction(
    draft,
    textSelection(caret),
    'input-rule',
    outside.filter((mark) => !sameMark(mark, rule.mark)),
  );
}

/**
 * Backspace right after an input rule fired undoes it, bringing back the
 * syntax that was typed (`# `, `**bold**` …). It applies only when the rule's
 * transaction was the last thing that happened, with no caret move since.
 */
export function undoInputRule(
  state: EditorState,
  input: unknown,
  env: { readonly history: HistoryState },
): Transaction | null {
  if (lastOrigin(env.history) !== 'input-rule') return null;
  return undo(state, input, env);
}
