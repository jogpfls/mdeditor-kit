import { formatSpec, type BlockAttrs, type Format } from '../formats';
import { assertNever } from '../lang';
import {
  contentLength,
  hasMark,
  isTextBlock,
  marksAt,
  sliceContent,
  type Block,
  type Inline,
  type Mark,
  type TextBlock,
} from '../model';
import {
  isCollapsed,
  selectionBetween,
  selectionRange,
  textSelection,
  type EditorState,
  type Selection,
  type TextSelection,
} from '../state';

/** What a toolbar button shows for a format. */
export type FormatState = {
  /** The format is on for the whole selection. */
  readonly active: boolean;
  /** The format can be applied to the selection at all. */
  readonly applicable: boolean;
};

/**
 * The state of every format for the selection, worked out in one pass over
 * the selection, so a toolbar asks once per state however many buttons it
 * has. Returns a lookup; asking it costs nothing more.
 *
 * - A mark is on when all selected text carries it. At a caret, the stored
 *   marks decide if there are any, otherwise the marks typed text would take
 *   (`marksAt`).
 * - A block format is on when every text block the selection touches has that
 *   type (and heading level). Blocks without text are skipped, as the toggle
 *   skips them. The list indent does not matter.
 * - An insert format has no state and is never on.
 * - A block selection and a gap hold no text: marks and block formats are
 *   neither on nor applicable there; an insert format is applicable anywhere.
 */
export function formatStates(state: EditorState): (format: Format) => FormatState {
  const summary = summarize(state);
  return (format) => {
    const spec = formatSpec(format);
    switch (spec.kind) {
      case 'mark':
        return { active: hasMark(summary.marks, spec.mark), applicable: summary.text };
      case 'block':
        return { active: matches(summary.shape, spec.block), applicable: summary.text };
      case 'insert':
        return { active: false, applicable: true };
      default:
        return assertNever(spec);
    }
  };
}

/** Whether a format is on for the selection (see `formatStates`). */
export function isActive(state: EditorState, format: Format): boolean {
  return formatStates(state)(format).active;
}

/** The marks every selected character carries, or at a caret the marks typed text would take. */
export function activeMarks(state: EditorState): readonly Mark[] {
  return summarize(state).marks;
}

/** The type the selected text blocks share, or why there is none. */
type Shape = TextBlock | 'mixed' | 'none';

type Summary = {
  /** The selection holds text: it is a text selection. */
  readonly text: boolean;
  readonly marks: readonly Mark[];
  /** A text block standing for the type every selected text block has. */
  readonly shape: Shape;
};

const NO_TEXT: Summary = { text: false, marks: [], shape: 'none' };

function summarize(state: EditorState): Summary {
  const { selection } = state;
  switch (selection.kind) {
    case 'text':
      return summarizeText(state, selection);
    case 'block':
    case 'gap':
      return NO_TEXT;
    default:
      return assertNever(selection);
  }
}

/**
 * One pass over the selected blocks. It stops as soon as no mark is common
 * to everything seen and the blocks no longer share a type: nothing further
 * can turn a format back on.
 */
function summarizeText(state: EditorState, selection: TextSelection): Summary {
  const { doc, storedMarks } = state;
  const { from, to } = selectionRange(doc, selection);
  const first = doc.blocks.findIndex((block) => block.id === from.blockId);
  const last = doc.blocks.findIndex((block) => block.id === to.blockId);

  if (isCollapsed(selection)) {
    const block = doc.blocks[first];
    if (block === undefined || !isTextBlock(block)) return NO_TEXT;
    return { text: true, marks: storedMarks ?? marksAt(block.content, from.offset), shape: block };
  }

  let marks: readonly Mark[] | null = null;
  let shape: Shape = 'none';
  for (let index = first; index <= last; index += 1) {
    const block = doc.blocks[index];
    if (block === undefined || !isTextBlock(block)) continue;
    shape = combine(shape, block);
    for (const piece of piecesInRange(
      block,
      index === first ? from.offset : 0,
      index === last ? to.offset : null,
    )) {
      marks = marks === null ? piece.marks : marks.filter((mark) => hasMark(piece.marks, mark));
    }
    if (shape === 'mixed' && marks !== null && marks.length === 0) break;
  }
  return { text: true, marks: marks ?? [], shape };
}

/** The content of a block between two offsets; `null` for its end. A whole block is not sliced. */
function piecesInRange(block: TextBlock, start: number, end: number | null): readonly Inline[] {
  if (start === 0 && end === null) return block.content;
  return sliceContent(block.content, start, end ?? contentLength(block.content));
}

function combine(shape: Shape, block: TextBlock): Shape {
  if (shape === 'none') return block;
  if (shape === 'mixed') return shape;
  return sameShape(shape, block) ? shape : 'mixed';
}

function sameShape(a: TextBlock, b: TextBlock): boolean {
  return (
    a.type === b.type && (a.type !== 'heading' || (b.type === 'heading' && a.level === b.level))
  );
}

function matches(shape: Shape, attrs: BlockAttrs): boolean {
  if (shape === 'none' || shape === 'mixed') return false;
  switch (attrs.type) {
    case 'heading':
      return shape.type === 'heading' && shape.level === attrs.level;
    case 'quote':
    case 'bullet':
    case 'ordered':
    case 'divider':
      return shape.type === attrs.type;
    default:
      return assertNever(attrs);
  }
}

/**
 * Where a horizontal arrow key takes the selection when it crosses a block
 * without text, or `null` when the browser's own caret movement applies.
 *
 * - From a caret at the edge of a text block, towards a block without text:
 *   that block, selected.
 * - From a selected block: the text block next to it (its near edge), else
 *   the gap next to it.
 * - From a gap: the block next to it, selected; nothing at either end.
 *
 * A text range collapses the browser's way, so it gets `null`.
 */
export function arrowSelection(
  state: EditorState,
  direction: 'backward' | 'forward',
): Selection | null {
  const { doc, selection } = state;
  const step = direction === 'forward' ? 1 : -1;
  switch (selection.kind) {
    case 'text': {
      if (!isCollapsed(selection)) return null;
      const { focus } = selection;
      const index = doc.blocks.findIndex((block) => block.id === focus.blockId);
      const block = doc.blocks[index];
      if (block === undefined || !isTextBlock(block)) return null;
      const atEdge = step > 0 ? focus.offset === contentLength(block.content) : focus.offset === 0;
      const next = doc.blocks[index + step];
      return atEdge && next !== undefined && !isTextBlock(next) ? selected(next) : null;
    }
    case 'block': {
      const index = doc.blocks.findIndex((block) => block.id === selection.blockId);
      if (index < 0) return null;
      const place = step > 0 ? index + 1 : index;
      return selectionBetween(doc.blocks[place - 1], doc.blocks[place]);
    }
    case 'gap': {
      const place =
        selection.beforeBlockId === null
          ? doc.blocks.length
          : doc.blocks.findIndex((block) => block.id === selection.beforeBlockId);
      const next = doc.blocks[step > 0 ? place : place - 1];
      if (next === undefined) return null;
      return isTextBlock(next)
        ? textSelection({ blockId: next.id, offset: step > 0 ? 0 : contentLength(next.content) })
        : selected(next);
    }
    default:
      return assertNever(selection);
  }
}

function selected(block: Block): Selection {
  return { kind: 'block', blockId: block.id };
}
