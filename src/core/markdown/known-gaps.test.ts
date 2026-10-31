/**
 * The checklist stage 3 of the plan closed. These were `test.fails` while the
 * gaps were open: write a new gap here as `test.fails`, with the behaviour it
 * should have, and turn it into a plain `test` once it is closed.
 */
import { describe, expect, test } from 'vitest';
import type { Block, Inline } from '../model';
import { counter, withoutIds } from '../model/arbitrary.test-support';
import { parseMarkdown, serializeMarkdown } from '.';

const parse = (markdown: string) => withoutIds(parseMarkdown(markdown, counter()));
const atom = (source: string): Inline => ({ type: 'raw', source, marks: [] });
const plain = (text: string): Inline => ({ type: 'text', text, marks: [] });

describe('stage 3: the markdown boundary', () => {
  test('a block that starts with an inline HTML atom round-trips (`- <kbd>`)', () => {
    const blocks: Block[] = [{ id: '', type: 'bullet', indent: 0, content: [atom('<kbd>')] }];
    expect(parse(serializeMarkdown(blocks))).toEqual(withoutIds({ blocks }));
  });

  test('an HTML comment in the user’s markdown is kept, not dropped', () => {
    expect(parse('a\n\n<!-- note -->\n\nb')).toContainEqual({
      type: 'raw',
      source: '<!-- note -->',
    });
  });

  test('the user’s own <b> and <strong> are kept as written, not turned into marks', () => {
    expect(parse('<b>x</b> <strong>y</strong>')).toEqual([
      {
        type: 'paragraph',
        content: [
          atom('<b>'),
          plain('x'),
          atom('</b>'),
          plain(' '),
          atom('<strong>'),
          plain('y'),
          atom('</strong>'),
        ],
      },
    ]);
  });
});

describe('open gaps', () => {
  // A lone closing tag after a list item's text reads as a lazy continuation
  // of the item, or as an HTML block in the item, depending on whether blank
  // lines follow it at the end of the document; writing it back once changes
  // which, so writing it a second time changes it again.
  test.fails('writing markdown back is idempotent for a lone tag after a list item', () => {
    const once = serializeMarkdown(parseMarkdown('3) a\n</b>\n\n', counter()).blocks);
    expect(serializeMarkdown(parseMarkdown(once, counter()).blocks)).toBe(once);
  });
});
