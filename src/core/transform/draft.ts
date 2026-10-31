import { contentLength, normalizeContent, sliceContent, type Block, type Doc } from '../model';
import { StepError, WorkingDoc, applyStepTo, type Step } from './step';

/**
 * The steps of one transaction being built, applied as they come. The block
 * array is copied once, on the first change, and each step's inverse is kept,
 * so the finished transaction carries its result and its undo without any
 * step being applied twice.
 *
 * A draft is read through its methods while it is built. `result()` ends it:
 * the document it returns is never changed afterwards.
 */
export class Draft {
  readonly before: Doc;
  #work: WorkingDoc | null = null;
  #done = false;
  readonly #steps: Step[] = [];
  /** Inverses in the order they apply: the last step's first. */
  readonly #inverse: Step[] = [];

  constructor(doc: Doc) {
    this.before = doc;
  }

  get length(): number {
    return this.#blocks().length;
  }

  get hasSteps(): boolean {
    return this.#steps.length > 0;
  }

  block(index: number): Block | undefined {
    return this.#blocks()[index];
  }

  indexOf(blockId: string): number {
    return this.#blocks().findIndex((block) => block.id === blockId);
  }

  /** The block with this id and where it is, or `null` if it is not in the document. */
  at(blockId: string): { readonly index: number; readonly block: Block } | null {
    const index = this.indexOf(blockId);
    const block = this.block(index);
    return block === undefined ? null : { index, block };
  }

  /** The blocks `[from, to)`, as a new array. */
  slice(from: number, to: number): Block[] {
    return this.#blocks().slice(from, to);
  }

  /** Applies a step. A step that changes nothing is not recorded (see `applyStepTo`). */
  apply(step: Step): this {
    if (this.#done) throw new StepError('This draft is finished');
    this.#work ??= new WorkingDoc(this.before);
    const inverse = applyStepTo(this.#work, step);
    if (inverse === null) return this;
    this.#inverse.unshift(inverse);
    this.#steps.push(step);
    return this;
  }

  /** Ends the draft: the document after its steps, the steps, and the steps that undo them. */
  result(): {
    readonly doc: Doc;
    readonly steps: readonly Step[];
    readonly inverse: readonly Step[];
  } {
    this.#done = true;
    return {
      doc: this.#work === null || !this.hasSteps ? this.before : { blocks: this.#work.blocks },
      steps: this.#steps,
      inverse: this.#inverse,
    };
  }

  #blocks(): readonly Block[] {
    return this.#work?.blocks ?? this.before.blocks;
  }
}

/** Applies steps to a document. Undo and redo use it to replay history. */
export function applySteps(doc: Doc, steps: readonly Step[]): Draft {
  const draft = new Draft(doc);
  for (const step of steps) draft.apply(step);
  return draft;
}

/**
 * One step doing what `a` then `b` do, when both replace text in the same
 * block and `b` touches what `a` wrote: typing on, or deleting further back.
 * `null` when they cannot be merged.
 */
export function mergeSteps(a: Step, b: Step): Step | null {
  if (a.type !== 'replaceText' || b.type !== 'replaceText' || a.blockId !== b.blockId) return null;
  const written = contentLength(a.content);
  const end = a.from + written;
  if (b.from > end || b.to < a.from) return null;
  return {
    type: 'replaceText',
    blockId: a.blockId,
    from: Math.min(a.from, b.from),
    to: a.to + Math.max(0, b.to - end),
    content: normalizeContent([
      ...sliceContent(a.content, 0, Math.max(0, b.from - a.from)),
      ...b.content,
      ...sliceContent(a.content, Math.min(written, b.to - a.from), written),
    ]),
  };
}
