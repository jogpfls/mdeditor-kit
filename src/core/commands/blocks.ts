import { assertNever } from '../lang';
import {
  MAX_INDENT,
  continuedAttrs,
  emptyParagraph,
  isListBlock,
  isTextBlock,
  listAttrs,
  makeTextBlock,
  normalizeContent,
  sliceContent,
  textBlockAttrs,
  withContent,
  type Block,
  type TextBlock,
  type TextBlockAttrs,
} from '../model';
import {
  selectionBetween,
  selectionRange,
  type EditorState,
  type TextSelection,
  type Transaction,
} from '../state';
import { Draft } from '../transform';
import {
  caretAt,
  caretOf,
  deleteSelection,
  finish,
  gapIndex,
  insertBlocksAt,
  replaceBlock,
  textLength,
  type Command,
  type CommandEnv,
} from './command';

/**
 * In an empty list item or quote, Enter steps out: a nested item moves up a
 * level, anything else becomes a paragraph.
 */
export const exitEmptyBlock: Command = (state) => {
  const target = caretBlock(state);
  if (target === null || target.block.content.length > 0) return null;
  const { block } = target;
  switch (block.type) {
    case 'bullet':
    case 'ordered':
      return setAttrs(
        state,
        target,
        block.indent > 0
          ? { ...listAttrs(block), indent: block.indent - 1 }
          : { type: 'paragraph' },
      );
    case 'quote':
      return setAttrs(state, target, { type: 'paragraph' });
    case 'paragraph':
    case 'heading':
      return null;
    default:
      return assertNever(block);
  }
};

/**
 * Splits the block at the caret, replacing the selection first. The new block
 * continues a quote or a list (at the same indent); after a heading it is a
 * paragraph. At the very start of a non-empty block, an empty block goes in
 * above instead, so the block keeps its text and type. With a block selected,
 * an empty paragraph goes in after it; at a gap, an empty paragraph goes in
 * there.
 */
export const splitBlock: Command = (state, _input, env) => {
  const { selection } = state;
  switch (selection.kind) {
    case 'text':
      return splitText(state, selection, env);
    case 'block': {
      const draft = new Draft(state.doc);
      const index = draft.indexOf(selection.blockId);
      if (index < 0) return null;
      const at = insertBlocksAt(draft, index + 1, [emptyParagraph(env.createId)]);
      return finish(state, draft, at, 'command');
    }
    case 'gap': {
      const draft = new Draft(state.doc);
      const at = insertBlocksAt(draft, gapIndex(draft, selection), [emptyParagraph(env.createId)]);
      return finish(state, draft, at, 'command');
    }
    default:
      return assertNever(selection);
  }
};

function splitText(
  state: EditorState,
  selection: TextSelection,
  env: CommandEnv,
): Transaction | null {
  const { draft, at } = deleteSelection(state, selection, env);
  const target = draft.at(at.blockId);
  if (target === null || !isTextBlock(target.block)) return null;
  const { block, index } = target;

  const attrs = continuation(block);
  const id = env.createId();
  if (at.offset === 0 && block.content.length > 0) {
    replaceBlock(draft, index, [makeTextBlock(id, attrs, []), block]);
    return finish(state, draft, caretAt(block.id, 0), 'command');
  }
  const length = textLength(block);
  replaceBlock(draft, index, [
    withContent(block, sliceContent(block.content, 0, at.offset)),
    makeTextBlock(id, attrs, sliceContent(block.content, at.offset, length)),
  ]);
  return finish(state, draft, caretAt(id, 0), 'command');
}

function continuation(block: TextBlock): TextBlockAttrs {
  switch (block.type) {
    case 'heading':
      return { type: 'paragraph' };
    case 'paragraph':
    case 'quote':
    case 'bullet':
    case 'ordered':
      return continuedAttrs(textBlockAttrs(block));
    default:
      return assertNever(block);
  }
}

/** Backspace at the start of a nested list item moves it up a level. */
export const outdentListAtStart: Command = (state) => {
  const target = caretBlockAtStart(state);
  if (target === null || !isListBlock(target.block) || target.block.indent === 0) return null;
  return setAttrs(state, target, { ...listAttrs(target.block), indent: target.block.indent - 1 });
};

/** Backspace at the start of a heading, quote or list item makes it a paragraph. */
export const resetBlockAtStart: Command = (state) => {
  const target = caretBlockAtStart(state);
  if (target === null || target.block.type === 'paragraph') return null;
  return setAttrs(state, target, { type: 'paragraph' });
};

/**
 * Backspace at the start of a paragraph joins it to the block before. When
 * the block before has no text (a divider, a raw block), it is selected
 * instead, so one key never deletes a table or a code block unseen; the next
 * Backspace deletes it (`deleteSelectedBlock`). An empty paragraph has
 * nothing to lose, so it goes at once and the block before is selected.
 */
export const joinBackward: Command = (state) => {
  const caret = caretOf(state);
  if (caret === null || caret.offset > 0) return null;
  const draft = new Draft(state.doc);
  const target = draft.at(caret.blockId);
  if (target === null || target.block.type !== 'paragraph') return null;
  const { block, index } = target;

  const previous = draft.block(index - 1);
  if (previous === undefined) return null;
  if (!isTextBlock(previous)) return selectPast(state, draft, index, previous);
  draft.apply({
    type: 'replaceBlocks',
    from: index - 1,
    to: index + 1,
    blocks: [joined(previous, block)],
  });
  return finish(state, draft, caretAt(previous.id, textLength(previous)), 'command');
};

/**
 * Delete at the end of a block joins the next block into it. When the next
 * block has no text, it is selected instead, and an empty block goes at once
 * (see `joinBackward`).
 */
export const joinForward: Command = (state) => {
  const caret = caretOf(state);
  if (caret === null) return null;
  const draft = new Draft(state.doc);
  const target = draft.at(caret.blockId);
  if (target === null || !isTextBlock(target.block)) return null;
  const { block, index } = target;
  if (caret.offset < textLength(block)) return null;

  const following = draft.block(index + 1);
  if (following === undefined) return null;
  if (!isTextBlock(following)) return selectPast(state, draft, index, following);
  draft.apply({
    type: 'replaceBlocks',
    from: index,
    to: index + JOINED,
    blocks: [joined(block, following)],
  });
  return finish(state, draft, state.selection, 'command');
};

/**
 * Selects the block without text next to the text block at `index`. The text
 * block goes too when it is empty: it has nothing to lose, so the key that
 * would join it does not need a second press.
 */
function selectPast(
  state: EditorState,
  draft: Draft,
  index: number,
  neighbour: Block,
): Transaction | null {
  const block = draft.block(index);
  const empty = block !== undefined && isTextBlock(block) && block.content.length === 0;
  if (empty) replaceBlock(draft, index, []);
  const selection = { kind: 'block', blockId: neighbour.id } as const;
  return finish(state, draft, selection, empty ? 'command' : 'selection');
}

/** A join replaces a block and the one after it with one block. */
const JOINED = 2;

/** The first block holding both blocks' content. */
function joined(first: TextBlock, second: TextBlock): Block {
  return withContent(first, normalizeContent([...first.content, ...second.content]));
}

/**
 * Backspace or Delete with a block selected deletes it. The selection goes to
 * the place the block was (see `selectionBetween`); an empty paragraph takes
 * its place only when it was the document's last block.
 */
export const deleteSelectedBlock: Command = (state, _input, env) => {
  const { selection } = state;
  if (selection.kind !== 'block') return null;
  const draft = new Draft(state.doc);
  const index = draft.indexOf(selection.blockId);
  if (index < 0) return null;
  if (draft.length === 1) {
    const paragraph = emptyParagraph(env.createId);
    replaceBlock(draft, index, [paragraph]);
    return finish(state, draft, caretAt(paragraph.id, 0), 'command');
  }
  replaceBlock(draft, index, []);
  return finish(
    state,
    draft,
    selectionBetween(draft.block(index - 1), draft.block(index)),
    'command',
  );
};

/** Backspace at a gap selects the block before it. */
export const selectBlockBackward: Command = (state) => {
  const { selection } = state;
  if (selection.kind !== 'gap') return null;
  const draft = new Draft(state.doc);
  const previous = draft.block(gapIndex(draft, selection) - 1);
  if (previous === undefined) return null;
  return finish(state, draft, { kind: 'block', blockId: previous.id }, 'selection');
};

/** Delete at a gap selects the block after it. */
export const selectBlockForward: Command = (state) => {
  const { selection } = state;
  if (selection.kind !== 'gap') return null;
  const draft = new Draft(state.doc);
  const following = draft.block(gapIndex(draft, selection));
  if (following === undefined) return null;
  return finish(state, draft, { kind: 'block', blockId: following.id }, 'selection');
};

/**
 * Tab: every selected list item moves one level deeper, as long as it then
 * still has a parent and stays within `MAX_INDENT`. Items that cannot move
 * stay. When none can move, or outside a list, the command does not apply,
 * so Tab is left to the browser and moves focus: a keyboard user is never
 * trapped in a list (D5).
 */
export const indentList: Command = (state) => {
  const range = selectedIndexes(state);
  if (range === null) return null;
  const { first, last } = range;
  const draft = new Draft(state.doc);
  const selected = draft.slice(first, last + 1);
  if (!selected.some(isListBlock)) return null;

  const before = draft.block(first - 1);
  let previous = before !== undefined && isListBlock(before) ? before.indent : -1;
  const moved = selected.map((block) => {
    if (!isListBlock(block)) {
      previous = -1;
      return block;
    }
    const deepest = Math.min(previous + 1, MAX_INDENT);
    const indent = block.indent < deepest ? block.indent + 1 : block.indent;
    previous = indent;
    return indent === block.indent
      ? block
      : makeTextBlock(block.id, { ...listAttrs(block), indent }, block.content);
  });
  draft.apply({ type: 'replaceBlocks', from: first, to: last + 1, blocks: moved });
  return finish(state, draft, state.selection, 'command');
};

/**
 * Shift-Tab: every selected nested list item moves one level up. Items that
 * were under it follow, so they keep their parent. Items already at the top
 * stay. When none can move, or outside a list, the command does not apply.
 */
export const outdentList: Command = (state) => {
  const range = selectedIndexes(state);
  if (range === null) return null;
  const { first, last } = range;
  const draft = new Draft(state.doc);
  const selected = draft.slice(first, last + 1);
  if (!selected.some(isListBlock)) return null;
  const moved = selected.map((block) =>
    isListBlock(block) && block.indent > 0
      ? makeTextBlock(block.id, { ...listAttrs(block), indent: block.indent - 1 }, block.content)
      : block,
  );
  draft.apply({ type: 'replaceBlocks', from: first, to: last + 1, blocks: moved });
  return finish(state, draft, state.selection, 'command');
};

/** The indexes of the first and last block a text selection touches; `null` for the other kinds. */
function selectedIndexes(
  state: EditorState,
): { readonly first: number; readonly last: number } | null {
  const { selection } = state;
  if (selection.kind !== 'text') return null;
  const { from, to } = selectionRange(state.doc, selection);
  const draft = new Draft(state.doc);
  return { first: draft.indexOf(from.blockId), last: draft.indexOf(to.blockId) };
}

type Target = { readonly index: number; readonly block: TextBlock };

function setAttrs(state: EditorState, target: Target, attrs: TextBlockAttrs): Transaction | null {
  const draft = new Draft(state.doc);
  replaceBlock(draft, target.index, [makeTextBlock(target.block.id, attrs, target.block.content)]);
  return finish(state, draft, state.selection, 'command');
}

function caretBlock(state: EditorState): Target | null {
  const caret = caretOf(state);
  if (caret === null) return null;
  const target = new Draft(state.doc).at(caret.blockId);
  if (target === null || !isTextBlock(target.block)) return null;
  return { index: target.index, block: target.block };
}

function caretBlockAtStart(state: EditorState): Target | null {
  const caret = caretOf(state);
  if (caret === null || caret.offset > 0) return null;
  return caretBlock(state);
}
