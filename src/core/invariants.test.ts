import fc from 'fast-check';
import { expect, test } from 'vitest';
import { FORMATS, type Format } from './formats';
import { applyInputRules } from './input-rules';
import { arrowSelection } from './queries';
import {
  blockContent,
  contentLength,
  contentText,
  isTextBlock,
  normalizeDoc,
  type Block,
  type Doc,
  type Pos,
} from './model';
import {
  DENSE_CHARS,
  WIDE_CHARS,
  blocks,
  counter,
  docs,
  positions,
} from './model/arbitrary.test-support';
import {
  applyTransaction,
  changesNothing,
  createState,
  isValidSelection,
  textSelection,
  selectionTransaction,
  type EditorState,
  type Transaction,
} from './state';
import { applySteps } from './transform';
import {
  deleteSelectedBlock,
  deleteTargetRange,
  exitEmptyBlock,
  indentList,
  insertFragment,
  insertText,
  joinBackward,
  joinForward,
  outdentList,
  outdentListAtStart,
  resetBlockAtStart,
  selectBlockBackward,
  selectBlockForward,
  splitBlock,
  toggleFormat,
  type Command,
} from './commands';

/** Property tests run thousands of cases; they get more time than the default. */
const PROPERTY_TIMEOUT = 60_000;

const BLOCK_COMMANDS: Record<string, Command> = {
  exitEmptyBlock,
  splitBlock,
  outdentListAtStart,
  resetBlockAtStart,
  joinBackward,
  joinForward,
  indentList,
  outdentList,
  deleteSelectedBlock,
  selectBlockBackward,
  selectBlockForward,
};

/**
 * Documents of empty text blocks among blocks without text, so the edge keys
 * often meet an empty block next to a divider or a raw block.
 */
const sparseDocs: fc.Arbitrary<Doc> = fc
  .array(
    fc.constantFrom<(id: string) => Block>(
      (id) => ({ id, type: 'paragraph', content: [] }),
      (id) => ({ id, type: 'heading', level: 2, content: [] }),
      (id) => ({ id, type: 'bullet', indent: 0, content: [] }),
      (id) => ({ id, type: 'divider' }),
      (id) => ({ id, type: 'raw', source: '<div>\nx\n</div>' }),
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((makers) => ({ blocks: makers.map((make, i) => make(`s${i}`)) }));

/** Actions that only move the selection, which may leave it where it is. */
const SELECTING: ReadonlySet<Action['kind']> = new Set([
  'select',
  'blockStart',
  'selectBlock',
  'selectGap',
  'arrow',
]);

/** An action described as data, so fast-check can shrink a failing sequence. */
type Action =
  | { readonly kind: 'select'; readonly anchor: number; readonly focus: number }
  | { readonly kind: 'selectBlock'; readonly at: number }
  | { readonly kind: 'selectGap'; readonly at: number }
  | { readonly kind: 'arrow'; readonly direction: 'backward' | 'forward' }
  /** A caret at the start of a block, where most structural commands apply. */
  | { readonly kind: 'blockStart'; readonly at: number }
  | { readonly kind: 'toggle'; readonly format: Format }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'delete'; readonly from: number; readonly to: number }
  | { readonly kind: 'fragment'; readonly blocks: readonly Block[] }
  | { readonly kind: 'block'; readonly name: string };

// Integers rather than doubles: fast-check biases doubles toward 0, which put
// almost every position at the start of the document.
const STEPS = 997;
const fraction = fc.integer({ min: 0, max: STEPS - 1 }).map((n) => n / STEPS);
const formats = Object.keys(FORMATS).filter((key): key is Format => key in FORMATS);

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('select' as const), anchor: fraction, focus: fraction }),
  fc.record({ kind: fc.constant('selectBlock' as const), at: fraction }),
  fc.record({ kind: fc.constant('selectGap' as const), at: fraction }),
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('arrow' as const),
      direction: fc.constantFrom('backward' as const, 'forward' as const),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('blockStart' as const), at: fraction }) },
  fc.record({ kind: fc.constant('toggle' as const), format: fc.constantFrom(...formats) }),
  fc.record({
    kind: fc.constant('text' as const),
    text: fc
      .array(fc.constantFrom(...DENSE_CHARS, '\n', '-', '>', '1', '.', '#', '~'), {
        minLength: 1,
        maxLength: 4,
      })
      .map((parts) => parts.join('')),
  }),
  fc.record({ kind: fc.constant('delete' as const), from: fraction, to: fraction }),
  fc.record({
    kind: fc.constant('fragment' as const),
    // Pasted blocks come from outside: their text may hold line breaks.
    blocks: blocks(WIDE_CHARS, 3, 3, 4, { lineBreaks: true }),
  }),
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('block' as const),
      name: fc.constantFrom(...Object.keys(BLOCK_COMMANDS)),
    }),
  },
);

function pick(doc: Doc, at: number): Pos {
  const all = positions(doc);
  const pos = all[Math.floor(at * all.length)];
  if (pos === undefined) throw new Error('A document always has a position');
  return pos;
}

function run(state: EditorState, act: Action, createId: () => string): Transaction | null {
  const env = { createId };
  switch (act.kind) {
    case 'select':
      return selectionTransaction(
        state,
        textSelection(pick(state.doc, act.anchor), pick(state.doc, act.focus)),
      );
    case 'selectBlock': {
      const block = state.doc.blocks[Math.floor(act.at * state.doc.blocks.length)];
      return selectionTransaction(state, { kind: 'block', blockId: block?.id ?? '' });
    }
    case 'selectGap': {
      const block = state.doc.blocks[Math.floor(act.at * (state.doc.blocks.length + 1))];
      return selectionTransaction(state, { kind: 'gap', beforeBlockId: block?.id ?? null });
    }
    case 'arrow': {
      const selection = arrowSelection(state, act.direction);
      return selection === null ? null : selectionTransaction(state, selection);
    }
    case 'blockStart': {
      const block = state.doc.blocks[Math.floor(act.at * state.doc.blocks.length)];
      const pos = { blockId: block?.id ?? '', offset: 0 };
      return selectionTransaction(state, textSelection(pos));
    }
    case 'toggle':
      return toggleFormat(act.format)(state, undefined, env);
    case 'text':
      return insertText(state, { text: act.text }, env);
    case 'delete':
      return deleteTargetRange(
        state,
        { from: pick(state.doc, act.from), to: pick(state.doc, act.to) },
        env,
      );
    case 'fragment':
      return insertFragment(state, { fragment: act.blocks }, env);
    case 'block':
      return BLOCK_COMMANDS[act.name]?.(state, undefined, env) ?? null;
  }
}

function checkInvariants(before: EditorState, tr: Transaction): EditorState {
  const after = applyTransaction(before, tr);
  const { doc, selection } = after;

  expect(
    normalizeDoc(doc, () => 'unused'),
    'the document is normal',
  ).toBe(doc);
  expect(isValidSelection(doc, selection), 'the selection is valid').toBe(true);
  if (selection.kind === 'text') {
    for (const pos of [selection.anchor, selection.focus]) {
      const block = doc.blocks.find((b) => b.id === pos.blockId);
      expect(block !== undefined && isTextBlock(block), 'a text selection is in text').toBe(true);
      const length = block === undefined ? 0 : contentLength(blockContent(block) ?? []);
      expect(pos.offset).toBeGreaterThanOrEqual(0);
      expect(pos.offset).toBeLessThanOrEqual(length);
    }
  }
  for (const block of doc.blocks) {
    expect(contentText(blockContent(block) ?? [])).not.toMatch(/[\r\n]/);
  }
  expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(doc.blocks.length);

  for (const [i, step] of tr.steps.entries()) {
    const at = applySteps(before.doc, tr.steps.slice(0, i)).result().doc;
    expect(applySteps(at, [step]).hasSteps, 'every step changes the document').toBe(true);
  }
  expect(
    applySteps(before.doc, tr.steps).result().doc,
    'replaying the steps gives the result',
  ).toEqual(doc);
  expect(
    applySteps(doc, tr.inverse).result().doc,
    'the inverse steps restore the document',
  ).toEqual(before.doc);
  return after;
}

test(
  'every command keeps the document normal, the selection valid, and its steps invertible',
  () => {
    fc.assert(
      fc.property(
        fc.oneof(docs(WIDE_CHARS, 4, 4, 6), docs(DENSE_CHARS, 2, 6, 6), sparseDocs),
        fc.array(action, { minLength: 1, maxLength: 8 }),
        (doc, actions) => {
          const createId = counter('new');
          let state = createState(doc);
          for (const act of actions) {
            const tr = run(state, act, createId);
            if (tr === null) continue;
            if (!SELECTING.has(act.kind)) {
              expect(changesNothing(state, tr), 'a command that applies changes the state').toBe(
                false,
              );
            }
            state = checkInvariants(state, tr);
            const rule = applyInputRules(state, { createId });
            if (rule === null) continue;
            expect(changesNothing(state, rule), 'an input rule that applies changes it').toBe(
              false,
            );
            state = checkInvariants(state, rule);
          }
        },
      ),
      { numRuns: 1500 },
    );
  },
  PROPERTY_TIMEOUT,
);
