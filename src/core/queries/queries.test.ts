import { describe, expect, test } from 'vitest';
import type { Block } from '../model';
import { textSelection, type EditorState, type Selection } from '../state';
import { FORMATS, isFormat } from '../formats';
import { arrowSelection, formatStates, isActive } from '.';

const FORMAT_NAMES = Object.keys(FORMATS).filter(isFormat);

const doc: readonly Block[] = [
  {
    id: 'a',
    type: 'paragraph',
    content: [
      { type: 'text', text: 'ab', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'cd', marks: [{ type: 'bold' }, { type: 'italic' }] },
    ],
  },
  { id: 'd', type: 'divider' },
  {
    id: 'b',
    type: 'bullet',
    indent: 1,
    content: [{ type: 'text', text: 'ef', marks: [{ type: 'bold' }] }],
  },
  { id: 'c', type: 'heading', level: 2, content: [] },
];

const state = (
  selection: Selection,
  storedMarks: EditorState['storedMarks'] = null,
): EditorState => ({
  doc: { blocks: doc },
  selection,
  storedMarks,
});
const range = (a: string, ao: number, b: string, bo: number) =>
  state(textSelection({ blockId: a, offset: ao }, { blockId: b, offset: bo }));
const caret = (a: string, o: number) => range(a, o, a, o);

describe('marks', () => {
  test('on when every selected character has the mark, across blocks and dividers', () => {
    expect(isActive(range('a', 0, 'b', 2), 'bold')).toBe(true);
    expect(isActive(range('a', 0, 'b', 2), 'italic')).toBe(false);
    expect(isActive(range('b', 2, 'a', 2), 'italic')).toBe(false);
    expect(isActive(range('a', 2, 'a', 4), 'italic')).toBe(true);
  });

  test('at a caret, the character before decides', () => {
    expect(isActive(caret('a', 3), 'italic')).toBe(true);
    expect(isActive(caret('a', 2), 'italic')).toBe(false);
    expect(isActive(caret('a', 0), 'bold')).toBe(false);
  });

  test('at a caret, stored marks win', () => {
    const s = state(textSelection({ blockId: 'a', offset: 3 }), []);
    expect(isActive(s, 'bold')).toBe(false);
  });
});

describe('blocks', () => {
  test('compares the type and the heading level, not the indent', () => {
    expect(isActive(caret('b', 0), 'bullet')).toBe(true);
    expect(isActive(caret('c', 0), 'heading2')).toBe(true);
    expect(isActive(caret('c', 0), 'heading1')).toBe(false);
  });

  test('every touched text block must have the type; dividers are skipped', () => {
    expect(isActive(range('d', 0, 'b', 0), 'bullet')).toBe(true);
    expect(isActive(range('a', 0, 'b', 0), 'bullet')).toBe(false);
  });

  test('an insert format is never on', () => {
    expect(isActive(caret('d', 0), 'divider')).toBe(false);
  });
});

describe('formatStates', () => {
  test('agrees with isActive for every format, and everything applies to text', () => {
    for (const s of [range('a', 0, 'b', 2), range('a', 2, 'a', 4), caret('a', 3), caret('c', 0)]) {
      const states = formatStates(s);
      for (const format of FORMAT_NAMES) {
        expect(states(format)).toEqual({ active: isActive(s, format), applicable: true });
      }
    }
  });

  test('a block selection or a gap: nothing is on, only inserting applies', () => {
    for (const selection of [
      { kind: 'block', blockId: 'd' },
      { kind: 'gap', beforeBlockId: null },
    ] satisfies Selection[]) {
      const states = formatStates(state(selection));
      expect(states('bold')).toEqual({ active: false, applicable: false });
      expect(states('heading2')).toEqual({ active: false, applicable: false });
      expect(states('divider')).toEqual({ active: false, applicable: true });
    }
  });
});

describe('arrowSelection', () => {
  const blocks: readonly Block[] = [
    { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'xy', marks: [] }] },
    { id: 'd', type: 'divider' },
    { id: 'r', type: 'raw', source: 'R' },
    { id: 'b', type: 'paragraph', content: [] },
  ];
  const at = (selection: Selection): EditorState => ({
    doc: { blocks },
    selection,
    storedMarks: null,
  });
  const block = (blockId: string): Selection => ({ kind: 'block', blockId });
  const gap = (beforeBlockId: string | null): Selection => ({ kind: 'gap', beforeBlockId });

  test('from the edge of a text block onto a block without text selects it', () => {
    expect(arrowSelection(at(textSelection({ blockId: 'a', offset: 2 })), 'forward')).toEqual(
      block('d'),
    );
    expect(arrowSelection(at(textSelection({ blockId: 'b', offset: 0 })), 'backward')).toEqual(
      block('r'),
    );
  });

  test('inside text, or with a range, the browser moves the caret', () => {
    expect(arrowSelection(at(textSelection({ blockId: 'a', offset: 1 })), 'forward')).toBeNull();
    expect(
      arrowSelection(
        at(textSelection({ blockId: 'a', offset: 0 }, { blockId: 'a', offset: 2 })),
        'forward',
      ),
    ).toBeNull();
  });

  test('a selected block steps to the text next to it, or to the gap', () => {
    expect(arrowSelection(at(block('d')), 'backward')).toEqual(
      textSelection({ blockId: 'a', offset: 2 }),
    );
    expect(arrowSelection(at(block('d')), 'forward')).toEqual(gap('r'));
    expect(arrowSelection(at(block('r')), 'forward')).toEqual(
      textSelection({ blockId: 'b', offset: 0 }),
    );
  });

  test('a gap steps to the block next to it', () => {
    expect(arrowSelection(at(gap('r')), 'forward')).toEqual(block('r'));
    expect(arrowSelection(at(gap('r')), 'backward')).toEqual(block('d'));
  });
});
