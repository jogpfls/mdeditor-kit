import {
  contentLength,
  continuedAttrs,
  isTextBlock,
  makeTextBlock,
  normalizeContent,
  normalizeFragment,
  sliceContent,
  textBlockAttrs,
  type Block,
  type Fragment,
  type Pos,
} from '../model';
import { assertNever } from '../lang';
import { Draft } from '../transform';
import {
  caretAt,
  deleteSelection,
  finish,
  gapIndex,
  insertBlocksAt,
  type Command,
  type CommandEnv,
} from './command';

/**
 * Inserts copied or dropped blocks at the selection, replacing what is
 * selected, as one transaction.
 *
 * - One text block goes inline at the caret.
 * - Several blocks split the current block at the caret: the first block's
 *   text joins the text before the caret, the last block's text joins the text
 *   after it, and the blocks in between go in as they are.
 * - The current block keeps its type unless it is an empty paragraph, in
 *   which case it takes the type of the first block.
 *
 * With a block selected, the blocks go in after it; at a gap, there. The
 * caret then goes to the end of the last inserted text block, or to the place
 * after the inserted blocks.
 *
 * The fragment comes from outside, so it is normalized first: a line break
 * in its text splits the block. Blocks inserted as blocks of their own always
 * get new ids. Their list indents are fitted to where they land, keeping their
 * relative structure, and a start number stays only where a run begins.
 */
export const insertFragment: Command<{ readonly fragment: Fragment }> = (
  state,
  { fragment },
  env,
) => {
  if (fragment.length === 0) return null;
  const { selection } = state;
  switch (selection.kind) {
    case 'text': {
      const { draft, at } = deleteSelection(state, selection, env);
      if (draft.at(at.blockId) === null) return null;
      const caret = insertFragmentAt(draft, at, fragment, env);
      return finish(state, draft, caretAt(caret.blockId, caret.offset), 'paste');
    }
    case 'block': {
      const draft = new Draft(state.doc);
      const index = draft.indexOf(selection.blockId);
      if (index < 0) return null;
      const at = insertBlocksAt(draft, index + 1, freshBlocks(fragment, env));
      return finish(state, draft, at, 'paste');
    }
    case 'gap': {
      const draft = new Draft(state.doc);
      const at = insertBlocksAt(draft, gapIndex(draft, selection), freshBlocks(fragment, env));
      return finish(state, draft, at, 'paste');
    }
    default:
      return assertNever(selection);
  }
};

/** A fragment from outside, normalized, every block with a new id. */
function freshBlocks(fragment: Fragment, env: CommandEnv): Block[] {
  return normalizeFragment(fragment, env.createId).map((block) => withId(block, env));
}

/**
 * Inserts a fragment at a position in a text block in a draft, as one step,
 * and returns where the caret goes.
 */
export function insertFragmentAt(draft: Draft, at: Pos, fragment: Fragment, env: CommandEnv): Pos {
  const target = draft.at(at.blockId);
  if (target === null || fragment.length === 0 || !isTextBlock(target.block)) return at;
  const blocks = normalizeFragment(fragment, env.createId);
  const current = target.block;

  const length = contentLength(current.content);
  const before = sliceContent(current.content, 0, at.offset);
  const after = sliceContent(current.content, at.offset, length);
  const takesFirstType = current.type === 'paragraph' && current.content.length === 0;
  const [first] = blocks;
  const head = first !== undefined && isTextBlock(first) ? first : null;
  const headAttrs =
    takesFirstType && head !== null ? textBlockAttrs(head) : textBlockAttrs(current);

  if (blocks.length === 1 && head !== null) {
    const joined = makeTextBlock(
      current.id,
      headAttrs,
      normalizeContent([...before, ...head.content, ...after]),
    );
    draft.apply({
      type: 'replaceBlocks',
      from: target.index,
      to: target.index + 1,
      blocks: [joined],
    });
    return { blockId: current.id, offset: at.offset + contentLength(head.content) };
  }

  const lastBlock = blocks[blocks.length - 1];
  const tail = lastBlock !== undefined && isTextBlock(lastBlock) ? lastBlock : null;
  const tailId = env.createId();
  const middle = blocks
    .slice(head === null ? 0 : 1, tail === null ? blocks.length : -1)
    .map((block) => withId(block, env));
  const tailAttrs = tail === null ? continuedAttrs(textBlockAttrs(current)) : textBlockAttrs(tail);
  const replaced: readonly Block[] = [
    makeTextBlock(current.id, headAttrs, normalizeContent([...before, ...(head?.content ?? [])])),
    ...middle,
    makeTextBlock(tailId, tailAttrs, normalizeContent([...(tail?.content ?? []), ...after])),
  ];
  draft.apply({
    type: 'replaceBlocks',
    from: target.index,
    to: target.index + 1,
    blocks: replaced,
  });
  return { blockId: tailId, offset: tail === null ? 0 : contentLength(tail.content) };
}

/** A block that goes into the document as a block of its own gets a new id. */
function withId(block: Block, env: CommandEnv): Block {
  return { ...block, id: env.createId() };
}
