import { describe, expect, test } from 'vitest';
import type { Block, Doc } from '../model';
import { at, hr, p } from '../model/fixtures.test-support';
import {
  isValidSelection,
  normalizeSelection,
  selectionAtPlace,
  startSelection,
  textSelection,
  type Selection,
} from '.';

const raw = (id: string): Block => ({ id, type: 'raw', source: '```\ncode\n```' });
const doc = (...blocks: Block[]): Doc => ({ blocks });
const block = (blockId: string): Selection => ({ kind: 'block', blockId });
const gap = (beforeBlockId: string | null): Selection => ({ kind: 'gap', beforeBlockId });

describe('the start of a document', () => {
  test('is a caret in the first block, or the gap before it when it has no text', () => {
    expect(startSelection(doc(p('a', 'x'), hr('d')))).toEqual(textSelection(at('a', 0)));
    expect(startSelection(doc(hr('d'), p('a', 'x')))).toEqual(gap('d'));
  });
});

describe('a place between blocks', () => {
  const d = doc(p('a', 'xy'), hr('d1'), raw('r'), p('b', 'z'));
  test('next to a text block is a caret in it, the block before winning', () => {
    expect(selectionAtPlace(d, 1)).toEqual(textSelection(at('a', 2)));
    expect(selectionAtPlace(d, 3)).toEqual(textSelection(at('b', 0)));
  });
  test('between blocks without text is a gap', () => {
    expect(selectionAtPlace(d, 2)).toEqual(gap('r'));
    expect(selectionAtPlace(doc(p('a'), hr('d')), 2)).toEqual(gap(null));
  });
});

describe('normalizing a selection', () => {
  const d = doc(p('a', 'xy'), hr('d1'), raw('r'), p('b', 'z'));

  test('a caret on a block without text selects the block', () => {
    expect(normalizeSelection(d, textSelection(at('d1', 0)))).toEqual(block('d1'));
  });

  test('an end of a range on a block without text moves towards the other end, to text', () => {
    expect(normalizeSelection(d, textSelection(at('a', 1), at('r', 0)))).toEqual(
      textSelection(at('a', 1), at('a', 2)),
    );
    expect(normalizeSelection(d, textSelection(at('d1', 0), at('b', 1)))).toEqual(
      textSelection(at('b', 0), at('b', 1)),
    );
  });

  test('a range with no text in it selects the focus block', () => {
    expect(normalizeSelection(d, textSelection(at('d1', 0), at('r', 0)))).toEqual(block('r'));
  });

  test('offsets are clamped', () => {
    expect(normalizeSelection(d, textSelection(at('a', 9)))).toEqual(textSelection(at('a', 2)));
  });

  test('a block selection on a text block is a caret at its start', () => {
    expect(normalizeSelection(d, block('b'))).toEqual(textSelection(at('b', 0)));
  });

  test('a gap next to a text block is a caret in it', () => {
    expect(normalizeSelection(d, gap('d1'))).toEqual(textSelection(at('a', 2)));
    expect(normalizeSelection(d, gap(null))).toEqual(textSelection(at('b', 1)));
    expect(isValidSelection(d, gap('r'))).toBe(true);
  });

  test('anything pointing at a block that is gone goes to the start', () => {
    expect(normalizeSelection(d, block('gone'))).toEqual(textSelection(at('a', 0)));
    expect(normalizeSelection(d, gap('gone'))).toEqual(textSelection(at('a', 0)));
    expect(normalizeSelection(d, textSelection(at('gone', 0)))).toEqual(textSelection(at('a', 0)));
  });

  test('a valid selection comes back as the same object', () => {
    const selection = textSelection(at('a', 1), at('b', 0));
    expect(normalizeSelection(d, selection)).toBe(selection);
  });
});
