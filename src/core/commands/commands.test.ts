import { describe, expect, test } from 'vitest';
import { text, type Block, type Fragment, type Inline } from '../model';
import { at, h, hr, item, p, quote } from '../model/fixtures.test-support';
import { editor } from './harness.test-support';
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
} from '.';

/**
 * The chains from the input bindings, without the range deletion at the end.
 * Backspace starts with `undoInputRule`, which input-rules tests cover.
 */
const ENTER = [exitEmptyBlock, splitBlock];
const BACKSPACE = [outdentListAtStart, resetBlockAtStart, joinBackward];

describe('insertText', () => {
  test('replaces the selection and takes the marks of the character before', () => {
    const ed = editor(
      [
        {
          id: 'a',
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ab', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'cd', marks: [] },
          ],
        },
      ],
      at('a', 1),
      at('a', 3),
    );
    ed.run((s, e) => insertText(s, { text: 'X' }, e));
    expect(ed.lines()).toEqual(['paragraph **aX**d']);
    expect(ed.caret()).toEqual(at('a', 2));
  });

  test('stored marks win over the character before', () => {
    const ed = editor([p('a', 'ab')], at('a', 2));
    ed.exec(toggleFormat('italic'));
    ed.type('c');
    expect(ed.lines()).toEqual(['paragraph ab_c_']);
  });

  test('text with line breaks becomes several blocks', () => {
    const ed = editor([p('a', 'ab')], at('a', 1));
    ed.run((s, e) => insertText(s, { text: 'x\ny' }, e));
    expect(ed.lines()).toEqual(['paragraph ax', 'paragraph yb']);
  });
});

describe('which marks typed text takes (inclusive)', () => {
  const link = { type: 'link', href: 'https://a.example' } as const;
  const block = (content: readonly Inline[]): Block => ({ id: 'a', type: 'paragraph', content });

  test.each([
    ['code', { type: 'code' } as const],
    ['a link', link],
  ])('typing at the end of %s writes plain text', (_, mark) => {
    const ed = editor([block([text('ab', [mark])])], at('a', 2));
    ed.type('c');
    expect(ed.state.doc.blocks).toEqual([block([text('ab', [mark]), text('c')])]);
  });

  test.each([
    ['code', { type: 'code' } as const],
    ['a link', link],
  ])('typing inside %s extends it', (_, mark) => {
    const ed = editor([block([text('ab', [mark])])], at('a', 1));
    ed.type('x');
    expect(ed.state.doc.blocks).toEqual([block([text('axb', [mark])])]);
  });

  test('typing at the end of bold, italic or strike extends the mark', () => {
    const marks = [{ type: 'strike' }, { type: 'bold' }, { type: 'italic' }] as const;
    const ed = editor([block([text('ab', marks)])], at('a', 2));
    ed.type('c');
    expect(ed.state.doc.blocks).toEqual([block([text('abc', marks)])]);
  });

  test('at the end of a bold link only bold carries on', () => {
    const ed = editor([block([text('ab', [link, { type: 'bold' }])])], at('a', 2));
    ed.type('c');
    expect(ed.state.doc.blocks).toEqual([
      block([text('ab', [link, { type: 'bold' }]), text('c', [{ type: 'bold' }])]),
    ]);
  });
});

describe('deleteTargetRange', () => {
  test('across blocks keeps the first block type and joins the ends', () => {
    const ed = editor([h('a', 1, 'abc'), hr('x'), p('b', 'def')], at('a', 0));
    ed.run((s, e) => deleteTargetRange(s, { from: at('a', 1), to: at('b', 2) }, e));
    expect(ed.lines()).toEqual(['h1 af']);
    expect(ed.caret()).toEqual(at('a', 1));
  });

  test('a collapsed range does not apply', () => {
    const ed = editor([p('a', 'abc')], at('a', 1));
    expect(ed.run((s, e) => deleteTargetRange(s, { from: at('a', 1), to: at('a', 1) }, e))).toBe(
      false,
    );
  });

  test('deleting a whole parent item lifts its children so the list stays a tree', () => {
    const ed = editor(
      [
        p('p', 'x'),
        item('a', 'bullet', 0, 'a'),
        item('b', 'bullet', 1, 'b'),
        item('c', 'bullet', 2, 'c'),
      ],
      at('p', 0),
    );
    ed.run((s, e) => deleteTargetRange(s, { from: at('p', 1), to: at('a', 1) }, e));
    expect(ed.lines()).toEqual(['paragraph x', 'bullet0 b', 'bullet1 c']);
  });
});

describe('Enter', () => {
  test('splits a heading; the new block is a paragraph', () => {
    const ed = editor([h('a', 2, 'abcd')], at('a', 2));
    expect(ed.chain(ENTER)).toBe(1);
    expect(ed.lines()).toEqual(['h2 ab', 'paragraph cd']);
    expect(ed.caret()).toEqual(at('n0', 0));
  });

  test('continues a quote and a list at the same indent', () => {
    const ed = editor([item('a', 'ordered', 0, 'x'), item('b', 'ordered', 1, 'ab')], at('b', 2));
    ed.chain(ENTER);
    expect(ed.lines()).toEqual(['ordered0 x', 'ordered1 ab', 'ordered1']);
    const q = editor([quote('q', 'ab')], at('q', 1));
    q.chain(ENTER);
    expect(q.lines()).toEqual(['quote a', 'quote b']);
  });

  test('at the start of a heading inserts an empty paragraph above and keeps the heading', () => {
    const ed = editor([h('a', 1, 'title')], at('a', 0));
    ed.chain(ENTER);
    expect(ed.lines()).toEqual(['paragraph', 'h1 title']);
    expect(ed.caret()).toEqual(at('a', 0));
  });

  test('in an empty nested item moves up a level, then leaves the list', () => {
    const ed = editor([item('a', 'bullet', 0, 'x'), item('b', 'bullet', 1)], at('b', 0));
    expect(ed.chain(ENTER)).toBe(0);
    expect(ed.lines()).toEqual(['bullet0 x', 'bullet0']);
    expect(ed.chain(ENTER)).toBe(0);
    expect(ed.lines()).toEqual(['bullet0 x', 'paragraph']);
  });

  test('in an empty quote leaves the quote', () => {
    const ed = editor([quote('q')], at('q', 0));
    expect(ed.chain(ENTER)).toBe(0);
    expect(ed.lines()).toEqual(['paragraph']);
  });

  test('on a divider adds a paragraph after it', () => {
    const ed = editor([hr('x')], at('x', 0));
    ed.chain(ENTER);
    expect(ed.lines()).toEqual(['divider', 'paragraph']);
  });
});

describe('Backspace at the start of a block', () => {
  test('a nested item moves up first, then becomes a paragraph, then joins', () => {
    const ed = editor(
      [p('p', 'x'), item('a', 'bullet', 0, 'a'), item('b', 'bullet', 1, 'b')],
      at('b', 0),
    );
    expect(ed.chain(BACKSPACE)).toBe(0);
    expect(ed.lines()).toEqual(['paragraph x', 'bullet0 a', 'bullet0 b']);
    expect(ed.chain(BACKSPACE)).toBe(1);
    expect(ed.lines()).toEqual(['paragraph x', 'bullet0 a', 'paragraph b']);
    expect(ed.chain(BACKSPACE)).toBe(2);
    expect(ed.lines()).toEqual(['paragraph x', 'bullet0 ab']);
    expect(ed.caret()).toEqual(at('a', 1));
  });

  test('turning a parent into a paragraph lifts its children', () => {
    const ed = editor(
      [item('a', 'bullet', 0, 'a'), item('b', 'bullet', 1, 'b'), item('c', 'bullet', 1, 'c')],
      at('a', 0),
    );
    ed.chain(BACKSPACE);
    expect(ed.lines()).toEqual(['paragraph a', 'bullet0 b', 'bullet0 c']);
  });

  test('a divider before the paragraph is selected, and the next Backspace deletes it', () => {
    const ed = editor([p('a', 'x'), hr('x1'), p('b', 'y')], at('b', 0));
    expect(ed.chain(BACKSPACE)).toBe(2);
    expect(ed.state.selection).toEqual({ kind: 'block', blockId: 'x1' });
    expect(ed.lines()).toEqual(['paragraph x', 'divider', 'paragraph y']);
    ed.exec(deleteSelectedBlock);
    expect(ed.lines()).toEqual(['paragraph x', 'paragraph y']);
    expect(ed.caret()).toEqual(at('a', 1));
  });

  test('an empty paragraph after a block without text goes at once, selecting that block', () => {
    const ed = editor([p('a', 'x'), hr('d'), p('b')], at('b', 0));
    expect(ed.chain(BACKSPACE)).toBe(2);
    expect(ed.lines()).toEqual(['paragraph x', 'divider']);
    expect(ed.state.selection).toEqual({ kind: 'block', blockId: 'd' });
  });

  test('does not apply at the start of the document', () => {
    const ed = editor([p('a', 'x')], at('a', 0));
    expect(ed.chain(BACKSPACE)).toBe(-1);
  });

  test('not at the start of the block, nothing structural applies', () => {
    const ed = editor([h('a', 1, 'x')], at('a', 1));
    expect(ed.chain(BACKSPACE)).toBe(-1);
  });
});

describe('Delete at the end of a block', () => {
  test('joins the next block, or selects a divider after it', () => {
    const ed = editor([p('a', 'x'), hr('d'), h('b', 1, 'y')], at('a', 1));
    ed.exec(joinForward);
    expect(ed.state.selection).toEqual({ kind: 'block', blockId: 'd' });
    ed.exec(deleteSelectedBlock);
    expect(ed.lines()).toEqual(['paragraph x', 'h1 y']);
    ed.exec(joinForward);
    expect(ed.lines()).toEqual(['paragraph xy']);
  });

  test('an empty block before a block without text goes at once, selecting that block', () => {
    const raw: Block = { id: 'r', type: 'raw', source: 'R' };
    const ed = editor([h('a', 2), raw, p('b', 'y')], at('a', 0));
    ed.exec(joinForward);
    expect(ed.lines()).toEqual(['raw R', 'paragraph y']);
    expect(ed.state.selection).toEqual({ kind: 'block', blockId: 'r' });
  });

  test('a block with text next to a block without text only selects it', () => {
    const ed = editor([p('a', 'x'), hr('d')], at('a', 1));
    ed.exec(joinForward);
    expect(ed.lines()).toEqual(['paragraph x', 'divider']);
    expect(ed.state.selection).toEqual({ kind: 'block', blockId: 'd' });
  });

  test('does not apply before the end', () => {
    const ed = editor([p('a', 'xy'), p('b')], at('a', 1));
    expect(ed.exec(joinForward)).toBe(false);
  });
});

describe('Tab and Shift-Tab', () => {
  test('indent needs a parent and stops at the maximum depth', () => {
    const ed = editor(
      [item('a', 'bullet', 0, 'a'), item('b', 'bullet', 0, 'b')],
      at('a', 0),
      at('b', 1),
    );
    expect(ed.exec(indentList)).toBe(true);
    expect(ed.lines()).toEqual(['bullet0 a', 'bullet1 b']);
    ed.exec(indentList);
    expect(ed.lines()).toEqual(['bullet0 a', 'bullet1 b']);
  });

  test('where no item can move, neither applies, so Tab moves focus (D5)', () => {
    const ed = editor(
      [item('a', 'bullet', 0), item('b', 'bullet', 1), item('c', 'bullet', 2)],
      at('c', 0),
    );
    expect(ed.exec(indentList)).toBe(false);
    ed.select(at('a', 0));
    expect(ed.exec(indentList)).toBe(false);
    expect(ed.exec(outdentList)).toBe(false);
    expect(ed.lines()).toEqual(['bullet0', 'bullet1', 'bullet2']);
  });

  test('outdent brings the children along', () => {
    const ed = editor(
      [item('a', 'bullet', 0), item('b', 'bullet', 1), item('c', 'bullet', 2)],
      at('b', 0),
    );
    ed.exec(outdentList);
    expect(ed.lines()).toEqual(['bullet0', 'bullet0', 'bullet1']);
  });

  test('outside a list neither applies, so Tab can move focus', () => {
    const ed = editor([p('a', 'x')], at('a', 0));
    expect(ed.exec(indentList)).toBe(false);
    expect(ed.exec(outdentList)).toBe(false);
  });
});

describe('toggleFormat', () => {
  test('a mark is added over a range unless all of it already has the mark', () => {
    const ed = editor(
      [
        {
          id: 'a',
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ab', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'cd', marks: [] },
          ],
        },
        hr('d'),
        p('b', 'ef'),
      ],
      at('a', 1),
      at('b', 1),
    );
    ed.exec(toggleFormat('bold'));
    expect(ed.lines()).toEqual(['paragraph **abcd**', 'divider', 'paragraph **e**f']);
    ed.exec(toggleFormat('bold'));
    expect(ed.lines()).toEqual(['paragraph **a**bcd', 'divider', 'paragraph ef']);
  });

  test('a block format toggles back to paragraphs when every block has it, ignoring indent', () => {
    const ed = editor(
      [item('a', 'bullet', 0, 'a'), item('b', 'ordered', 1, 'b')],
      at('a', 0),
      at('b', 0),
    );
    ed.exec(toggleFormat('bullet'));
    expect(ed.lines()).toEqual(['bullet0 a', 'bullet1 b']);
    ed.exec(toggleFormat('bullet'));
    expect(ed.lines()).toEqual(['paragraph a', 'paragraph b']);
  });

  test('a divider replaces an empty paragraph and the caret moves to the next block', () => {
    const ed = editor([p('a'), p('b', 'x')], at('a', 0));
    ed.exec(toggleFormat('divider'));
    expect(ed.lines()).toEqual(['divider', 'paragraph x']);
    expect(ed.caret()).toEqual(at('b', 0));
  });

  test('a divider goes after a block with text; with nothing after it, the caret is a gap', () => {
    const ed = editor([p('a', 'x')], at('a', 1));
    ed.exec(toggleFormat('divider'));
    expect(ed.lines()).toEqual(['paragraph x', 'divider']);
    expect(ed.state.selection).toEqual({ kind: 'gap', beforeBlockId: null });
  });
});

describe('insertFragment', () => {
  const fragment: Fragment = [
    h('f1', 2, 'one'),
    { id: 'f2', type: 'divider' },
    item('f3', 'bullet', 1, 'three'),
  ];

  test('one block goes inline at the caret', () => {
    const ed = editor([h('a', 1, 'ab')], at('a', 1));
    ed.run((s, e) => insertFragment(s, { fragment: [p('f', 'XY')] }, e));
    expect(ed.lines()).toEqual(['h1 aXYb']);
    expect(ed.caret()).toEqual(at('a', 3));
  });

  test('several blocks split the current block and join its two halves', () => {
    const ed = editor([p('a', 'ab')], at('a', 1));
    ed.run((s, e) => insertFragment(s, { fragment }, e));
    // The first block keeps the paragraph type; the list item is fitted to its place.
    expect(ed.lines()).toEqual(['paragraph aone', 'divider', 'bullet0 threeb']);
    expect(ed.caret()).toEqual(at('n0', 'three'.length));
  });

  test('an empty paragraph takes the type of the first block', () => {
    const ed = editor([p('a')], at('a', 0));
    ed.run((s, e) => insertFragment(s, { fragment }, e));
    expect(ed.lines()).toEqual(['h2 one', 'divider', 'bullet0 three']);
  });

  test('inserted blocks get new ids', () => {
    const ed = editor([p('a')], at('a', 0));
    ed.run((s, e) => insertFragment(s, { fragment }, e));
    expect(ed.state.doc.blocks.map((b) => b.id)).not.toContain('f2');
  });

  test('is one transaction, attributed to paste', () => {
    const ed = editor([p('a', 'ab')], at('a', 1));
    const tr = insertFragment(ed.state, { fragment }, ed.env);
    expect(tr?.origin).toBe('paste');
  });
});

describe('atoms, links and start numbers', () => {
  const atom: Inline = { type: 'raw', source: '![a](b)', marks: [] };
  const withAtom = (id: string): Block => ({
    id,
    type: 'paragraph',
    content: [text('ab'), atom, text('c')],
  });

  test('deleting the one position an atom takes removes it whole', () => {
    const ed = editor([withAtom('a')], at('a', 3));
    ed.run((s, e) => deleteTargetRange(s, { from: at('a', 2), to: at('a', 3) }, e));
    expect(ed.lines()).toEqual(['paragraph abc']);
    expect(ed.caret()).toEqual(at('a', 2));
  });

  test('code over a stretch with an atom marks the text but not the atom', () => {
    const ed = editor([withAtom('a')], at('a', 0), at('a', 4));
    ed.exec(toggleFormat('code'));
    expect(ed.lines()).toEqual(['paragraph `ab`{![a](b)}`c`']);
  });

  test('Enter at the end of an item that starts a run continues it without the start number', () => {
    const ed = editor(
      [{ id: 'a', type: 'ordered', indent: 0, start: 5, content: [text('x')] }],
      at('a', 1),
    );
    ed.exec(splitBlock);
    expect(ed.lines()).toEqual(['ordered0@5 x', 'ordered0']);
  });

  test('pasting text with line breaks splits it into blocks with new ids', () => {
    const ed = editor([p('a', 'xy')], at('a', 1));
    ed.run((s, e) => insertFragment(s, { fragment: [p('a', '1\n2\r\n3')] }, e));
    expect(ed.lines()).toEqual(['paragraph x1', 'paragraph 2', 'paragraph 3y']);
    const ids = ed.state.doc.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a pasted start number stays only where a run begins', () => {
    const ed = editor([item('a', 'ordered', 0, 'x')], at('a', 1));
    const pasted: Block = { id: 'f', type: 'ordered', indent: 0, start: 9, content: [text('y')] };
    ed.run((s, e) => insertFragment(s, { fragment: [p('f0', ''), pasted, p('f1', '')] }, e));
    // The item lands inside the run, so its 9 goes; the tail takes the last block's type.
    expect(ed.lines()).toEqual(['ordered0 x', 'ordered0 y', 'paragraph']);
  });
});

describe('a block selection and a gap', () => {
  const raw = (id: string): Block => ({ id, type: 'raw', source: 'R' });
  const blockSel = { kind: 'block', blockId: 'd' } as const;
  const gapSel = { kind: 'gap', beforeBlockId: 'r' } as const;
  const setup = (selection: typeof blockSel | typeof gapSel) => {
    const ed = editor([p('a', 'x'), hr('d'), raw('r')], at('a', 0));
    ed.setSelection(selection);
    expect(ed.state.selection).toEqual(selection);
    return ed;
  };

  test('typing with a block selected goes into a new paragraph after it', () => {
    const ed = setup(blockSel);
    ed.type('hi');
    expect(ed.lines()).toEqual(['paragraph x', 'divider', 'paragraph hi', 'raw R']);
    expect(ed.caret()).toEqual(at('n0', 2));
  });

  test('typing at a gap goes into a new paragraph there', () => {
    const ed = setup(gapSel);
    ed.type('hi');
    expect(ed.lines()).toEqual(['paragraph x', 'divider', 'paragraph hi', 'raw R']);
  });

  test('Enter makes an empty paragraph after the block, or at the gap', () => {
    const block = setup(blockSel);
    block.exec(splitBlock);
    expect(block.lines()).toEqual(['paragraph x', 'divider', 'paragraph', 'raw R']);
    const gap = setup({ kind: 'gap', beforeBlockId: 'r' });
    gap.exec(splitBlock);
    expect(gap.lines()).toEqual(['paragraph x', 'divider', 'paragraph', 'raw R']);
  });

  test('Backspace and Delete delete a selected block; at a gap they select its neighbour', () => {
    const block = setup(blockSel);
    block.exec(deleteSelectedBlock);
    expect(block.lines()).toEqual(['paragraph x', 'raw R']);
    expect(block.caret()).toEqual(at('a', 1));
    const gap = setup(gapSel);
    expect(gap.exec(selectBlockBackward)).toBe(true);
    expect(gap.state.selection).toEqual(blockSel);
    gap.setSelection(gapSel);
    expect(gap.exec(selectBlockForward)).toBe(true);
    expect(gap.state.selection).toEqual({ kind: 'block', blockId: 'r' });
  });

  test('deleting the only block leaves an empty paragraph', () => {
    const ed = editor([hr('d')], at('d', 0));
    ed.exec(deleteSelectedBlock);
    expect(ed.lines()).toEqual(['paragraph']);
  });

  test('marks, block formats and Tab do not apply', () => {
    for (const selection of [blockSel, gapSel]) {
      const ed = setup(selection);
      expect(ed.exec(toggleFormat('bold'))).toBe(false);
      expect(ed.exec(toggleFormat('heading1'))).toBe(false);
      expect(ed.exec(indentList)).toBe(false);
    }
  });

  test('a divider goes in after the block, or at the gap', () => {
    const ed = setup(gapSel);
    ed.exec(toggleFormat('divider'));
    expect(ed.lines()).toEqual(['paragraph x', 'divider', 'divider', 'raw R']);
    expect(ed.state.selection.kind).toBe('gap');
  });

  test('pasted blocks go in after the block, the caret at the end of the last text', () => {
    const ed = setup(blockSel);
    ed.exec((s, _i, e) => insertFragment(s, { fragment: [p('f', 'new')] }, e));
    expect(ed.lines()).toEqual(['paragraph x', 'divider', 'paragraph new', 'raw R']);
    expect(ed.caret()).toEqual(at('n0', 3));
  });
});
