import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  ATOM_CHAR,
  HEADING_LEVELS,
  MAX_HEADING_LEVEL,
  blockContent,
  contentLength,
  contentText,
  isHeadingLevel,
  listNumbers,
  normalizeContent,
  normalizeDoc,
  sameMark,
  slice,
  sliceContent,
  sortMarks,
  text,
  type Block,
  type Doc,
  type Inline,
  type Mark,
} from '.';
import { WIDE_CHARS, counter, untrustedBlocks } from './arbitrary.test-support';
import { p } from './fixtures.test-support';

const ids = () => {
  let next = 0;
  return () => `new${next++}`;
};

describe('normalizeContent', () => {
  test('drops empty runs and merges neighbours with the same marks', () => {
    expect(
      normalizeContent([
        { type: 'text' as const, text: 'a', marks: [{ type: 'bold' }] },
        { type: 'text' as const, text: '', marks: [{ type: 'italic' }] },
        { type: 'text' as const, text: 'b', marks: [{ type: 'bold' }] },
        { type: 'text' as const, text: 'c', marks: [] },
      ]),
    ).toEqual([
      { type: 'text' as const, text: 'ab', marks: [{ type: 'bold' }] },
      { type: 'text' as const, text: 'c', marks: [] },
    ]);
  });

  test('sorts and deduplicates marks so that equal sets compare equal', () => {
    expect(
      normalizeContent([
        {
          type: 'text' as const,
          text: 'a',
          marks: [{ type: 'code' }, { type: 'bold' }, { type: 'strike' }, { type: 'bold' }],
        },
        {
          type: 'text' as const,
          text: 'b',
          marks: [{ type: 'strike' }, { type: 'code' }, { type: 'bold' }],
        },
      ]),
    ).toEqual([
      {
        type: 'text' as const,
        text: 'ab',
        marks: [{ type: 'strike' }, { type: 'bold' }, { type: 'code' }],
      },
    ]);
  });
});

describe('normalizeDoc', () => {
  test('an empty document becomes one empty paragraph', () => {
    expect(normalizeDoc({ blocks: [] }, ids())).toEqual({
      blocks: [{ id: 'new0', type: 'paragraph', content: [] }],
    });
  });

  test('a list item is at most one level deeper than the list item before it', () => {
    const doc: Doc = {
      blocks: [
        { id: 'p', type: 'paragraph', content: [] },
        { id: 'a', type: 'bullet', indent: 2, content: [] },
        { id: 'b', type: 'ordered', indent: 2, content: [] },
        { id: 'c', type: 'bullet', indent: 9, content: [] },
      ],
    };
    const indents = normalizeDoc(doc, ids()).blocks.map((block) =>
      'indent' in block ? block.indent : null,
    );
    // a and b were siblings and stay siblings; c was deeper and stays deeper.
    expect(indents).toEqual([null, 0, 0, 1]);
  });

  test('moving an orphaned item up moves the items under it by the same amount', () => {
    const doc: Doc = {
      blocks: [
        { id: 'p', type: 'paragraph', content: [] },
        { id: 'a', type: 'bullet', indent: 1, content: [] },
        { id: 'b', type: 'bullet', indent: 2, content: [] },
        { id: 'c', type: 'bullet', indent: 1, content: [] },
        { id: 'd', type: 'bullet', indent: 0, content: [] },
        { id: 'e', type: 'bullet', indent: 1, content: [] },
      ],
    };
    const indents = normalizeDoc(doc, ids()).blocks.map((block) =>
      'indent' in block ? block.indent : null,
    );
    expect(indents).toEqual([null, 0, 1, 0, 0, 1]);
  });

  test('keeps the references of blocks that were already normalized', () => {
    const kept: Block = {
      id: 'a',
      type: 'paragraph',
      content: [{ type: 'text' as const, text: 'x', marks: [] }],
    };
    const doc: Doc = {
      blocks: [
        kept,
        { id: 'b', type: 'paragraph', content: [{ type: 'text' as const, text: '', marks: [] }] },
      ],
    };
    const result = normalizeDoc(doc, ids());
    expect(result.blocks[0]).toBe(kept);
    expect(result.blocks[1]).not.toBe(doc.blocks[1]);
    expect(normalizeDoc(result, ids())).toBe(result);
  });
});

describe('slice', () => {
  const doc: Doc = {
    blocks: [
      {
        id: 'a',
        type: 'heading',
        level: 1,
        content: [
          { type: 'text' as const, text: 'ab', marks: [] },
          { type: 'text' as const, text: 'cd', marks: [{ type: 'bold' }] },
        ],
      },
      { id: 'hr', type: 'divider' },
      { id: 'b', type: 'quote', content: [{ type: 'text' as const, text: 'mid', marks: [] }] },
      {
        id: 'c',
        type: 'bullet',
        indent: 0,
        content: [{ type: 'text' as const, text: 'xyz', marks: [{ type: 'italic' }] }],
      },
    ],
  };

  test('within one block keeps only the selected text and its marks', () => {
    expect(slice(doc, { blockId: 'a', offset: 1 }, { blockId: 'a', offset: 3 })).toEqual([
      {
        id: 'a',
        type: 'heading',
        level: 1,
        content: [
          { type: 'text' as const, text: 'b', marks: [] },
          { type: 'text' as const, text: 'c', marks: [{ type: 'bold' }] },
        ],
      },
    ]);
  });

  test('across blocks trims the ends and keeps the middle whole', () => {
    expect(slice(doc, { blockId: 'a', offset: 3 }, { blockId: 'c', offset: 1 })).toEqual([
      {
        id: 'a',
        type: 'heading',
        level: 1,
        content: [{ type: 'text' as const, text: 'd', marks: [{ type: 'bold' }] }],
      },
      { id: 'hr', type: 'divider' },
      { id: 'b', type: 'quote', content: [{ type: 'text' as const, text: 'mid', marks: [] }] },
      {
        id: 'c',
        type: 'bullet',
        indent: 0,
        content: [{ type: 'text' as const, text: 'x', marks: [{ type: 'italic' }] }],
      },
    ]);
  });

  test('accepts the positions in either order', () => {
    const from = { blockId: 'a', offset: 3 };
    const to = { blockId: 'b', offset: 2 };
    expect(slice(doc, to, from)).toEqual(slice(doc, from, to));
  });

  test('a position outside the document gives an empty fragment', () => {
    expect(slice(doc, { blockId: 'gone', offset: 0 }, { blockId: 'a', offset: 1 })).toEqual([]);
  });
});

describe('heading levels', () => {
  test('are listed in order from the type, and nothing else is a level', () => {
    expect(HEADING_LEVELS).toEqual([1, 2, 3, 4]);
    expect(MAX_HEADING_LEVEL).toBe(4);
    for (const value of [0, 5, 1.5, -1, Number.NaN]) expect(isHeadingLevel(value)).toBe(false);
  });
});

describe('marks', () => {
  test('two links are the same mark only when address and title match', () => {
    const a: Mark = { type: 'link', href: 'x' };
    expect(sameMark(a, { type: 'link', href: 'x' })).toBe(true);
    expect(sameMark(a, { type: 'link', href: 'y' })).toBe(false);
    expect(sameMark(a, { type: 'link', href: 'x', title: 't' })).toBe(false);
  });

  test('a stretch carries at most one mark of each type, the first, in a fixed order', () => {
    expect(
      sortMarks([{ type: 'bold' }, { type: 'link', href: 'a' }, { type: 'link', href: 'b' }]),
    ).toEqual([{ type: 'link', href: 'a' }, { type: 'bold' }]);
  });

  test('text runs with different links do not merge; with the same link they do', () => {
    const a: Mark = { type: 'link', href: 'a' };
    expect(
      normalizeContent([text('x', [a]), text('y', [{ type: 'link', href: 'b' }])]),
    ).toHaveLength(2);
    expect(normalizeContent([text('x', [a]), text('y', [{ type: 'link', href: 'a' }])])).toEqual([
      text('xy', [a]),
    ]);
  });
});

describe('atoms', () => {
  const atom: Inline = { type: 'raw', source: '![a](b)', marks: [] };

  test('take one position each, shown as U+FFFC in the content text', () => {
    const content = [text('ab'), atom, text('c')];
    expect(contentLength(content)).toBe(4);
    expect(contentText(content)).toBe(`ab${ATOM_CHAR}c`);
  });

  test('are sliced whole or not at all', () => {
    const content = [text('ab'), atom, text('c')];
    expect(sliceContent(content, 1, 3)).toEqual([text('b'), atom]);
    expect(sliceContent(content, 3, 4)).toEqual([text('c')]);
  });

  test('never carry code, which cannot hold them', () => {
    expect(normalizeContent([{ ...atom, marks: [{ type: 'code' }, { type: 'bold' }] }])).toEqual([
      { ...atom, marks: [{ type: 'bold' }] },
    ]);
  });
});

describe('normalizeDoc: outside input', () => {
  test('a line break in text splits the block into blocks of the same type', () => {
    const doc: Doc = {
      blocks: [
        {
          id: 'a',
          type: 'ordered',
          indent: 0,
          start: 3,
          content: [text('one\ntwo', [{ type: 'bold' }])],
        },
        { id: 'b', type: 'raw', source: 'keeps\nits lines' },
      ],
    };
    expect(normalizeDoc(doc, ids()).blocks).toEqual([
      { id: 'a', type: 'ordered', indent: 0, start: 3, content: [text('one', [{ type: 'bold' }])] },
      { id: 'new0', type: 'ordered', indent: 0, content: [text('two', [{ type: 'bold' }])] },
      { id: 'b', type: 'raw', source: 'keeps\nits lines' },
    ]);
  });

  test('a repeated or empty id is replaced; the first holder keeps it', () => {
    const blocks: Block[] = [p('a'), p('a'), p(''), p('new0')];
    expect(normalizeDoc({ blocks }, ids()).blocks.map((b) => b.id)).toEqual([
      'a',
      'new1',
      'new2',
      'new0',
    ]);
  });

  test('only the first item of an ordered run keeps a start number, and never 1 or an invalid one', () => {
    const ordered = (start: number | undefined, indent = 0): Block =>
      start === undefined
        ? { id: '', type: 'ordered', indent, content: [] }
        : { id: '', type: 'ordered', indent, start, content: [] };
    const blocks = [ordered(5), ordered(9), ordered(4, 1), p(''), ordered(1), p(''), ordered(1.5)];
    const starts = normalizeDoc({ blocks }, ids()).blocks.map((b) =>
      b.type === 'ordered' ? (b.start ?? null) : '-',
    );
    expect(starts).toEqual([5, null, 4, '-', null, '-', null]);
  });

  test('list numbers count on from the start of each run', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'ordered', indent: 0, start: 3, content: [] },
      { id: 'b', type: 'ordered', indent: 1, content: [] },
      { id: 'c', type: 'ordered', indent: 0, content: [] },
      { id: 'd', type: 'bullet', indent: 0, content: [] },
      { id: 'e', type: 'ordered', indent: 0, content: [] },
    ];
    expect(listNumbers(blocks)).toEqual([3, 1, 4, null, 1]);
  });

  test('restores every invariant, and is idempotent, for any input', () => {
    fc.assert(
      fc.property(untrustedBlocks(WIDE_CHARS), (blocks) => {
        const once = normalizeDoc({ blocks }, counter('n'));
        expect(normalizeDoc(once, counter('m'))).toBe(once);

        const seen = once.blocks.map((b) => b.id);
        expect(new Set(seen).size).toBe(seen.length);
        expect(seen).not.toContain('');
        for (const block of once.blocks) {
          expect(contentText(blockContent(block) ?? [])).not.toMatch(/[\r\n]/);
        }
        const textOf = (list: readonly Block[]) =>
          list
            .map((b) => contentText(blockContent(b) ?? []))
            .join('')
            .replace(/[\r\n]/g, '');
        expect(textOf(once.blocks)).toBe(textOf(blocks));
      }),
      { numRuns: 1000 },
    );
  });
});
