import { describe, expect, test } from 'vitest';
import {
  blockContent,
  contentLength,
  contentText,
  isTextBlock,
  sliceContent,
  text,
  withContent,
  type Block,
  type Pos,
} from '../model';
import { at, lines, p } from '../model/fixtures.test-support';
import {
  applyTransaction,
  selectionTransaction,
  transaction,
  withTime,
  type EditorState,
  type Transaction,
  type TransactionOrigin,
  textSelection,
  type TextSelection,
} from '../state';
import { Draft } from '../transform';
import {
  createHistory,
  lastOrigin,
  recordTransaction,
  redo,
  undo,
  type HistoryOptions,
  type HistoryState,
} from '.';

/**
 * History on its own: transactions are written by hand in the shapes the
 * commands produce, so these tests depend on nothing above history.
 */
function session(blocks: readonly Block[], caret: Pos, options: Partial<HistoryOptions> = {}) {
  let state: EditorState = {
    doc: { blocks },
    selection: textSelection(caret),
    storedMarks: null,
  };
  let history: HistoryState = createHistory(options);
  const dispatch = (tr: Transaction) => {
    history = recordTransaction(history, state, tr);
    state = applyTransaction(state, tr);
  };
  const textSel = (): TextSelection => {
    if (state.selection.kind !== 'text') throw new Error('Expected a text selection');
    return state.selection;
  };
  const caretPos = () => textSel().focus;

  return {
    get state() {
      return state;
    },
    get history() {
      return history;
    },
    caret: caretPos,
    lines: () => lines(state.doc),
    /** The first block's text exactly; `lines` trims trailing spaces. */
    text: () => contentText(blockContent(state.doc.blocks[0] ?? p('none')) ?? []),
    /** One transaction per character at the caret, as typing makes them, stamped `time` ms apart. */
    type(value: string, origin: TransactionOrigin = 'typing', time: number | null = null) {
      for (const char of value) {
        const { blockId, offset } = caretPos();
        const next = at(blockId, offset + 1);
        const draft = new Draft(state.doc).apply({
          type: 'replaceText',
          blockId,
          from: offset,
          to: offset,
          content: [text(char)],
        });
        const tr = transaction(draft, textSelection(next), origin);
        dispatch(time === null ? tr : withTime(tr, time));
      }
    },
    /** Typing over the selection: the selected text goes, then the character is typed. */
    typeOver(char: string) {
      const { anchor, focus } = textSel();
      const draft = new Draft(state.doc)
        .apply({
          type: 'replaceText',
          blockId: anchor.blockId,
          from: anchor.offset,
          to: focus.offset,
          content: [],
        })
        .apply({
          type: 'replaceText',
          blockId: anchor.blockId,
          from: anchor.offset,
          to: anchor.offset,
          content: [text(char)],
        });
      const next = at(anchor.blockId, anchor.offset + 1);
      dispatch(transaction(draft, textSelection(next), 'typing'));
    },
    /** Enter at the caret: a split into a new paragraph. */
    split(newId: string) {
      const { blockId, offset } = caretPos();
      const draft = new Draft(state.doc);
      const target = draft.at(blockId);
      if (target === null || !isTextBlock(target.block)) throw new Error('no text block');
      const length = contentLength(target.block.content);
      draft.apply({
        type: 'replaceBlocks',
        from: target.index,
        to: target.index + 1,
        blocks: [
          withContent(target.block, sliceContent(target.block.content, 0, offset)),
          {
            id: newId,
            type: 'paragraph',
            content: sliceContent(target.block.content, offset, length),
          },
        ],
      });
      dispatch(transaction(draft, textSelection(at(newId, 0)), 'command'));
    },
    /** A command that changes no text, such as toggling bold at a caret. */
    storeMarks() {
      dispatch(transaction(new Draft(state.doc), state.selection, 'command', [{ type: 'bold' }]));
    },
    select(anchor: Pos, focus: Pos = anchor) {
      dispatch(selectionTransaction(state, textSelection(anchor, focus)));
    },
    undo: () => run(undo),
    redo: () => run(redo),
  };

  function run(command: typeof undo): boolean {
    const tr = command(state, undefined, { history });
    if (tr === null) return false;
    dispatch(tr);
    return true;
  }
}

describe('grouping', () => {
  test('a word typed in one block is one undo step, whose steps merge into one', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('hello');
    expect(ed.history.done).toHaveLength(1);
    expect(ed.history.done[0]?.steps).toHaveLength(1);
    expect(ed.history.done[0]?.inverse).toHaveLength(1);
    ed.undo();
    expect(ed.lines()).toEqual(['paragraph']);
    expect(ed.caret()).toEqual(at('a', 0));
  });

  test('a letter typed after a space or punctuation starts a new step', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('one two, three');
    expect(ed.history.done).toHaveLength(3);
    ed.undo();
    expect(ed.text()).toBe('one two, ');
  });

  test('a pause longer than the group delay starts a new step', () => {
    const ed = session([p('a')], at('a', 0), { groupDelay: 500 });
    ed.type('ab', 'typing', 1000);
    ed.type('c', 'typing', 1400);
    ed.type('d', 'typing', 2000);
    expect(ed.history.done).toHaveLength(2);
  });

  test('typing over a selection starts a new step', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('abc');
    ed.select(at('a', 1), at('a', 2));
    ed.typeOver('X');
    expect(ed.history.done).toHaveLength(2);
    ed.undo();
    expect(ed.lines()).toEqual(['paragraph abc']);
  });

  test('IME composition groups with typing', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.type('한글', 'composition');
    expect(ed.history.done).toHaveLength(1);
  });

  test('moving the caret ends the group', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.select(at('a', 1));
    ed.type('X');
    expect(ed.history.done).toHaveLength(2);
    ed.undo();
    expect(ed.lines()).toEqual(['paragraph ab']);
  });

  test('a selection event that does not move the selection does not end the group', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.select(at('a', 2));
    ed.type('c');
    expect(ed.history.done).toHaveLength(1);
  });

  test('typing in another block starts a new group', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.split('b');
    ed.type('cd');
    expect(ed.history.done).toHaveLength(3);
  });

  test('a transaction of another origin ends the group, even one that changes no text', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.storeMarks();
    ed.type('cd');
    expect(ed.history.done).toHaveLength(2);
  });

  test('an input rule is always an entry of its own', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.type('c', 'input-rule');
    ed.type('d');
    expect(ed.history.done).toHaveLength(3);
  });
});

describe('depth', () => {
  test('only the newest entries are kept', () => {
    const ed = session([p('a')], at('a', 0), { depth: 3 });
    ed.type('a b c d e');
    expect(ed.history.done).toHaveLength(3);
    while (ed.undo()) {
      // undo everything that is kept
    }
    expect(ed.text()).toBe('a b ');
  });
});

describe('undo and redo', () => {
  test('redo reapplies, and a new change clears what could be redone', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('ab');
    ed.undo();
    ed.redo();
    expect(ed.lines()).toEqual(['paragraph ab']);
    expect(ed.caret()).toEqual(at('a', 2));
    ed.undo();
    ed.type('x');
    expect(ed.redo()).toBe(false);
  });

  test('nothing to undo does not apply', () => {
    const ed = session([p('a')], at('a', 0));
    expect(ed.undo()).toBe(false);
  });

  test('the last origin is exposed', () => {
    const ed = session([p('a')], at('a', 0));
    ed.type('#', 'input-rule');
    expect(lastOrigin(ed.history)).toBe('input-rule');
    ed.undo();
    expect(lastOrigin(ed.history)).toBe('undo');
  });
});
