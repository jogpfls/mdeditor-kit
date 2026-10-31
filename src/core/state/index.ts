import { assertNever } from '../lang';
import {
  comparePos,
  contentLength,
  hasMark,
  isTextBlock,
  type Block,
  type Doc,
  type Mark,
  type Pos,
} from '../model';
import type { Draft, Step } from '../transform';

/**
 * A text selection. `anchor` is where it started, `focus` where it ends;
 * they are equal for a caret. Both are always in text blocks.
 */
export type TextSelection = { readonly kind: 'text'; readonly anchor: Pos; readonly focus: Pos };

/** A block without text (a divider, a raw block) selected as a whole. */
export type BlockSelection = { readonly kind: 'block'; readonly blockId: string };

/**
 * A place between blocks where no text block is next to it: between two
 * blocks without text, or before or after one at either end of the document.
 * `beforeBlockId` is the block after the place, `null` at the end.
 */
export type GapSelection = { readonly kind: 'gap'; readonly beforeBlockId: string | null };

/** What is selected. Only a valid selection (see `normalizeSelection`) is ever in a state. */
export type Selection = TextSelection | BlockSelection | GapSelection;

export type EditorState = {
  readonly doc: Doc;
  readonly selection: Selection;
  /** Marks the next typed text takes, set by toggling a mark at a caret. `null` means "follow the text". */
  readonly storedMarks: readonly Mark[] | null;
};

/**
 * Where a transaction came from. History uses it to decide what to group and
 * what to record. Undo and redo are told apart so history knows which stack
 * the change moves between.
 */
export type TransactionOrigin =
  | 'typing'
  | 'input-rule'
  | 'command'
  | 'paste'
  | 'cut'
  | 'drop'
  | 'composition'
  | 'selection'
  | 'undo'
  | 'redo';

/**
 * A change to the state. It carries the document it was built against
 * (`before`), the document that results (`doc`), the steps between them and
 * the steps that undo them, so applying it and recording it never replays a
 * step.
 */
export type Transaction = {
  readonly before: Doc;
  readonly doc: Doc;
  readonly steps: readonly Step[];
  /** Steps that undo `steps`, in the order they apply. */
  readonly inverse: readonly Step[];
  readonly selection: Selection;
  readonly storedMarks: readonly Mark[] | null;
  readonly origin: TransactionOrigin;
  /** When the event behind it happened (`event.timeStamp`), set by the view; core never reads a clock. */
  readonly time: number | null;
};

/** A transaction built against one document and applied to another. Always a bug in the caller. */
export class TransactionError extends Error {
  override readonly name = 'TransactionError';
}

/** Ends a draft as a transaction. */
export function transaction(
  draft: Draft,
  selection: Selection,
  origin: TransactionOrigin,
  storedMarks: readonly Mark[] | null = null,
): Transaction {
  const { doc, steps, inverse } = draft.result();
  return { before: draft.before, doc, steps, inverse, selection, storedMarks, origin, time: null };
}

/** A state with the selection at the start of the document (see `startSelection`). */
export function createState(doc: Doc): EditorState {
  return { doc, selection: startSelection(doc), storedMarks: null };
}

export function textSelection(anchor: Pos, focus: Pos = anchor): TextSelection {
  return { kind: 'text', anchor, focus };
}

/** The start of the document: a caret in the first block, or the place before it when it has no text. */
export function startSelection(doc: Doc): Selection {
  return selectionAtPlace(doc, 0);
}

/**
 * The selection for the place before the block at `index` (`blocks.length`
 * for the end): the end of the text block before it, else the start of the
 * text block after it, else the gap itself. Commands that remove or insert
 * blocks without text use it to say where the caret goes, so the document
 * never needs an extra empty paragraph to hold one.
 */
export function selectionAtPlace(doc: Doc, index: number): Selection {
  return selectionBetween(doc.blocks[index - 1], doc.blocks[index]);
}

/** The selection for the place between two neighbouring blocks (see `selectionAtPlace`). */
export function selectionBetween(before: Block | undefined, after: Block | undefined): Selection {
  if (before !== undefined && isTextBlock(before)) {
    return textSelection({ blockId: before.id, offset: contentLength(before.content) });
  }
  if (after !== undefined && isTextBlock(after)) {
    return textSelection({ blockId: after.id, offset: 0 });
  }
  return { kind: 'gap', beforeBlockId: after?.id ?? null };
}

/**
 * The valid selection closest to the one given, which may come from outside
 * (the view reading the DOM) or point at blocks that are gone:
 *
 * - a text position in a block without text moves towards the other end of
 *   the selection, to the nearest text; a caret on such a block, or a range
 *   with no text in it, selects the block instead;
 * - offsets are clamped to the block's content;
 * - a block selection on a text block becomes a caret at its start;
 * - a gap next to a text block becomes a caret in that block;
 * - anything pointing at a block that is not in the document goes to the start.
 */
export function normalizeSelection(doc: Doc, selection: Selection): Selection {
  switch (selection.kind) {
    case 'text':
      return normalizeText(doc, selection);
    case 'block': {
      const block = doc.blocks[indexOf(doc, selection.blockId)];
      if (block === undefined) return startSelection(doc);
      return isTextBlock(block) ? textSelection({ blockId: block.id, offset: 0 }) : selection;
    }
    case 'gap': {
      const index =
        selection.beforeBlockId === null
          ? doc.blocks.length
          : indexOf(doc, selection.beforeBlockId);
      return index < 0 ? startSelection(doc) : selectionAtPlace(doc, index);
    }
    default:
      return assertNever(selection);
  }
}

function normalizeText(doc: Doc, selection: TextSelection): Selection {
  const anchorIndex = indexOf(doc, selection.anchor.blockId);
  const focusIndex = indexOf(doc, selection.focus.blockId);
  if (anchorIndex < 0 || focusIndex < 0) return startSelection(doc);
  const anchor = textPosToward(doc, anchorIndex, selection.anchor.offset, focusIndex);
  const focus = textPosToward(doc, focusIndex, selection.focus.offset, anchorIndex);
  if (anchor === null || focus === null) {
    const block = doc.blocks[focusIndex];
    return block === undefined ? startSelection(doc) : { kind: 'block', blockId: block.id };
  }
  const normal = textSelection(anchor, focus);
  return sameSelection(selection, normal) ? selection : normal;
}

/**
 * Where one end of a text selection goes: its own position, clamped, when
 * its block has text; else the nearest text on the way to `other`, the index
 * of the other end. `null` when there is none.
 */
function textPosToward(doc: Doc, index: number, offset: number, other: number): Pos | null {
  const step = Math.sign(other - index);
  const last = step === 0 ? index : other;
  for (let i = index; step >= 0 ? i <= last : i >= last; i += step === 0 ? 1 : step) {
    const block = doc.blocks[i];
    if (block === undefined || !isTextBlock(block)) continue;
    const length = contentLength(block.content);
    if (i === index) return { blockId: block.id, offset: Math.min(Math.max(offset, 0), length) };
    return { blockId: block.id, offset: step > 0 ? 0 : length };
  }
  return null;
}

/** Whether a selection is valid in a document: normalizing it leaves it as it is. */
export function isValidSelection(doc: Doc, selection: Selection): boolean {
  return sameSelection(normalizeSelection(doc, selection), selection);
}

function indexOf(doc: Doc, blockId: string): number {
  return doc.blocks.findIndex((block) => block.id === blockId);
}

/** The state after a transaction, which must have been built against this state's document. */
export function applyTransaction(state: EditorState, tr: Transaction): EditorState {
  if (tr.before !== state.doc) {
    throw new TransactionError('The transaction was built against another document');
  }
  return { doc: tr.doc, selection: tr.selection, storedMarks: tr.storedMarks };
}

/**
 * One transaction doing `first` and then `second`, which was built against
 * the document `first` produced. The rest (selection, origin) is `second`'s.
 */
export function followedBy(first: Transaction, second: Transaction): Transaction {
  if (second.before !== first.doc) {
    throw new TransactionError('The second transaction does not continue the first');
  }
  return {
    ...second,
    before: first.before,
    steps: [...first.steps, ...second.steps],
    inverse: [...second.inverse, ...first.inverse],
  };
}

/** Whether a text selection is a caret. */
export function isCollapsed(selection: TextSelection): boolean {
  return samePos(selection.anchor, selection.focus);
}

/** The caret, when the selection is one. */
export function caretOf(selection: Selection): Pos | null {
  return selection.kind === 'text' && isCollapsed(selection) ? selection.focus : null;
}

export function sameSelection(a: Selection, b: Selection): boolean {
  switch (a.kind) {
    case 'text':
      return b.kind === 'text' && samePos(a.anchor, b.anchor) && samePos(a.focus, b.focus);
    case 'block':
      return b.kind === 'block' && a.blockId === b.blockId;
    case 'gap':
      return b.kind === 'gap' && a.beforeBlockId === b.beforeBlockId;
    default:
      return assertNever(a);
  }
}

function samePos(a: Pos, b: Pos): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}

/**
 * Whether applying the transaction to this state leaves it as it was: no
 * step, the same selection and the same stored marks. A command returns
 * `null` instead of such a transaction, so a chain of commands moves on to
 * the next one and history never records it.
 */
export function changesNothing(state: EditorState, tr: Transaction): boolean {
  return (
    tr.steps.length === 0 &&
    sameSelection(state.selection, tr.selection) &&
    sameStoredMarks(state.storedMarks, tr.storedMarks)
  );
}

function sameStoredMarks(a: readonly Mark[] | null, b: readonly Mark[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((mark) => hasMark(b, mark));
}

/** The text selection's ends in document order. */
export function selectionRange(
  doc: Doc,
  selection: TextSelection,
): { readonly from: Pos; readonly to: Pos } {
  const { anchor, focus } = selection;
  return comparePos(doc, anchor, focus) <= 0
    ? { from: anchor, to: focus }
    : { from: focus, to: anchor };
}

/**
 * A selection-only transaction, recording where the user moved the caret.
 * The selection may come from outside, so it is normalized first. Moving the
 * caret forgets stored marks: they belong to the place they were set.
 */
export function selectionTransaction(state: EditorState, selection: Selection): Transaction {
  return {
    before: state.doc,
    doc: state.doc,
    steps: [],
    inverse: [],
    selection: normalizeSelection(state.doc, selection),
    storedMarks: null,
    origin: 'selection',
    time: null,
  };
}

/** The same transaction, attributed to another origin (a cut or a drop runs a typing command). */
export function withOrigin(tr: Transaction, origin: TransactionOrigin): Transaction {
  return { ...tr, origin };
}

/** The same transaction, stamped with when its event happened (`event.timeStamp`). */
export function withTime(tr: Transaction, time: number): Transaction {
  return { ...tr, time };
}
