import { describe as group, expect, test } from 'vitest';
import {
  createState,
  rawRenderer,
  type Block,
  type EditorState,
  type Mark,
  type Selection,
  type TextRun,
} from '../../core/internal';
import { describe, type DomNode, type RenderContext } from '.';

const ctx = (blocks: readonly Block[], extra: Partial<RenderContext> = {}): RenderContext => ({
  classNames: {},
  placeholder: null,
  raw: rawRenderer(blocks),
  ...extra,
});

const state = (blocks: readonly Block[], selection?: Selection): EditorState => ({
  ...createState({ blocks }),
  ...(selection === undefined ? {} : { selection }),
});

/** A description as compact markup, so expectations read like the DOM. */
function markup(node: DomNode): string {
  switch (node.kind) {
    case 'text':
      return node.text;
    case 'html':
      return `{${node.html.trim()}}`;
    case 'element': {
      const attrs = Object.entries(node.attrs)
        .map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${value}"`))
        .join('');
      return `<${node.tag}${attrs}>${node.children.map(markup).join('')}</${node.tag}>`;
    }
  }
}

const drawn = (
  blocks: readonly Block[],
  extra: Partial<RenderContext> = {},
  selection?: Selection,
) => describe(state(blocks, selection), ctx(blocks, extra)).blocks.map((b) => markup(b.node));

const text = (value: string, marks: readonly Mark[] = []): TextRun => ({
  type: 'text',
  text: value,
  marks,
});

group('blocks', () => {
  test('every block type has its tag and data attributes', () => {
    expect(
      drawn([
        { id: 'a', type: 'paragraph', content: [text('p')] },
        { id: 'b', type: 'heading', level: 2, content: [text('h')] },
        { id: 'c', type: 'quote', content: [text('q')] },
        { id: 'd', type: 'bullet', indent: 1, content: [text('b')] },
        { id: 'e', type: 'ordered', indent: 0, start: 3, content: [text('o')] },
        { id: 'f', type: 'divider' },
      ]),
    ).toEqual([
      '<p data-block-id="a" data-type="paragraph">p</p>',
      '<h2 data-block-id="b" data-type="heading" data-level="2">h</h2>',
      '<blockquote data-block-id="c" data-type="quote">q</blockquote>',
      '<div data-block-id="d" data-type="bullet" data-indent="1">b</div>',
      '<div data-block-id="e" data-type="ordered" data-indent="0" style="--md-start: 3">o</div>',
      '<hr data-block-id="f" data-type="divider" contenteditable="false"></hr>',
    ]);
  });

  test('an empty block holds a <br>; an empty document shows the placeholder', () => {
    expect(drawn([{ id: 'a', type: 'paragraph', content: [] }], { placeholder: 'Write' })).toEqual([
      '<p data-block-id="a" data-type="paragraph" data-placeholder="Write" data-empty="true"><br></br></p>',
    ]);
  });

  test('a raw block shows its rendered source, not editable', () => {
    expect(drawn([{ id: 'r', type: 'raw', source: '| a |\n| - |' }])[0]).toMatch(
      /^<div data-block-id="r" data-type="raw" contenteditable="false">\{<table>/,
    );
  });

  test('a selected block is marked; a gap is part of the description', () => {
    const blocks: Block[] = [{ id: 'f', type: 'divider' }];
    expect(drawn(blocks, {}, { kind: 'block', blockId: 'f' })[0]).toContain('data-selected="true"');
    expect(describe(state(blocks, { kind: 'gap', beforeBlockId: null }), ctx(blocks)).gap).toEqual({
      beforeBlockId: null,
    });
  });
});

group('content', () => {
  test('marks nest in the fixed order, the link outermost', () => {
    const marks: Mark[] = [
      { type: 'code' },
      { type: 'bold' },
      { type: 'link', href: 'https://a.example' },
    ];
    expect(drawn([{ id: 'a', type: 'paragraph', content: [text('x', marks)] }])[0]).toBe(
      '<p data-block-id="a" data-type="paragraph"><a href="https://a.example"><strong><code>x</code></strong></a></p>',
    );
  });

  test('a link keeps its address in the model but writes it only when it is safe', () => {
    const marks: Mark[] = [{ type: 'link', href: 'javascript:alert(1)' }];
    expect(drawn([{ id: 'a', type: 'paragraph', content: [text('x', marks)] }])[0]).toBe(
      '<p data-block-id="a" data-type="paragraph"><a>x</a></p>',
    );
  });

  test('an atom is rendered inline, not editable', () => {
    expect(
      drawn([
        {
          id: 'a',
          type: 'paragraph',
          content: [{ type: 'raw', source: '![cat](cat.png)', marks: [] }],
        },
      ])[0],
    ).toBe(
      '<p data-block-id="a" data-type="paragraph"><span data-atom contenteditable="false">{<img src="cat.png" alt="cat" />}</span></p>',
    );
  });
});

group('class name slots', () => {
  test('each slot puts its class on its element, and a block records the slots it used', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'heading', level: 1, content: [text('x', [{ type: 'bold' }])] },
    ];
    const description = describe(
      state(blocks),
      ctx(blocks, { classNames: { heading1: 'h', bold: 'b', italic: 'i' } }),
    ).blocks[0];
    expect(description === undefined ? '' : markup(description.node)).toBe(
      '<h1 data-block-id="a" data-type="heading" data-level="1" class="h"><strong class="b">x</strong></h1>',
    );
    expect([...(description?.slots ?? [])]).toEqual(['heading1', 'bold']);
  });
});
