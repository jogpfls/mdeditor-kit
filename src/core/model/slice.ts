import { assertNever } from '../lang';
import { withContent } from './doc';
import { contentLength, sliceContent } from './content';
import type { Block, Doc, Fragment, Pos } from './types';

/** The index of the block a position points into, or -1 if it is not in the doc. */
export function blockIndex(doc: Doc, pos: Pos): number {
  return doc.blocks.findIndex((block) => block.id === pos.blockId);
}

/** Negative if `a` comes before `b`, positive if after, 0 if equal. */
export function comparePos(doc: Doc, a: Pos, b: Pos): number {
  const byBlock = blockIndex(doc, a) - blockIndex(doc, b);
  return byBlock !== 0 ? byBlock : a.offset - b.offset;
}

/**
 * Cuts the range between two positions out of the document. Either order is
 * accepted. Blocks wholly inside the range are kept as they are; the blocks at
 * either end keep only the text inside the range. A position outside the
 * document yields an empty fragment.
 */
export function slice(doc: Doc, a: Pos, b: Pos): Fragment {
  const [from, to] = comparePos(doc, a, b) <= 0 ? [a, b] : [b, a];
  const first = blockIndex(doc, from);
  const last = blockIndex(doc, to);
  if (first === -1 || last === -1) return [];

  return doc.blocks.slice(first, last + 1).map((block, index) => {
    const start = index === 0 ? from.offset : 0;
    const end = first + index === last ? to.offset : Number.POSITIVE_INFINITY;
    return sliceBlock(block, start, end);
  });
}

function sliceBlock(block: Block, start: number, end: number): Block {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bullet':
    case 'ordered': {
      const length = contentLength(block.content);
      return withContent(block, sliceContent(block.content, start, Math.min(end, length)));
    }
    case 'divider':
    case 'raw':
      return block;
    default:
      return assertNever(block);
  }
}
