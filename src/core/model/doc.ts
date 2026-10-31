import { assertNever } from '../lang';
import { normalizeContent, sameContent, text } from './content';
import {
  MAX_INDENT,
  MAX_ORDERED_START,
  type Block,
  type CreateId,
  type Doc,
  type Fragment,
  type HeadingLevel,
  type Inline,
  type ListBlock,
  type TextBlock,
} from './types';

/** The content of a block, or `null` for a block without any (a divider, a raw block). */
export function blockContent(block: Block): readonly Inline[] | null {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bullet':
    case 'ordered':
      return block.content;
    case 'divider':
    case 'raw':
      return null;
    default:
      return assertNever(block);
  }
}

export function isTextBlock(block: Block): block is TextBlock {
  return blockContent(block) !== null;
}

export function isListBlock(block: Block): block is ListBlock {
  switch (block.type) {
    case 'bullet':
    case 'ordered':
      return true;
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'divider':
    case 'raw':
      return false;
    default:
      return assertNever(block);
  }
}

/** The same block holding different content. */
export function withContent<B extends TextBlock>(block: B, content: readonly Inline[]): B {
  return { ...block, content };
}

/**
 * A fresh id generator counting from zero: `b0`, `b1` … Each call gives its
 * own counter, so documents and editors never share state. Ids only need to
 * be unique within one document; they are not stored (see `toJSON`).
 */
export function idCounter(): CreateId {
  let next = 0;
  return () => `b${next++}`;
}

export function emptyParagraph(createId: CreateId): Block {
  return { id: createId(), type: 'paragraph', content: [] };
}

/** What a list item is apart from its id and content. */
export type ListAttrs =
  | { readonly type: 'bullet'; readonly indent: number }
  | { readonly type: 'ordered'; readonly indent: number; readonly start?: number };

/** What a text block is apart from its id and content. */
export type TextBlockAttrs =
  | { readonly type: 'paragraph' }
  | { readonly type: 'heading'; readonly level: HeadingLevel }
  | { readonly type: 'quote' }
  | ListAttrs;

export function textBlockAttrs(block: TextBlock): TextBlockAttrs {
  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return { type: block.type };
    case 'heading':
      return { type: block.type, level: block.level };
    case 'bullet':
    case 'ordered':
      return listAttrs(block);
    default:
      return assertNever(block);
  }
}

export function listAttrs(block: ListBlock): ListAttrs {
  switch (block.type) {
    case 'bullet':
      return { type: block.type, indent: block.indent };
    case 'ordered':
      return block.start === undefined
        ? { type: block.type, indent: block.indent }
        : { type: block.type, indent: block.indent, start: block.start };
    default:
      return assertNever(block);
  }
}

/**
 * The attributes a text block continues with in the next block (Enter, or the
 * later lines of a split): the same, except that a list's start number stays
 * with the item that starts the run.
 */
export function continuedAttrs(attrs: TextBlockAttrs): TextBlockAttrs {
  switch (attrs.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bullet':
      return attrs;
    case 'ordered':
      return { type: attrs.type, indent: attrs.indent };
    default:
      return assertNever(attrs);
  }
}

export function makeTextBlock(
  id: string,
  attrs: TextBlockAttrs,
  content: readonly Inline[],
): TextBlock {
  switch (attrs.type) {
    case 'paragraph':
    case 'quote':
      return { id, type: attrs.type, content };
    case 'heading':
      return { id, type: attrs.type, level: attrs.level, content };
    case 'bullet':
      return { id, type: attrs.type, indent: attrs.indent, content };
    case 'ordered':
      return attrs.start === undefined
        ? { id, type: attrs.type, indent: attrs.indent, content }
        : { id, type: attrs.type, indent: attrs.indent, start: attrs.start, content };
    default:
      return assertNever(attrs);
  }
}

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Restores the document invariants where outside input enters (parsing,
 * pasting, loading JSON):
 *
 * - at least one block;
 * - text holds no line break: a block whose text does is split into blocks of
 *   the same type, one per line (raw blocks may hold line breaks);
 * - block ids are unique and not empty: a repeated or empty id is replaced;
 * - content is normalized (see `normalizeContent`);
 * - lists are trees and only the first item of an ordered run has a start
 *   number (see `listRepairs`).
 *
 * Commands keep these invariants themselves; a command's result is already
 * normal. Unchanged blocks keep their reference, and a document that is
 * already normal is returned as is.
 */
export function normalizeDoc(doc: Doc, createId: CreateId): Doc {
  if (doc.blocks.length === 0) return { blocks: [emptyParagraph(createId)] };

  const split = splitLines(doc.blocks, createId);
  // Every id in the input is taken, so a new id never displaces a later block's own.
  const taken = new Set(split.map((block) => block.id));
  const seen = new Set<string>();
  const unique = split.map((block) => {
    const id = block.id === '' || seen.has(block.id) ? freshId(createId, taken) : block.id;
    seen.add(id);
    taken.add(id);
    return id === block.id ? block : { ...block, id };
  });
  const normalized = unique.map(normalizeBlockContent);
  const blocks = applyListRepairs(normalized);

  const unchanged =
    blocks.length === doc.blocks.length &&
    blocks.every((block, index) => block === doc.blocks[index]);
  return unchanged ? doc : { blocks };
}

/**
 * A fragment made fit to insert: content normalized and lines split, as in
 * `normalizeDoc`. Ids are left alone; inserting gives blocks new ones.
 */
export function normalizeFragment(fragment: Fragment, createId: CreateId): Fragment {
  return splitLines(fragment, createId).map(normalizeBlockContent);
}

function freshId(createId: CreateId, taken: ReadonlySet<string>): string {
  let id = createId();
  while (id === '' || taken.has(id)) id = createId();
  return id;
}

/** Splits every text block whose text holds a line break into one block per line. */
function splitLines(blocks: readonly Block[], createId: CreateId): Block[] {
  return blocks.flatMap((block): Block[] => {
    if (!isTextBlock(block)) return [block];
    const lines = contentLines(block.content);
    if (lines.length === 1) return [block];
    const rest = continuedAttrs(textBlockAttrs(block));
    return lines.map((line, index) =>
      index === 0 ? withContent(block, line) : makeTextBlock(createId(), rest, line),
    );
  });
}

/** Content cut at every line break in its text runs. */
function contentLines(content: readonly Inline[]): Inline[][] {
  const lines: Inline[][] = [[]];
  for (const inline of content) {
    switch (inline.type) {
      case 'text':
        inline.text.split(LINE_BREAK).forEach((part, index) => {
          if (index > 0) lines.push([]);
          lines[lines.length - 1]?.push(text(part, inline.marks));
        });
        break;
      case 'raw':
        lines[lines.length - 1]?.push(inline);
        break;
      default:
        assertNever(inline);
    }
  }
  return lines;
}

function normalizeBlockContent(block: Block): Block {
  if (!isTextBlock(block)) return block;
  const content = normalizeContent(block.content);
  return sameContent(content, block.content) ? block : withContent(block, content);
}

function applyListRepairs(blocks: readonly Block[]): readonly Block[] {
  const repairs = new Map(listRepairs(blocks).map((repair) => [repair.index, repair.attrs]));
  if (repairs.size === 0) return blocks;
  return blocks.map((block, index) => {
    const attrs = repairs.get(index);
    return attrs === undefined || !isListBlock(block)
      ? block
      : makeTextBlock(block.id, attrs, block.content);
  });
}

/** A list item whose attributes have to change for the lists to be normal. */
export type ListRepair = { readonly index: number; readonly attrs: ListAttrs };

/**
 * The changes that make the lists in `blocks` normal.
 *
 * A list is a tree stored flat. Every item that is not a root has a parent,
 * the nearest earlier list item one level shallower. So an item is at most one
 * level deeper than the list item right before it, never deeper than
 * `MAX_INDENT`, and the first item after anything that is not a list is a root.
 * An item that breaks this is moved up to the deepest place it may take, and
 * the items that followed it at its depth or deeper move up by the same amount,
 * so siblings stay siblings and children stay children.
 *
 * Only the first item of an ordered run (see `listNumbers`) keeps a start
 * number, and only one that is an integer from 0 to `MAX_ORDERED_START` other
 * than 1, the default.
 */
export function listRepairs(blocks: readonly Block[]): readonly ListRepair[] {
  const indents = repairedIndents(blocks);
  const placed = blocks.map((block, index) => {
    const indent = indents[index];
    return indent === undefined || !isListBlock(block) ? block : { ...block, indent };
  });
  const starts = runStarts(placed);

  const repairs: ListRepair[] = [];
  placed.forEach((block, index) => {
    if (!isListBlock(block)) return;
    const attrs = repairedAttrs(block, starts[index] === true);
    const original = blocks[index];
    if (original === undefined || !isListBlock(original)) return;
    if (!sameTextBlockAttrs(attrs, listAttrs(original))) repairs.push({ index, attrs });
  });
  return repairs;
}

function repairedAttrs(block: ListBlock, startsRun: boolean): ListAttrs {
  switch (block.type) {
    case 'bullet':
      return { type: block.type, indent: block.indent };
    case 'ordered': {
      const { start } = block;
      const keeps = startsRun && start !== undefined && start !== 1 && isValidStart(start);
      return keeps
        ? { type: block.type, indent: block.indent, start }
        : { type: block.type, indent: block.indent };
    }
    default:
      return assertNever(block);
  }
}

function isValidStart(start: number): boolean {
  return Number.isInteger(start) && start >= 0 && start <= MAX_ORDERED_START;
}

export function sameTextBlockAttrs(a: TextBlockAttrs, b: TextBlockAttrs): boolean {
  switch (a.type) {
    case 'paragraph':
    case 'quote':
      return b.type === a.type;
    case 'heading':
      return b.type === 'heading' && a.level === b.level;
    case 'bullet':
      return b.type === 'bullet' && a.indent === b.indent;
    case 'ordered':
      return b.type === 'ordered' && a.indent === b.indent && a.start === b.start;
    default:
      return assertNever(a);
  }
}

/** The indent each list item takes for the lists to be trees; `undefined` for other blocks. */
function repairedIndents(blocks: readonly Block[]): (number | undefined)[] {
  let previous = -1;
  let shift: { readonly from: number; readonly by: number } | null = null;

  return blocks.map((block) => {
    if (!isListBlock(block)) {
      previous = -1;
      shift = null;
      return undefined;
    }
    if (shift !== null && block.indent < shift.from) shift = null;
    const deepest = Math.min(previous + 1, MAX_INDENT);
    let indent = Math.max(0, block.indent + (shift?.by ?? 0));
    if (indent > deepest) {
      shift = { from: block.indent, by: deepest - block.indent };
      indent = deepest;
    }
    previous = indent;
    return indent;
  });
}

/**
 * Whether the block at `index` is an ordered item that starts a run, so it
 * may carry a start number. Only the list the block is in is read.
 */
export function startsOrderedRun(blocks: readonly Block[], index: number): boolean {
  let first = index;
  while (first > 0 && isList(blocks[first - 1])) first -= 1;
  return runStarts(blocks.slice(first, index + 1))[index - first] === true;
}

function isList(block: Block | undefined): boolean {
  return block !== undefined && isListBlock(block);
}

/** Whether each block is an ordered item that starts a run (see `listNumbers`). */
function runStarts(blocks: readonly Block[]): boolean[] {
  let last: (number | null)[] = [];
  return blocks.map((block) => {
    if (!isListBlock(block)) {
      last = [];
      return false;
    }
    last = last.slice(0, block.indent + 1);
    switch (block.type) {
      case 'bullet':
        last[block.indent] = null;
        return false;
      case 'ordered': {
        const starts = (last[block.indent] ?? null) === null;
        last[block.indent] = 0;
        return starts;
      }
      default:
        return assertNever(block);
    }
  });
}

/**
 * The number each ordered item shows, `null` for every other block.
 *
 * Ordered items at the same depth form a run that counts on from the run's
 * start number (1 unless the first item says otherwise). A run ends at
 * anything that is not a list, at a bullet at the same depth, and at an item
 * at a shallower depth; items nested deeper in between do not end it. This is
 * how the editor's CSS counters number items, and the only numbering markdown
 * can write without blank lines.
 */
export function listNumbers(blocks: readonly Block[]): readonly (number | null)[] {
  let last: (number | null)[] = [];
  return blocks.map((block) => {
    if (!isListBlock(block)) {
      last = [];
      return null;
    }
    last = last.slice(0, block.indent + 1);
    switch (block.type) {
      case 'bullet':
        last[block.indent] = null;
        return null;
      case 'ordered': {
        const previous = last[block.indent] ?? null;
        const number = previous === null ? (block.start ?? 1) : previous + 1;
        last[block.indent] = number;
        return number;
      }
      default:
        return assertNever(block);
    }
  });
}
