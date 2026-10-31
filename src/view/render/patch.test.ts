import { expect, test } from 'vitest';
import {
  createState,
  rawRenderer,
  type Block,
  type EditorState,
  type Selection,
} from '../../core/internal';
import { RawSource, Renderer, type MdClassNames, type RenderContext } from '.';
import { sanitize } from './sanitize';

const p = (id: string, text: string): Block => ({
  id,
  type: 'paragraph',
  content: text === '' ? [] : [{ type: 'text', text, marks: [] }],
});

function setup() {
  const root = document.createElement('div');
  const renderer = new Renderer(root);
  const raw = new RawSource();
  const render = (
    blocks: readonly Block[],
    classNames: MdClassNames = {},
    selection?: Selection,
  ) => {
    const state: EditorState = {
      ...createState({ blocks }),
      ...(selection === undefined ? {} : { selection }),
    };
    const ctx: RenderContext = { classNames, placeholder: null, raw: raw.for(blocks) };
    renderer.render(state, ctx);
  };
  const element = (id: string) => root.querySelector(`[data-block-id="${id}"]`);
  return { root, render, element };
}

test('draws every block as a child of the root', () => {
  const { root, render } = setup();
  render([p('a', 'one'), { id: 'd', type: 'divider' }, p('b', 'two')]);
  expect(root.innerHTML).toBe(
    '<p data-block-id="a" data-type="paragraph">one</p>' +
      '<hr data-block-id="d" data-type="divider" contenteditable="false">' +
      '<p data-block-id="b" data-type="paragraph">two</p>',
  );
});

test('a block that did not change keeps its element; a changed one is redrawn in place', () => {
  const { render, element } = setup();
  const a = p('a', 'one');
  render([a, p('b', 'two')]);
  const first = element('a');
  const second = element('b');
  const firstText = first?.firstChild;
  render([a, p('b', 'three')]);
  expect(element('a')).toBe(first);
  expect(element('a')?.firstChild).toBe(firstText);
  expect(element('b')).toBe(second);
  expect(element('b')?.textContent).toBe('three');
});

test('a block whose tag changes gets a new element', () => {
  const { render, element } = setup();
  render([p('a', 'x')]);
  const before = element('a');
  render([
    { id: 'a', type: 'heading', level: 1, content: [{ type: 'text', text: 'x', marks: [] }] },
  ]);
  expect(element('a')).not.toBe(before);
  expect(element('a')?.tagName).toBe('H1');
});

test('blocks are moved, added and removed to follow the document', () => {
  const { root, render, element } = setup();
  const a = p('a', 'a');
  const b = p('b', 'b');
  const c = p('c', 'c');
  render([a, b, c]);
  const kept = [element('a'), element('c')];
  render([c, p('n', 'n'), a]);
  expect([...root.children].map((child) => child.getAttribute('data-block-id'))).toEqual([
    'c',
    'n',
    'a',
  ]);
  expect([element('a'), element('c')]).toEqual(kept);
});

test('a change of class names redraws only the blocks that use the changed slot', () => {
  const { render, element } = setup();
  const blocks = [p('a', 'x'), { id: 'h', type: 'heading', level: 1, content: [] } satisfies Block];
  render(blocks, { paragraph: 'p1', heading1: 'h' });
  const heading = element('h');
  const paragraph = element('a');
  render(blocks, { paragraph: 'p2', heading1: 'h' });
  expect(element('a')?.getAttribute('class')).toBe('p2');
  expect(element('h')).toBe(heading);
  expect(element('a')).toBe(paragraph);
});

test('a block selection marks the block, and a gap is drawn as a widget', () => {
  const { root, render, element } = setup();
  const blocks: Block[] = [{ id: 'd', type: 'divider' }];
  render(blocks, {}, { kind: 'block', blockId: 'd' });
  expect(element('d')?.getAttribute('data-selected')).toBe('true');
  render(blocks, {}, { kind: 'gap', beforeBlockId: null });
  expect(element('d')?.hasAttribute('data-selected')).toBe(false);
  expect(root.lastElementChild?.hasAttribute('data-gap')).toBe(true);
  render(blocks, {}, { kind: 'gap', beforeBlockId: 'd' });
  expect(root.firstElementChild?.hasAttribute('data-gap')).toBe(true);
  expect(root.children).toHaveLength(2);
});

test('anything the renderer did not draw is removed', () => {
  const { root, render } = setup();
  const blocks = [p('a', 'x')];
  render(blocks);
  root.appendChild(document.createElement('span'));
  render(blocks);
  expect(root.children).toHaveLength(1);
});

test('raw source renders with the definitions of the document, redrawn when they change', () => {
  const { render, element } = setup();
  const image: Block = {
    id: 'a',
    type: 'paragraph',
    content: [{ type: 'raw', source: '![cat][c]', marks: [] }],
  };
  render([image, { id: 'r', type: 'raw', source: '[c]: one.png' }]);
  expect(element('a')?.querySelector('img')?.getAttribute('src')).toBe('one.png');
  render([image, { id: 'r', type: 'raw', source: '[c]: two.png' }]);
  expect(element('a')?.querySelector('img')?.getAttribute('src')).toBe('two.png');
});

test('the raw renderer is kept while the raw blocks stay the same', () => {
  const raw = new RawSource();
  const blocks: Block[] = [{ id: 'r', type: 'raw', source: 'x' }, p('a', 'one')];
  const first = raw.for(blocks);
  expect(raw.for([blocks[0] ?? p('x', ''), p('a', 'two')])).toBe(first);
  expect(raw.for([{ id: 'r', type: 'raw', source: 'y' }])).not.toBe(first);
});

test('sanitize builds only allowed elements and attributes, and safe addresses', () => {
  const html =
    '<p onclick="x()" style="color:red">a<script>alert(1)</script><blink>b</blink></p>' +
    '<a href="javascript:alert(1)" title="t">c</a><img src="https://x.example/i.png" alt="i" onerror="x()">' +
    '<code class="language-js evil">d</code><input type="text"><input type="checkbox" checked="" disabled="">';
  const host = document.createElement('div');
  host.appendChild(sanitize(html, document));
  expect(host.innerHTML).toBe(
    '<p>ab</p><a title="t">c</a><img src="https://x.example/i.png" alt="i">' +
      '<code>d</code><input><input type="checkbox" checked="" disabled="">',
  );
});

test('the parsed copy is only read: rendering a real raw renderer output builds a table', () => {
  const host = document.createElement('div');
  host.appendChild(sanitize(rawRenderer([]).block('| a |\n| - |\n| b |') ?? '', document));
  expect(host.querySelector('td')?.textContent).toBe('b');
});
