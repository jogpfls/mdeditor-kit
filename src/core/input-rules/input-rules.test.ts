import { describe, expect, test } from 'vitest';
import { joinBackward, outdentListAtStart, resetBlockAtStart } from '../commands';
import { undo } from '../history';
import { HEADING_LEVELS, text, type Block } from '../model';
import { at, p } from '../model/fixtures.test-support';
import { editor } from './harness.test-support';
import { undoInputRule } from '.';

const typed = (text: string) => {
  const ed = editor([p('a')], at('a', 0));
  ed.type(text);
  return ed;
};

/** The Backspace chain from the input bindings, minus the range deletion. */
const BACKSPACE = [undoInputRule, outdentListAtStart, resetBlockAtStart, joinBackward];

describe('block rules', () => {
  test.each([
    ['# ', 'h1'],
    ['## ', 'h2'],
    ['### ', 'h3'],
    ['#### ', 'h4'],
    ['> ', 'quote'],
    ['- ', 'bullet0'],
    ['* ', 'bullet0'],
    ['+ ', 'bullet0'],
    ['1. ', 'ordered0'],
    ['1) ', 'ordered0'],
    ['12. ', 'ordered0@12'],
  ])('%j turns the paragraph into %s and removes the syntax', (syntax, block) => {
    const ed = typed(`${syntax}제목`);
    expect(ed.lines()).toEqual([`${block} 제목`]);
  });

  test('every heading level in the model has a rule', () => {
    for (const level of HEADING_LEVELS) {
      expect(typed(`${'#'.repeat(level)} a`).lines()).toEqual([`h${level} a`]);
    }
  });

  test.each([
    ['3. ', 3],
    ['12) ', 12],
    ['0. ', 0],
    ['1. ', undefined],
  ])('%j starting a list keeps its number as the start number', (syntax, start) => {
    const [block] = typed(`${syntax}a`).state.doc.blocks;
    expect(block).toEqual({
      id: 'a',
      type: 'ordered',
      indent: 0,
      ...(start === undefined ? {} : { start }),
      content: [text('a')],
    });
  });

  test('a number typed to continue a list is ignored: the item counts on', () => {
    const ed = editor(
      [{ id: 'a', type: 'ordered', indent: 0, start: 4, content: [text('x')] }, p('b')],
      at('b', 0),
    );
    ed.type('9. y');
    expect(ed.state.doc.blocks).toEqual([
      { id: 'a', type: 'ordered', indent: 0, start: 4, content: [text('x')] },
      { id: 'b', type: 'ordered', indent: 0, content: [text('y')] },
    ]);
  });

  test('undoing the rule brings back the number as typed', () => {
    const ed = typed('7. ');
    ed.chain(BACKSPACE);
    expect(ed.state.doc.blocks).toEqual([p('a', '7. ')]);
  });

  test('"* " and the italic rule do not conflict', () => {
    expect(typed('* a*').lines()).toEqual(['bullet0 a*']);
    expect(typed('*a*b').lines()).toEqual(['paragraph _a_b']);
  });

  test('a number longer than CommonMark allows stays text', () => {
    expect(typed('1234567890. a').lines()).toEqual(['paragraph 1234567890. a']);
  });

  test('##### is out of range and stays text', () => {
    expect(typed('##### a').lines()).toEqual(['paragraph ##### a']);
  });

  test('--- becomes a divider on the third dash; the caret goes to the gap after it', () => {
    const ed = typed('---');
    expect(ed.lines()).toEqual(['divider']);
    expect(ed.state.selection).toEqual({ kind: 'gap', beforeBlockId: null });
    ed.type('x');
    expect(ed.lines()).toEqual(['divider', 'paragraph x']);
  });

  test('-- triggers nothing', () => {
    expect(typed('--').lines()).toEqual(['paragraph --']);
  });

  test('"- " and "---" do not interfere', () => {
    expect(typed('- -').lines()).toEqual(['bullet0 -']);
    expect(typed('---').lines()).toEqual(['divider']);
  });

  test('--- is not a divider with text after the caret', () => {
    const ed = editor([p('a', 'x')], at('a', 0));
    ed.type('---');
    expect(ed.lines()).toEqual(['paragraph ---x']);
  });

  test('block rules only apply in paragraphs', () => {
    const ed = typed('# ');
    ed.type('> ');
    expect(ed.lines()).toEqual(['h1 >']);
  });
});

describe('inline rules', () => {
  test.each([
    ['**굵게**', 'paragraph **굵게**'],
    ['*기울임*', 'paragraph _기울임_'],
    ['~~취소~~', 'paragraph ~~취소~~'],
    ['`코드`', 'paragraph `코드`'],
  ])('%s marks the text and drops the delimiters', (input, line) => {
    expect(typed(input).lines()).toEqual([line]);
  });

  test('the next character is typed outside the new mark', () => {
    const ed = typed('**굵게**다');
    expect(ed.lines()).toEqual(['paragraph **굵게**다']);
  });

  test('**굵게* does not fire the italic rule', () => {
    expect(typed('**굵게*').lines()).toEqual(['paragraph **굵게*']);
  });

  test('a delimiter next to whitespace inside does not fire', () => {
    expect(typed('** a**').lines()).toEqual(['paragraph ** a**']);
  });

  test('a match containing code is not formatted by the other rules', () => {
    const block = {
      id: 'a',
      type: 'paragraph' as const,
      content: [
        { type: 'text' as const, text: '**', marks: [] },
        { type: 'text' as const, text: 'a', marks: [{ type: 'code' } as const] },
        { type: 'text' as const, text: '*', marks: [] },
      ],
    };
    const ed = editor([block], at('a', 4));
    ed.type('*');
    expect(ed.lines()).toEqual(['paragraph **`a`**']);
  });
});

describe('atoms', () => {
  test('an inline rule never reaches across an atom', () => {
    const block: Block = {
      id: 'a',
      type: 'paragraph',
      content: [text('*a'), { type: 'raw', source: '<kbd>', marks: [] }, text('b')],
    };
    const ed = editor([block], at('a', 4));
    ed.type('*');
    expect(ed.lines()).toEqual(['paragraph *a{<kbd>}b*']);
  });
});

describe('undoInputRule', () => {
  test('Backspace right after a block rule brings the syntax back', () => {
    const ed = typed('# ');
    expect(ed.chain(BACKSPACE)).toBe(0);
    expect(ed.lines()).toEqual(['paragraph #']);
    expect(ed.caret()).toEqual(at('a', 2));
  });

  test('Backspace right after an inline rule brings the delimiters back', () => {
    const ed = typed('**굵게**');
    expect(ed.chain(BACKSPACE)).toBe(0);
    expect(ed.lines()).toEqual(['paragraph **굵게**']);
    expect(ed.state.doc.blocks[0]).toMatchObject({
      content: [{ type: 'text' as const, text: '**굵게**', marks: [] }],
    });
  });

  test('does not apply once the caret has moved', () => {
    const ed = editor([p('a'), p('b', 'x')], at('a', 0));
    ed.type('# ');
    ed.select(at('b', 1));
    ed.select(at('a', 0));
    expect(ed.exec(undoInputRule)).toBe(false);
    expect(ed.chain(BACKSPACE)).toBe(2);
    expect(ed.lines()).toEqual(['paragraph', 'paragraph x']);
  });

  test('a selection event that does not move the caret is not a move', () => {
    const ed = typed('# ');
    ed.select(at('a', 0));
    expect(ed.exec(undoInputRule)).toBe(true);
  });

  test('does not apply after more typing', () => {
    const ed = typed('# a');
    expect(ed.exec(undoInputRule)).toBe(false);
  });

  test('ordinary undo also undoes the rule first, then the typing', () => {
    const ed = typed('# ');
    ed.exec(undo);
    expect(ed.lines()).toEqual(['paragraph #']);
    ed.exec(undo);
    expect(ed.lines()).toEqual(['paragraph']);
  });
});
