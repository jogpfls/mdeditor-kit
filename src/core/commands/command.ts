import {
  contentLength,
  emptyParagraph,
  isTextBlock,
  normalizeContent,
  sliceContent,
  withContent,
  type Block,
  type CreateId,
  type Mark,
  type Pos,
  type TextBlock,
} from '../model';
import {
  caretOf as caretOfSelection,
  changesNothing,
  isCollapsed,
  selectionBetween,
  selectionRange,
  textSelection,
  transaction,
  type EditorState,
  type GapSelection,
  type Selection,
  type TextSelection,
  type Transaction,
  type TransactionOrigin,
} from '../state';
import { Draft } from '../transform';

/** What a command needs from the editor besides the state. */
export type CommandEnv = { readonly createId: CreateId };

/**
 * Turns a user intent into a transaction, or returns `null` when it does not
 * apply here, so a chain of commands can try the next one. `input` carries
 * what the view read from the event, already in model coordinates.
 */
export type Command<Input = undefined> = (
  state: EditorState,
  input: Input,
  env: CommandEnv,
) => Transaction | null;

/**
 * Ends a command: wraps the draft's steps in a transaction, or gives `null`
 * when the transaction would leave the state as it was (see
 * `changesNothing`). Every command ends here, so none returns an empty
 * transaction. Lists need no repair: applying a step that changes structure
 * already brings the lists around it back to normal.
 */
export function finish(
  state: EditorState,
  draft: Draft,
  selection: Selection,
  origin: TransactionOrigin,
  storedMarks: readonly Mark[] | null = null,
): Transaction | null {
  const tr = transaction(draft, selection, origin, storedMarks);
  return changesNothing(state, tr) ? null : tr;
}

export function caretAt(blockId: string, offset: number): TextSelection {
  return textSelection({ blockId, offset });
}

export function textLength(block: TextBlock): number {
  return contentLength(block.content);
}

/** The caret, if the selection is one. Commands acting "at the caret" need it. */
export function caretOf(state: EditorState): Pos | null {
  return caretOfSelection(state.selection);
}

/** The index of the place a gap selection stands for: before its block, or the end. */
export function gapIndex(draft: Draft, gap: GapSelection): number {
  return gap.beforeBlockId === null ? draft.length : draft.indexOf(gap.beforeBlockId);
}

/**
 * Inserts blocks at a place, as one step, and says where the selection goes:
 * the end of the last inserted text block, else the place right after the
 * inserted blocks (see `selectionBetween`). No empty paragraph is added to
 * hold the caret.
 */
export function insertBlocksAt(draft: Draft, index: number, blocks: readonly Block[]): Selection {
  draft.apply({ type: 'replaceBlocks', from: index, to: index, blocks });
  const last = draft.block(index + blocks.length - 1);
  if (last !== undefined && isTextBlock(last)) return caretAt(last.id, textLength(last));
  return selectionBetween(last, draft.block(index + blocks.length));
}

/** Replaces one block with others, as a single step. */
export function replaceBlock(draft: Draft, index: number, blocks: readonly Block[]): void {
  draft.apply({ type: 'replaceBlocks', from: index, to: index + 1, blocks });
}

/**
 * Deletes everything between two positions, as a single step, and returns
 * where the caret lands. The text blocks at either end keep the text outside
 * the range and are joined; a block without content at either end is atomic
 * and goes with the range. When nothing is left at that place, an empty
 * paragraph takes it.
 */
export function deleteRange(draft: Draft, a: Pos, b: Pos, env: CommandEnv): Pos {
  const fromIndex = draft.indexOf(a.blockId);
  const toIndex = draft.indexOf(b.blockId);
  const [from, to] =
    fromIndex < toIndex || (fromIndex === toIndex && a.offset <= b.offset) ? [a, b] : [b, a];
  const firstIndex = Math.min(fromIndex, toIndex);
  const lastIndex = Math.max(fromIndex, toIndex);
  const first = draft.block(firstIndex);
  const last = draft.block(lastIndex);
  if (first === undefined || last === undefined) return from;

  if (firstIndex === lastIndex) {
    if (!isTextBlock(first) || from.offset === to.offset) return from;
    draft.apply({
      type: 'replaceText',
      blockId: first.id,
      from: from.offset,
      to: to.offset,
      content: [],
    });
    return from;
  }

  const head = isTextBlock(first) ? first : null;
  const tail = isTextBlock(last) ? last : null;
  const { blocks, at } = joinedEnds(head, tail, from, to, env);
  draft.apply({ type: 'replaceBlocks', from: firstIndex, to: lastIndex + 1, blocks });
  return at;
}

/** What is left of the two end blocks of a deleted range, and where the caret goes. */
function joinedEnds(
  head: TextBlock | null,
  tail: TextBlock | null,
  from: Pos,
  to: Pos,
  env: CommandEnv,
): { readonly blocks: readonly Block[]; readonly at: Pos } {
  const before = head === null ? null : sliceContent(head.content, 0, from.offset);
  const after = tail === null ? null : sliceContent(tail.content, to.offset, textLength(tail));
  if (head !== null && before !== null) {
    const content = normalizeContent([...before, ...(after ?? [])]);
    return { blocks: [withContent(head, content)], at: from };
  }
  if (tail !== null && after !== null) {
    return { blocks: [withContent(tail, after)], at: { blockId: tail.id, offset: 0 } };
  }
  const paragraph = emptyParagraph(env.createId);
  return { blocks: [paragraph], at: { blockId: paragraph.id, offset: 0 } };
}

/** Starts a draft that deletes a text selection, if it is a range, and says where the caret lands. */
export function deleteSelection(
  state: EditorState,
  selection: TextSelection,
  env: CommandEnv,
): { readonly draft: Draft; readonly at: Pos } {
  const draft = new Draft(state.doc);
  if (isCollapsed(selection)) return { draft, at: selection.focus };
  const { from, to } = selectionRange(state.doc, selection);
  return { draft, at: deleteRange(draft, from, to, env) };
}
