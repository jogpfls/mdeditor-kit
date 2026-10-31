import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  deleteSelectedBlock,
  deleteTargetRange,
  selectBlockBackward,
  selectBlockForward,
  splitBlock,
  toggleFormat,
} from './commands';
import { redo, undo } from './history';
import { editor } from './input-rules/harness.test-support';
import { blockContent, contentLength } from './model';
import { caretOf } from './state';
import { WIDE_CHARS, docs, positions } from './model/arbitrary.test-support';

/** Property tests run thousands of cases; they get more time than the default. */
const PROPERTY_TIMEOUT = 60_000;

/** Something a user does, as data so fast-check can shrink a failing sequence. */
type Action =
  | { readonly kind: 'type'; readonly char: string }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'enter' }
  | { readonly kind: 'bold' }
  | { readonly kind: 'move'; readonly at: number };

const STEPS = 997;
const action: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('type' as const),
      char: fc.constantFrom('a', '가', ' ', '.', '*', '#', '-', '`', '~'),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('backspace' as const) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete' as const) }) },
  fc.record({ kind: fc.constant('enter' as const) }),
  fc.record({ kind: fc.constant('bold' as const) }),
  fc.record({
    kind: fc.constant('move' as const),
    at: fc.integer({ min: 0, max: STEPS - 1 }).map((n) => n / STEPS),
  }),
);

test(
  'undoing everything restores the document, and redoing everything restores the result',
  () => {
    fc.assert(
      fc.property(
        docs(WIDE_CHARS, 3, 3, 4),
        fc.array(action, { maxLength: 40 }),
        (doc, actions) => {
          const [first] = positions(doc);
          if (first === undefined) return;
          const ed = editor(doc.blocks, first);
          for (const act of actions) {
            switch (act.kind) {
              case 'type':
                ed.type(act.char);
                break;
              case 'backspace': {
                const caret = caretOf(ed.state.selection);
                if (caret === null) {
                  ed.chain([deleteSelectedBlock, selectBlockBackward]);
                } else if (caret.offset > 0) {
                  ed.run((s, e) =>
                    deleteTargetRange(
                      s,
                      { from: { ...caret, offset: caret.offset - 1 }, to: caret },
                      e,
                    ),
                  );
                }
                break;
              }
              case 'delete': {
                const caret = caretOf(ed.state.selection);
                if (caret === null) {
                  ed.chain([deleteSelectedBlock, selectBlockForward]);
                  break;
                }
                const block = ed.state.doc.blocks.find((b) => b.id === caret.blockId);
                const length = block === undefined ? 0 : contentLength(blockContent(block) ?? []);
                if (caret.offset < length) {
                  ed.run((s, e) =>
                    deleteTargetRange(
                      s,
                      { from: caret, to: { ...caret, offset: caret.offset + 1 } },
                      e,
                    ),
                  );
                }
                break;
              }
              case 'enter':
                ed.exec(splitBlock);
                break;
              case 'bold':
                ed.exec(toggleFormat('bold'));
                break;
              case 'move': {
                const all = positions(ed.state.doc);
                const pos = all[Math.floor(act.at * all.length)];
                if (pos !== undefined) ed.select(pos);
                break;
              }
              default:
                throw new Error(`unknown action ${JSON.stringify(act satisfies never)}`);
            }
          }
          const result = ed.state.doc;
          while (ed.exec(undo)) {
            // undo everything
          }
          expect(ed.state.doc).toEqual(doc);
          while (ed.exec(redo)) {
            // redo everything
          }
          expect(ed.state.doc).toEqual(result);
        },
      ),
      { numRuns: 1000 },
    );
  },
  PROPERTY_TIMEOUT,
);
