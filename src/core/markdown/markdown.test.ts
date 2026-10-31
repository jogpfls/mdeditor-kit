import { describe, expect, test } from 'vitest';
import type { Block, Doc, Inline, Mark, MarkType, TextRun } from '../model';
import { canonical, parseMarkdown, serializeMarkdown } from '.';

const counter = () => {
  let next = 0;
  return () => `id${next++}`;
};

/** A text run; marks without attributes are named by type, links passed whole. */
const run = (text: string, ...marks: (Exclude<MarkType, 'link'> | Mark)[]): TextRun => ({
  type: 'text',
  text,
  marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)),
});
const p = (...content: TextRun[]): Block => ({ id: '', type: 'paragraph', content });
const li = (type: 'bullet' | 'ordered', indent: number, ...content: TextRun[]): Block => ({
  id: '',
  type,
  indent,
  content,
});

const md = (...blocks: Block[]) => serializeMarkdown(blocks);
const parse = (markdown: string) =>
  parseMarkdown(markdown, counter()).blocks.map((b) =>
    Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'id')),
  );
const roundTrip = (...blocks: Block[]) => {
  expect(parse(md(...blocks))).toEqual(
    blocks.map((b) => Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'id'))),
  );
};

describe('empty blocks', () => {
  test('an empty paragraph is written as &nbsp; and read back', () => {
    const blocks = [p(run('a')), p(), p(run('b'))];
    expect(md(...blocks)).toBe('a\n\n&nbsp;\n\nb');
    roundTrip(...blocks);
  });

  test('a block holding only whitespace, U+00A0 included, is empty', () => {
    expect(canonical({ blocks: [p(run(' \u00a0\t', 'bold'))] }).blocks).toEqual([p()]);
    expect(parse('a\n\n&nbsp; &#32;\n\nb')[1]).toEqual({ type: 'paragraph', content: [] });
  });

  test('a document that is one empty paragraph is the empty string, both ways', () => {
    expect(md(p())).toBe('');
    expect(parse('')).toEqual([{ type: 'paragraph', content: [] }]);
  });

  test('an empty list item writes &nbsp; after its marker, which survives nesting', () => {
    const blocks = [li('bullet', 0, run('a')), li('bullet', 1), li('bullet', 2, run('c'))];
    expect(md(...blocks)).toBe('- a\n  - &nbsp;\n    - c');
    roundTrip(...blocks);
  });

  test('an empty heading and an empty quote keep their bare marker', () => {
    const blocks: Block[] = [
      { id: '', type: 'heading', level: 2, content: [] },
      { id: '', type: 'quote', content: [] },
    ];
    expect(md(...blocks)).toBe('##\n\n>');
    roundTrip(...blocks);
  });
});

describe('quotes (D4)', () => {
  test('consecutive quote blocks are one quote, paragraphs apart', () => {
    const blocks: Block[] = [
      { id: '', type: 'quote', content: [run('a')] },
      { id: '', type: 'quote', content: [] },
      { id: '', type: 'quote', content: [run('b')] },
    ];
    expect(md(...blocks)).toBe('> a\n>\n> &nbsp;\n>\n> b');
    roundTrip(...blocks);
  });

  test('a quote of several paragraphs reads as consecutive quote blocks', () => {
    expect(parse('> a\n> still a\n>\n> b')).toEqual([
      { type: 'quote', content: [run('a still a')] },
      { type: 'quote', content: [run('b')] },
    ]);
  });
});

describe('block separation', () => {
  test('a divider after a paragraph stays a divider, not a setext heading', () => {
    const blocks: Block[] = [p(run('a')), { id: '', type: 'divider' }];
    expect(md(...blocks)).toBe('a\n\n---');
    roundTrip(...blocks);
  });

  test('consecutive list items have no blank line between them, so the list stays tight', () => {
    expect(md(li('bullet', 0, run('a')), li('bullet', 0, run('b')))).toBe('- a\n- b');
  });

  test('every other pair of blocks is separated by a blank line', () => {
    expect(md(p(run('a')), p(run('b')), li('bullet', 0, run('c')), p(run('d')))).toBe(
      'a\n\nb\n\n- c\n\nd',
    );
  });
});

describe('lists', () => {
  test('a nested item is indented to the content column of its parent marker', () => {
    const blocks = [
      li('ordered', 0, run('a')),
      li('bullet', 1, run('b')),
      li('ordered', 2, run('c')),
    ];
    expect(md(...blocks)).toBe('1. a\n   - b\n     1. c');
    roundTrip(...blocks);
  });

  test('the indent follows a wider marker', () => {
    const ten = Array.from({ length: 10 }, () => li('ordered', 0, run('x')));
    expect(
      md(...ten, li('bullet', 1, run('y')))
        .split('\n')
        .slice(-2),
    ).toEqual(['10. x', '    - y']);
  });

  test('a bullet at the same depth restarts the ordered count; a deeper one does not', () => {
    expect(
      md(
        li('ordered', 0, run('a')),
        li('bullet', 1, run('b')),
        li('ordered', 0, run('c')),
        li('bullet', 0, run('d')),
        li('ordered', 0, run('e')),
      ),
    ).toBe('1. a\n   - b\n2. c\n- d\n1. e');
  });
});

describe('marks', () => {
  test('whitespace at the edge of bold, italic and strike moves outside the delimiters', () => {
    expect(md(p(run('굵게 ', 'bold'), run('다')))).toBe('**굵게** 다');
    expect(md(p(run('a'), run(' 기울임', 'italic')))).toBe('a *기울임*');
  });

  test('canonical drops the mark only from whitespace at the edge of the marked stretch', () => {
    // The space after 굵게 is inside the bold stretch, and the stretch ends in
    // code, whose spaces stay: only the leading space loses bold.
    const doc: Doc = { blocks: [p(run(' 굵게 ', 'bold'), run(' 코드 ', 'bold', 'code'))] };
    expect(canonical(doc).blocks[0]).toEqual(
      p(run(' '), run('굵게 ', 'bold'), run(' 코드 ', 'bold', 'code')),
    );
  });

  test('code keeps its spaces and backticks, padded the way CommonMark expects', () => {
    expect(md(p(run(' a ', 'code')))).toBe('`  a  `');
    // A block of only whitespace is empty, code or not.
    expect(md(p(run('  ', 'code')))).toBe('');
    expect(md(p(run('a`b', 'code')))).toBe('``a`b``');
    expect(md(p(run('`a', 'code')))).toBe('`` `a ``');
    roundTrip(p(run(' a ', 'code')), p(run('`a', 'code')), p(run('a``b', 'code')));
  });

  test('marks nest in a fixed order and share delimiters where CommonMark allows', () => {
    expect(md(p(run('a', 'bold', 'italic')))).toBe('***a***');
    // The mark that goes on longer encloses the other, so neither is split.
    expect(md(p(run('a', 'strike', 'bold'), run('b', 'bold')))).toBe('**~~a~~b**');
    roundTrip(p(run('a', 'bold'), run('b', 'bold', 'italic'), run(' c', 'bold')));
  });
});

describe('flanking, without HTML (D3)', () => {
  // A closing `**` between punctuation and a letter does not close in
  // CommonMark, which Korean particles hit all the time. The character next to
  // the delimiter, outside the span, is written as a numeric reference, which
  // counts as punctuation.
  test('bold ending in punctuation before a Korean particle references the particle', () => {
    const blocks = [p(run('"인용"', 'bold'), run('은 '), run('굵게', 'bold'), run('는'))];
    expect(md(...blocks)).toBe('**"인용"**&#51008; **굵게**는');
    roundTrip(...blocks);
  });

  test('an opener between a letter and punctuation references the letter', () => {
    const blocks = [p(run('a'), run('(b)', 'strike'))];
    expect(md(...blocks)).toBe('&#97;~~(b)~~');
    roundTrip(...blocks);
    expect(md(p(run('(a)', 'italic'), run('b')))).toBe('*(a)*&#98;');
  });

  test('both code-unit and code-point readings must agree', () => {
    // micromark reads the low surrogate before the closer as a letter, so it
    // would close; CommonMark 0.31 reads 😀 as a symbol, so it would not.
    const blocks = [p(run('a😀', 'italic'), run('b'))];
    expect(md(...blocks)).toBe('*a😀*&#98;');
    roundTrip(...blocks);
  });

  test('an opener that would run into the closer before it takes the other delimiter', () => {
    const blocks = [p(run('a', 'italic'), run('b', 'bold'))];
    expect(md(...blocks)).toBe('*a*__b__');
    roundTrip(...blocks);
  });

  test('_ follows its stricter rules: a letter next to it is referenced', () => {
    const blocks = [p(run('x'), run('a', 'italic'), run('b', 'bold'), run('y'))];
    expect(md(...blocks)).toBe('x*a*__b__&#121;');
    roundTrip(...blocks);
  });

  test('nothing is written as HTML', () => {
    const blocks = [p(run('"a"', 'strike', 'bold', 'italic'), run('가'))];
    expect(md(...blocks)).not.toMatch(/<\/?(?:strong|em|s|del)>/);
    roundTrip(...blocks);
  });
});

describe('escaping', () => {
  test('block syntax at the start of a line is escaped', () => {
    expect(md(p(run('# 아님')))).toBe('\\# 아님');
    expect(md(p(run('> 아님')))).toBe('\\> 아님');
    expect(md(p(run('- 아님')))).toBe('\\- 아님');
    expect(md(p(run('+ 아님')))).toBe('\\+ 아님');
    expect(md(p(run('12. 아님')))).toBe('12\\. 아님');
    expect(md(p(run('---')))).toBe('\\---');
    expect(md(li('bullet', 0, run('1) 아님')))).toBe('- 1\\) 아님');
  });

  test('inline syntax is escaped anywhere', () => {
    expect(md(p(run('a*b_c`d~e[f]<g>\\h &amp; & i')))).toBe(
      'a\\*b\\_c\\`d\\~e\\[f\\]\\<g>\\\\h \\&amp; & i',
    );
  });

  test('leading and trailing spaces survive as character references', () => {
    const blocks = [p(run('    들여쓰기 아님 '))];
    expect(md(...blocks)).toBe('&#32;   들여쓰기 아님&#32;');
    roundTrip(...blocks);
  });

  test("a heading's trailing # is not read as a closing sequence", () => {
    const blocks: Block[] = [{ id: '', type: 'heading', level: 1, content: [run('C #')] }];
    expect(md(...blocks)).toBe('# C \\#');
    roundTrip(...blocks);
  });
});

const atom = (source: string, ...marks: Mark[]): Inline => ({ type: 'raw', source, marks });

describe('links, atoms and raw blocks', () => {
  test('a link becomes a link mark around its text, which may carry other marks', () => {
    const link: Mark = { type: 'link', href: 'https://x.dev', title: '제목' };
    expect(parse('[링크 **굵게**](https://x.dev "제목")')).toEqual([
      { type: 'paragraph', content: [run('링크 ', link), run('굵게', link, 'bold')] },
    ]);
  });

  test('an autolink is a link whose text is its address', () => {
    const link: Mark = { type: 'link', href: 'https://x.dev' };
    expect(parse('<https://x.dev>')).toEqual([
      { type: 'paragraph', content: [run('https://x.dev', link)] },
    ]);
  });

  test('addresses that need it are written in angle brackets, and read back exactly', () => {
    const odd: Mark = { type: 'link', href: 'a b(c)\\&amp;<d>\ne', title: 'say "hi"' };
    const blocks = [p(run('x', odd))];
    expect(md(...blocks)).toBe('[x](<a b(c)\\\\\\&amp;\\<d\\>&#10;e> "say \\"hi\\"")');
    roundTrip(...blocks);
  });

  test('a ! right before a link is escaped, so the link does not become an image', () => {
    const blocks = [p(run('!'), run('a', { type: 'link', href: 'x' }))];
    expect(md(...blocks)).toBe('\\![a](x)');
    roundTrip(...blocks);
  });

  test("a reference link becomes a link mark with its definition's address; the definition stays raw", () => {
    const link: Mark = { type: 'link', href: 'https://x.dev', title: 't' };
    expect(
      parse('[문서][Ref] 와 [ref]\n\n[REF]: https://x.dev "t"\n[ref]: https://ignored'),
    ).toEqual([
      { type: 'paragraph', content: [run('문서', link), run(' 와 '), run('ref', link)] },
      { type: 'raw', source: '[REF]: https://x.dev "t"' },
      { type: 'raw', source: '[ref]: https://ignored' },
    ]);
  });

  test('an image is an atom holding its source, inside a link if there is one', () => {
    const link: Mark = { type: 'link', href: 'https://npm.im/x' };
    expect(parse('[![npm](badge.svg)](https://npm.im/x) 끝')).toEqual([
      { type: 'paragraph', content: [atom('![npm](badge.svg)', link), run(' 끝')] },
    ]);
  });

  test('inline HTML other than the mark tags is an atom per tag', () => {
    expect(parse('<kbd>Enter</kbd> 키')).toEqual([
      { type: 'paragraph', content: [atom('<kbd>'), run('Enter'), atom('</kbd>'), run(' 키')] },
    ]);
  });

  test('a code block at the top level is a raw block holding its source, written back as is', () => {
    const source = '```js\nconst a = 1;\n\nb()\n```';
    expect(parse(`${source}\n\n끝`)).toEqual([
      { type: 'raw', source },
      { type: 'paragraph', content: [run('끝')] },
    ]);
    expect(md({ id: '', type: 'raw', source }, p(run('끝')))).toBe(`${source}\n\n끝`);
  });

  test('an HTML block at the top level is a raw block', () => {
    const source = '<div align="center">\n<b>hi</b>\n</div>';
    expect(parse(source)).toEqual([{ type: 'raw', source }]);
  });

  test('a quote or a list the model cannot represent is kept whole as a raw block', () => {
    expect(parse('> ```\n> a\n> ```')).toEqual([{ type: 'raw', source: '> ```\n> a\n> ```' }]);
  });

  test('an indented code block becomes fenced, and an open fence is closed', () => {
    expect(parse('    a\n\n```js\nb')).toEqual([
      { type: 'raw', source: '```\na\n```' },
      { type: 'raw', source: '```js\nb\n```' },
    ]);
  });

  test("a one-line HTML block at the head of a list item is the item's atom", () => {
    expect(parse('- <kbd>\n- b')).toEqual([
      { type: 'bullet', indent: 0, content: [atom('<kbd>')] },
      { type: 'bullet', indent: 0, content: [run('b')] },
    ]);
  });

  test('a line that would start an HTML block is not left as that block', () => {
    // As a paragraph or quote it becomes raw; as a list item, one atom.
    const blocks: Block[] = [
      { id: '', type: 'paragraph', content: [atom('<div>'), run('x')] },
      { id: '', type: 'bullet', indent: 0, content: [atom('<!-- c -->'), run(' y')] },
    ];
    expect(canonical({ blocks }).blocks).toEqual([
      { id: '', type: 'raw', source: '<div>x' },
      { id: '', type: 'bullet', indent: 0, content: [atom('<!-- c --> y')] },
    ]);
  });

  test('a list right next to a raw list takes another marker, so the two stay apart', () => {
    const blocks: Block[] = [
      { id: '', type: 'raw', source: '- [ ] task' },
      li('bullet', 0, run('a')),
      { id: '', type: 'raw', source: '* [ ] other' },
    ];
    expect(md(...blocks)).toBe('- [ ] task\n\n+ a\n\n* [ ] other');
    roundTrip(...blocks);
  });

  test('two raw blocks markdown reads as one become one', () => {
    const blocks: Block[] = [
      { id: '', type: 'raw', source: '- [ ] a' },
      { id: '', type: 'raw', source: '- [ ] b' },
    ];
    expect(canonical({ blocks }).blocks).toEqual([
      { id: '', type: 'raw', source: '- [ ] a\n\n- [ ] b' },
    ]);
  });

  test('the code mark is dropped where a link at the start of a line would read as a definition', () => {
    const link: Mark = { type: 'link', href: 'x' };
    const blocks = [p(run(']:a', link, 'code'))];
    expect(md(...blocks)).toBe('[\\]:a](x)');
    expect(canonical({ blocks }).blocks).toEqual([p(run(']:a', link))]);
  });
});

describe('ordered list start numbers', () => {
  test('the first item of a run keeps its start number', () => {
    expect(parse('3. a\n4. b')).toEqual([
      { type: 'ordered', indent: 0, start: 3, content: [run('a')] },
      { type: 'ordered', indent: 0, content: [run('b')] },
    ]);
  });

  test('items count on from the start number', () => {
    const blocks: Block[] = [
      { id: '', type: 'ordered', indent: 0, start: 7, content: [run('a')] },
      { id: '', type: 'ordered', indent: 0, content: [run('b')] },
    ];
    expect(md(...blocks)).toBe('7. a\n8. b');
    roundTrip(...blocks);
  });

  test('a run that starts at another number gets a blank line after item text, since only 1. may interrupt it', () => {
    const blocks: Block[] = [
      li('bullet', 0, run('a')),
      { id: '', type: 'ordered', indent: 1, start: 3, content: [run('b')] },
      li('bullet', 0, run('c')),
      { id: '', type: 'ordered', indent: 0, start: 0, content: [run('d')] },
    ];
    expect(md(...blocks)).toBe('- a\n\n  3. b\n- c\n\n0. d');
    roundTrip(...blocks);
  });
});

describe('what the model cannot represent is kept as source (D2)', () => {
  test('an item whose HTML runs on takes in the items under it: the list is a raw block', () => {
    const atom = (source: string): Block => ({
      id: 'a',
      type: 'bullet',
      indent: 0,
      content: [{ type: 'raw', source, marks: [] }],
    });
    const child: Block = { id: 'b', type: 'bullet', indent: 1, content: [] };
    const doc = { blocks: [p(run('x')), atom('<span class="x">'), child] };
    const source = '- <span class="x">\n  - &nbsp;';
    expect(canonical(doc).blocks.slice(1)).toEqual([{ id: 'a', type: 'raw', source }]);
    expect(parse(serializeMarkdown(doc.blocks))).toEqual([
      { type: 'paragraph', content: [run('x')] },
      { type: 'raw', source },
    ]);
    // A comment closed on its line ends there, so the item under it stays an item.
    const closed = { blocks: [atom('<!-- c -->'), child] };
    expect(canonical(closed)).toEqual(closed);
  });

  test('nested containers are raw blocks, not flattened', () => {
    expect(parse('> - a\n> - b\n\n- > c')).toEqual([
      { type: 'raw', source: '> - a\n> - b' },
      { type: 'raw', source: '- > c' },
    ]);
  });

  test('headings below level 4 are raw blocks', () => {
    expect(parse('##### a\n\n###### b')).toEqual([
      { type: 'raw', source: '##### a' },
      { type: 'raw', source: '###### b' },
    ]);
  });

  test('a list nested deeper than the maximum is a raw block', () => {
    const source = '- a\n  - b\n    - c\n      - d';
    expect(parse(source)).toEqual([{ type: 'raw', source }]);
  });

  test('tables, task lists and footnotes are raw blocks', () => {
    expect(parse('| a |\n| - |\n\n- [ ] t\n\nx[^1]\n\n[^1]: n')).toEqual([
      { type: 'raw', source: '| a |\n| - |' },
      { type: 'raw', source: '- [ ] t' },
      { type: 'paragraph', content: [run('x'), atom('[^1]')] },
      { type: 'raw', source: '[^1]: n' },
    ]);
  });

  test('soft line breaks join with a space; a hard break starts a block; <br> is an atom', () => {
    expect(parse('a\nb\\\nc<br>d')).toEqual([
      { type: 'paragraph', content: [run('a b')] },
      { type: 'paragraph', content: [run('c'), atom('<br>'), run('d')] },
    ]);
  });

  test('HTML is kept as written: inline tags are atoms, comments are kept', () => {
    expect(parse('<b>굵게</b> 끝<!-- 주석 -->\n\n<!-- 블록 주석 -->')).toEqual([
      {
        type: 'paragraph',
        content: [atom('<b>'), run('굵게'), atom('</b>'), run(' 끝'), atom('<!-- 주석 -->')],
      },
      { type: 'raw', source: '<!-- 블록 주석 -->' },
    ]);
  });

  test('a block holding a mark inside the same mark is kept as source, whole', () => {
    expect(parse('x **a **b** c**\n\n- _*d*_')).toEqual([
      { type: 'raw', source: 'x **a **b** c**' },
      { type: 'raw', source: '- _*d*_' },
    ]);
  });

  test('a link without text is kept as source', () => {
    expect(parse('[](./target.md) a')).toEqual([
      { type: 'paragraph', content: [atom('[](./target.md)'), run(' a')] },
    ]);
  });
});

test('without an id function, each call numbers its blocks with a counter of its own', () => {
  const ids = (doc: { readonly blocks: readonly Block[] }) => doc.blocks.map((b) => b.id);
  expect(ids(parseMarkdown('a\n\nb\n\nc'))).toEqual(['b0', 'b1', 'b2']);
  expect(ids(parseMarkdown('a\n\nb'))).toEqual(['b0', 'b1']);
});
