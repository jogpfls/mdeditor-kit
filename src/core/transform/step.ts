import { assertNever } from '../lang';
import {
  contentLength,
  hasMark,
  isListBlock,
  isTextBlock,
  listAttrs,
  listRepairs,
  makeTextBlock,
  normalizeContent,
  sameContent,
  sameMark,
  sameTextBlockAttrs,
  sliceContent,
  takesMark,
  textBlockAttrs,
  withContent,
  withMarks,
  type Block,
  type Doc,
  type HeadingLevel,
  type Inline,
  type Mark,
  type Pos,
  type TextBlock,
  type TextBlockAttrs,
} from '../model';

/** What `setBlockKind` turns blocks into. A list keeps each block's indent; see `kindAttrs`. */
export type BlockKind =
  | { readonly type: 'paragraph' }
  | { readonly type: 'heading'; readonly level: HeadingLevel }
  | { readonly type: 'quote' }
  | { readonly type: 'bullet' }
  | { readonly type: 'ordered' };

/**
 * One atomic change to a document. Applying a step also gives the step that
 * undoes it (see `applyStep`). The steps that work on a range make a single
 * step out of a change to any number of blocks.
 */
export type Step =
  /** Replaces `[from, to)` of one text block's content with `content`. */
  | {
      readonly type: 'replaceText';
      readonly blockId: string;
      readonly from: number;
      readonly to: number;
      readonly content: readonly Inline[];
    }
  /** Replaces the blocks at indexes `[from, to)` with `blocks`: insert, delete, split or join. */
  | {
      readonly type: 'replaceBlocks';
      readonly from: number;
      readonly to: number;
      readonly blocks: readonly Block[];
    }
  /** Adds or removes a mark on the content between two positions, across blocks. */
  | {
      readonly type: 'addMark' | 'removeMark';
      readonly from: Pos;
      readonly to: Pos;
      readonly mark: Mark;
    }
  /** Changes the type of every text block from one block to another, inclusive. */
  | {
      readonly type: 'setBlockKind';
      readonly fromId: string;
      readonly toId: string;
      readonly kind: BlockKind;
    };

/** A step that does not fit the document it is applied to. Always a bug in the caller. */
export class StepError extends Error {
  override readonly name = 'StepError';
}

/**
 * A document being changed in place: one copy of the block array. Blocks are
 * found by a linear scan: a step looks up one or two blocks, and scanning
 * costs a tenth of building an id index over the whole document (measured at
 * 20,000 blocks: 0.1 ms against 1.7 ms).
 */
export class WorkingDoc {
  readonly blocks: Block[];

  constructor(doc: Doc) {
    this.blocks = [...doc.blocks];
  }

  indexOf(blockId: string): number {
    return this.blocks.findIndex((block) => block.id === blockId);
  }

  at(blockId: string): { readonly index: number; readonly block: Block } {
    const index = this.indexOf(blockId);
    const block = this.blocks[index];
    if (block === undefined) throw new StepError(`Block ${blockId} is not in the document`);
    return { index, block };
  }

  set(index: number, block: Block): void {
    this.blocks[index] = block;
  }

  splice(from: number, to: number, blocks: readonly Block[]): void {
    const tail = this.blocks.slice(to);
    this.blocks.length = from;
    for (const block of blocks) this.blocks.push(block);
    for (const block of tail) this.blocks.push(block);
  }
}

/**
 * Applies a step to a document, returning the new document and the step that
 * undoes it. A step that changes nothing gives the same document and no
 * inverse.
 */
export function applyStep(
  doc: Doc,
  step: Step,
): { readonly doc: Doc; readonly inverse: Step | null } {
  const work = new WorkingDoc(doc);
  const inverse = applyStepTo(work, step);
  return { doc: inverse === null ? doc : { blocks: work.blocks }, inverse };
}

/**
 * Applies a step to a working document in place and returns the step that
 * undoes it, or `null` when the step changes nothing (a mark every character
 * already has, a block kind every block already is). Such a step leaves every
 * block as it was, so it is not recorded and history never holds an entry
 * that does nothing.
 */
export function applyStepTo(work: WorkingDoc, step: Step): Step | null {
  switch (step.type) {
    case 'replaceText':
      return replaceText(work, step);
    case 'replaceBlocks': {
      if (step.from < 0 || step.from > step.to || step.to > work.blocks.length) {
        throw new StepError(`Blocks ${step.from}-${step.to} are outside the document`);
      }
      const old = work.blocks.slice(step.from, step.to);
      return sameBlocks(old, step.blocks)
        ? null
        : replaceRegion(work, step.from, step.to, step.blocks);
    }
    case 'addMark':
    case 'removeMark':
      return changeMark(work, step.from, step.to, step.mark, step.type === 'addMark');
    case 'setBlockKind': {
      const from = work.at(step.fromId).index;
      const to = work.at(step.toId).index;
      if (from > to) throw new StepError(`Block ${step.fromId} comes after ${step.toId}`);
      const old = work.blocks.slice(from, to + 1);
      const blocks = old.map((block) => (isTextBlock(block) ? retype(block, step.kind) : block));
      return sameBlocks(old, blocks) ? null : replaceRegion(work, from, to + 1, blocks);
    }
    default:
      return assertNever(step);
  }
}

/** Whether two block lists hold the very same blocks, so replacing one with the other changes nothing. */
function sameBlocks(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((block, i) => block === b[i]);
}

function replaceText(work: WorkingDoc, step: Extract<Step, { type: 'replaceText' }>): Step | null {
  const { index, block } = work.at(step.blockId);
  if (!isTextBlock(block)) throw new StepError(`Block ${step.blockId} holds no text`);
  const length = contentLength(block.content);
  if (step.from < 0 || step.from > step.to || step.to > length) {
    throw new StepError(`Range ${step.from}-${step.to} is outside block ${step.blockId}`);
  }
  const old = sliceContent(block.content, step.from, step.to);
  if (sameContent(old, normalizeContent(step.content))) return null;
  const content = normalizeContent([
    ...sliceContent(block.content, 0, step.from),
    ...step.content,
    ...sliceContent(block.content, step.to, length),
  ]);
  work.set(index, withContent(block, content));
  return {
    type: 'replaceText',
    blockId: step.blockId,
    from: step.from,
    to: step.from + contentLength(step.content),
    content: old,
  };
}

function changeMark(work: WorkingDoc, from: Pos, to: Pos, mark: Mark, add: boolean): Step | null {
  const first = work.at(from.blockId).index;
  const last = work.at(to.blockId).index;
  if (first > last) throw new StepError(`Block ${from.blockId} comes after ${to.blockId}`);
  const old = work.blocks.slice(first, last + 1);
  let changed = false;
  old.forEach((block, i) => {
    if (!isTextBlock(block)) return;
    const length = contentLength(block.content);
    const start = i === 0 ? from.offset : 0;
    const end = first + i === last ? to.offset : length;
    if (start < 0 || start > end || end > length) {
      throw new StepError(`Range ${start}-${end} is outside block ${block.id}`);
    }
    const range = sliceContent(block.content, start, end);
    const changes = range.some((inline) =>
      add ? takesMark(inline, mark) && !hasMark(inline.marks, mark) : hasMark(inline.marks, mark),
    );
    if (!changes) return;
    const marked = range.map((inline) =>
      withMarks(inline, add ? withMark(inline.marks, mark) : withoutMark(inline.marks, mark)),
    );
    const content = normalizeContent([
      ...sliceContent(block.content, 0, start),
      ...marked,
      ...sliceContent(block.content, end, length),
    ]);
    work.set(first + i, withContent(block, content));
    changed = true;
  });
  return changed ? { type: 'replaceBlocks', from: first, to: last + 1, blocks: old } : null;
}

function withMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  return hasMark(marks, mark) ? marks : [...marks, mark];
}

function withoutMark(marks: readonly Mark[], mark: Mark): readonly Mark[] {
  return marks.filter((m) => !sameMark(m, mark));
}

/** The attributes a text block takes when it becomes `kind`. A list item keeps its indent. */
function kindAttrs(block: TextBlock, kind: BlockKind): TextBlockAttrs {
  switch (kind.type) {
    case 'paragraph':
    case 'quote':
      return { type: kind.type };
    case 'heading':
      return { type: kind.type, level: kind.level };
    case 'bullet':
      return { type: kind.type, indent: isListBlock(block) ? block.indent : 0 };
    case 'ordered':
      return block.type === 'ordered'
        ? listAttrs(block)
        : { type: kind.type, indent: isListBlock(block) ? block.indent : 0 };
    default:
      return assertNever(kind);
  }
}

/** The block as `kind`; the block itself when it already is. */
function retype(block: TextBlock, kind: BlockKind): TextBlock {
  const attrs = kindAttrs(block, kind);
  return sameTextBlockAttrs(attrs, textBlockAttrs(block))
    ? block
    : makeTextBlock(block.id, attrs, block.content);
}

/**
 * Replaces blocks `[from, to)` with `blocks`, then brings the lists around
 * the change back to normal. List invariants only relate a block to the ones
 * before it in the same run, so only the run the change starts in and the run
 * right after it are checked. Returns a step that restores every block it
 * touched, repaired ones included.
 */
function replaceRegion(work: WorkingDoc, from: number, to: number, blocks: readonly Block[]): Step {
  let runStart = from;
  while (runStart > 0 && isList(work.blocks[runStart - 1])) runStart -= 1;
  const before = work.blocks.slice(runStart, to);

  work.splice(from, to, blocks);
  const changedEnd = from + blocks.length;
  let runEnd = changedEnd;
  while (runEnd < work.blocks.length && isList(work.blocks[runEnd])) runEnd += 1;
  const after = work.blocks.slice(changedEnd, runEnd);

  const region = work.blocks.slice(runStart, runEnd);
  for (const repair of listRepairs(region)) {
    const block = region[repair.index];
    if (block !== undefined && isListBlock(block)) {
      work.set(runStart + repair.index, makeTextBlock(block.id, repair.attrs, block.content));
    }
  }
  return { type: 'replaceBlocks', from: runStart, to: runEnd, blocks: [...before, ...after] };
}

function isList(block: Block | undefined): boolean {
  return block !== undefined && isListBlock(block);
}
