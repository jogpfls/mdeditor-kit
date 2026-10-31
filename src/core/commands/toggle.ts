import { formatSpec, type BlockAttrs, type Format } from '../formats';
import { assertNever } from '../lang';
import { makeTextBlock, sameMark, type Block, type Mark } from '../model';
import { activeMarks, isActive } from '../queries';
import {
  isCollapsed,
  selectionRange,
  type EditorState,
  type TextSelection,
  type Transaction,
} from '../state';
import { Draft, type BlockKind } from '../transform';
import {
  finish,
  gapIndex,
  insertBlocksAt,
  replaceBlock,
  type Command,
  type CommandEnv,
} from './command';

/**
 * Turns a format on or off for the selection, the way a toolbar button does.
 *
 * - A mark is removed when all selected text has it and added otherwise;
 *   dividers are skipped. At a caret it toggles the stored marks instead.
 * - A block format turns the selected text blocks back into paragraphs when
 *   they all have it, and into that type otherwise. A list item keeps its
 *   indent when it becomes the other kind of list.
 * - Neither applies to a block selection or a gap, which hold no text.
 * - An insert format replaces the current block when that is an empty
 *   paragraph, and goes in after it otherwise; with a block selected it goes
 *   in after that block, at a gap it goes in there.
 */
export function toggleFormat(format: Format): Command {
  return (state, _input, env) => {
    const spec = formatSpec(format);
    const { selection } = state;
    switch (spec.kind) {
      case 'mark':
        return selection.kind === 'text'
          ? toggleMark(state, selection, spec.mark, isActive(state, format))
          : null;
      case 'block':
        return selection.kind === 'text'
          ? toggleBlock(state, selection, spec.block, isActive(state, format))
          : null;
      case 'insert':
        return insertBlock(state, spec.block, env);
      default:
        return assertNever(spec);
    }
  };
}

function toggleMark(
  state: EditorState,
  selection: TextSelection,
  mark: Mark,
  active: boolean,
): Transaction | null {
  if (isCollapsed(selection)) {
    const marks = activeMarks(state);
    const stored = active ? marks.filter((m) => !sameMark(m, mark)) : [...marks, mark];
    return finish(state, new Draft(state.doc), selection, 'command', stored);
  }
  const { from, to } = selectionRange(state.doc, selection);
  // An atom never takes `code`; the step's normalizing drops it there.
  const draft = new Draft(state.doc).apply({
    type: active ? 'removeMark' : 'addMark',
    from,
    to,
    mark,
  });
  return finish(state, draft, selection, 'command');
}

function toggleBlock(
  state: EditorState,
  selection: TextSelection,
  attrs: BlockAttrs,
  active: boolean,
): Transaction | null {
  const kind = active ? { type: 'paragraph' as const } : blockKind(attrs);
  const draft = new Draft(state.doc);
  if (kind !== null) {
    const { from, to } = selectionRange(state.doc, selection);
    draft.apply({ type: 'setBlockKind', fromId: from.blockId, toId: to.blockId, kind });
  }
  return finish(state, draft, selection, 'command');
}

/** What a block format turns text blocks into, or `null` for a format that is no block type. */
function blockKind(attrs: BlockAttrs): BlockKind | null {
  switch (attrs.type) {
    case 'heading':
      return { type: attrs.type, level: attrs.level };
    case 'quote':
    case 'bullet':
    case 'ordered':
      return { type: attrs.type };
    case 'divider':
      return null;
    default:
      return assertNever(attrs);
  }
}

/**
 * Inserts a block at the selection (see `toggleFormat`). The caret goes into a
 * new text block, or past a new divider: to the start of the text block after
 * it, or else to the place after it. No empty paragraph is added for the caret.
 */
function insertBlock(state: EditorState, attrs: BlockAttrs, env: CommandEnv): Transaction | null {
  const draft = new Draft(state.doc);
  const block = newBlock(attrs, env);
  const { selection } = state;
  switch (selection.kind) {
    case 'text': {
      const { to } = selectionRange(state.doc, selection);
      const target = draft.at(to.blockId);
      if (target === null) return null;
      const { index, block: current } = target;
      const replaces = current.type === 'paragraph' && current.content.length === 0;
      if (replaces) replaceBlock(draft, index, []);
      const at = insertBlocksAt(draft, replaces ? index : index + 1, [block]);
      return finish(state, draft, at, 'command');
    }
    case 'block': {
      const index = draft.indexOf(selection.blockId);
      if (index < 0) return null;
      const at = insertBlocksAt(draft, index + 1, [block]);
      return finish(state, draft, at, 'command');
    }
    case 'gap': {
      const at = insertBlocksAt(draft, gapIndex(draft, selection), [block]);
      return finish(state, draft, at, 'command');
    }
    default:
      return assertNever(selection);
  }
}

function newBlock(attrs: BlockAttrs, env: CommandEnv): Block {
  const id = env.createId();
  switch (attrs.type) {
    case 'divider':
      return { id, type: 'divider' };
    case 'heading':
    case 'quote':
    case 'bullet':
    case 'ordered':
      return makeTextBlock(id, attrs, []);
    default:
      return assertNever(attrs);
  }
}
