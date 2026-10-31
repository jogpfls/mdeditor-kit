import { expect, test } from 'vitest';
import { MARK_TYPES, text } from '../model';
import { parseMarkdown } from './parse';
import { serializeMarkdown } from './serialize';
import { markDelimiters, startsHtmlBlock } from './syntax';

test('text holding any delimiter, written or only read, comes back as plain text', () => {
  for (const delimiter of MARK_TYPES.flatMap(markDelimiters)) {
    const value = `a${delimiter}b${delimiter}c`;
    const markdown = serializeMarkdown([{ id: 'a', type: 'paragraph', content: [text(value)] }]);
    const [block] = parseMarkdown(markdown, () => 'b').blocks;
    expect(block).toEqual({ id: 'b', type: 'paragraph', content: [text(value)] });
  }
});

test.each([
  ['<pre>', true],
  ['<script src="x">', true],
  ['<!-- comment', true],
  ['<?php', true],
  ['<!DOCTYPE html>', true],
  ['<![CDATA[x]]>', true],
  ['<div>text', true],
  ['</table>', true],
  ['   <p>', true],
  ['<kbd>', true],
  ['<span class="x"> ', true],
  ['<kbd>x', false],
  ['<span>text</span>', false],
  ['    <div>', false],
  ['text <div>', false],
  ['<not a tag', false],
])('%j starts an HTML block: %s', (line, starts) => {
  expect(startsHtmlBlock(line)).toBe(starts);
});

test('what startsHtmlBlock says matches what the parser reads', () => {
  for (const line of ['<div>text', '<kbd>', '<kbd>x', '<!-- c -->', '<span>a</span>']) {
    const [block] = parseMarkdown(line, () => 'b').blocks;
    expect(block?.type === 'raw', line).toBe(startsHtmlBlock(line));
  }
});
