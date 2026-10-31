import { describe, expect, test } from 'vitest';
import type { Block, Mark, MarkType, TextRun } from '../model';
import { serializeHtml } from '.';

/** A text run; marks without attributes are named by type, links passed whole. */
const run = (text: string, ...marks: (Exclude<MarkType, 'link'> | Mark)[]): TextRun => ({
  type: 'text',
  text,
  marks: marks.map((mark) => (typeof mark === 'string' ? { type: mark } : mark)),
});
const li = (type: 'bullet' | 'ordered', indent: number, text: string): Block => ({
  id: '',
  type,
  indent,
  content: [run(text)],
});

test('escapes text', () => {
  expect(
    serializeHtml([{ id: '', type: 'paragraph', content: [run(`<a href="x">'&'</a>`)] }]),
  ).toBe('<p>&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;</p>');
});

test('writes marks in the fixed nesting order', () => {
  expect(
    serializeHtml([
      { id: '', type: 'paragraph', content: [run('a', 'code', 'italic', 'bold', 'strike')] },
    ]),
  ).toBe('<p><s><strong><em><code>a</code></em></strong></s></p>');
});

test('writes every block type, with <br> in empty ones', () => {
  expect(
    serializeHtml([
      { id: '', type: 'heading', level: 3, content: [run('h')] },
      { id: '', type: 'quote', content: [run('q')] },
      { id: '', type: 'divider' },
      { id: '', type: 'paragraph', content: [] },
    ]),
  ).toBe('<h3>h</h3><blockquote>q</blockquote><hr><p><br></p>');
});

test('nests flat list blocks and keeps the 1 / a / i numbering by depth', () => {
  expect(
    serializeHtml([
      li('ordered', 0, '1'),
      li('ordered', 1, 'a'),
      li('ordered', 2, 'i'),
      li('bullet', 1, 'b'),
      li('ordered', 0, '2'),
    ]),
  ).toBe(
    '<ol><li>1<ol type="a"><li>a<ol type="i"><li>i</li></ol></li></ol>' +
      '<ul><li>b</li></ul></li><li>2</li></ol>',
  );
});

test('a change of list type at the same depth starts a new list', () => {
  expect(serializeHtml([li('bullet', 0, 'a'), li('ordered', 0, 'b')])).toBe(
    '<ul><li>a</li></ul><ol><li>b</li></ol>',
  );
});

test('a fragment that starts inside a nested list nests from the top', () => {
  expect(serializeHtml([li('bullet', 1, 'a'), li('bullet', 2, 'b'), li('bullet', 0, 'c')])).toBe(
    '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>',
  );
});

const raw = (source: string): Block => ({ id: '', type: 'raw', source });
const withAtom = (source: string): Block => ({
  id: '',
  type: 'paragraph',
  content: [run('a '), { type: 'raw', source, marks: [{ type: 'bold' }] }],
});

describe('source kept verbatim is rendered the way CommonMark renders it', () => {
  test.each([
    ['a table', '| a |\n| - |\n| b |', '<table>'],
    ['a task list', '- [x] done', '<input type="checkbox" disabled="" checked="" /> done'],
    ['a code block, its content escaped', '```js\n<b>\n```', '<code class="language-js">&lt;b&gt;'],
    ['a heading below level 4', '##### five', '<h5>five</h5>'],
  ])('%s', (_, source, expected) => {
    expect(serializeHtml([raw(source)])).toContain(expected);
  });

  test('an atom renders inline, inside the marks around it', () => {
    expect(serializeHtml([withAtom('![cat](cat.png "Cat")')])).toBe(
      '<p>a <strong><img src="cat.png" alt="cat" title="Cat" /></strong></p>',
    );
  });

  test('an address that could run script is dropped', () => {
    expect(serializeHtml([withAtom('![x](javascript:alert(1))')])).toBe(
      '<p>a <strong><img src="" alt="x" /></strong></p>',
    );
  });

  test('a reference resolves against a definition elsewhere in the document', () => {
    expect(serializeHtml([withAtom('![cat][c]'), raw('[c]: cat.png')])).toBe(
      '<p>a <strong><img src="cat.png" alt="cat" /></strong></p>',
    );
  });

  test('HTML in the document is escaped by default', () => {
    expect(serializeHtml([withAtom('<kbd>'), raw('<div onclick="x()">\nhi\n</div>')])).toBe(
      '<p>a <strong>&lt;kbd&gt;</strong></p>&lt;div onclick=&quot;x()&quot;&gt;\nhi\n&lt;/div&gt;',
    );
  });

  test('allowDangerousHtml writes it as it is', () => {
    expect(
      serializeHtml([withAtom('<kbd>'), raw('<div>\nhi\n</div>')], { allowDangerousHtml: true }),
    ).toBe('<p>a <strong><kbd></strong></p><div>\nhi\n</div>');
  });

  test('a footnote cannot be rendered alone and is written as text', () => {
    expect(serializeHtml([withAtom('[^1]'), raw('[^1]: <note>')])).toBe(
      '<p>a <strong>[^1]</strong></p><p>[^1]: &lt;note&gt;</p>',
    );
  });
});
