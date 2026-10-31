/**
 * Random documents for property tests. Not part of the package: only test
 * files import it.
 */
import fc from 'fast-check';
import {
  MAX_HEADING_LEVEL,
  MAX_INDENT,
  blockContent,
  contentLength,
  isHeadingLevel,
  normalizeDoc,
  type Block,
  type Doc,
  type Inline,
  type Mark,
  type Pos,
} from '.';

const MAX_BLOCKS = 8;
/** Short runs, so line breaks land next to marks and atoms often. */
const SHORT = 4;

/**
 * Characters that hit markdown syntax, both CommonMark whitespace classes
 * (stripped and not), punctuation that decides flanking, Korean (where
 * flanking bites), a surrogate pair and the NUL that canonical rewrites.
 */
export const WIDE_CHARS = [
  'a',
  'Z',
  '7',
  '가',
  '힣',
  '은',
  ' ',
  '\t',
  '\u00a0',
  '\u3000',
  '😀',
  '\0',
  '\f',
  '*',
  '_',
  '~',
  '`',
  '#',
  '>',
  '-',
  '+',
  '.',
  ')',
  '1',
  '9',
  '[',
  ']',
  '<',
  '&',
  '!',
  '\\',
  '"',
  '(',
  ';',
  '=',
  '|',
  ':',
  '/',
  "'",
  '。',
];
/** Few characters in short runs, so mark boundaries meet each other often. */
export const DENSE_CHARS = [
  'a',
  ' ',
  '*',
  '"',
  '은',
  '`',
  '~',
  '😀',
  '\u00a0',
  '.',
  '_',
  '\\',
  '#',
];

export function counter(prefix = 'id'): () => string {
  let next = 0;
  return () => `${prefix}${next++}`;
}

/** Marks without attributes. */
const PLAIN_MARKS: readonly Mark[] = [
  { type: 'strike' },
  { type: 'bold' },
  { type: 'italic' },
  { type: 'code' },
];

/**
 * Links whose addresses and titles need every kind of protection: spaces,
 * parentheses, backslashes, an entity, angle brackets, quotes, line breaks,
 * an empty address and NUL.
 */
const LINKS: readonly Mark[] = [
  { type: 'link', href: 'https://example.com/a?b=1' },
  { type: 'link', href: 'a b(c)', title: 'say "hi"' },
  { type: 'link', href: '\\x&amp;<y>' },
  { type: 'link', href: '' },
  { type: 'link', href: 'x\ny', title: 't\\' },
  { type: 'link', href: 'z\0', title: '\0' },
];

/** Image sources, which stay atoms anywhere in a line. */
const IMAGE_ATOMS: readonly string[] = ['![a](b.png)', '![x *y*](<c d> "t")'];
/** Inline HTML. Alone at the start of a block it would begin an HTML block (see the report). */
const HTML_ATOMS: readonly string[] = ['<kbd>', '</kbd>', '<span class="x">'];

/** Block sources the model keeps verbatim. */
const RAW_BLOCKS: readonly string[] = [
  '```js\nconst a = 1 * 2;\n```',
  '~~~\n- not a list\n\n  indented\n~~~',
  '<div align="center">\n<b>hi</b>\n</div>',
  '- [ ] task\n- [x] done',
  '1) [ ] numbered task',
  '> > nested quote',
  '<!-- note -->',
  '| a | b |\n| --- | --- |\n| 1 | 2 |',
  '##### five',
];

export type Shapes = {
  /** Atom sources to draw from; none when empty. */
  readonly atoms?: readonly string[];
  /** Raw block sources to draw from; none when empty. */
  readonly raw?: readonly string[];
  /** Line breaks inside text, which only outside input may hold. */
  readonly lineBreaks?: boolean;
};

const DEFAULT_SHAPES: Required<Shapes> = {
  atoms: [...IMAGE_ATOMS, ...HTML_ATOMS],
  raw: RAW_BLOCKS,
  lineBreaks: false,
};

/** Blocks with empty ids, in any shape the types allow (lists may be orphaned). */
export function blocks(
  chars: readonly string[],
  maxRunLength: number,
  maxRuns: number,
  maxBlocks = MAX_BLOCKS,
  shapes: Shapes = {},
): fc.Arbitrary<Block[]> {
  const { atoms, raw, lineBreaks } = { ...DEFAULT_SHAPES, ...shapes };
  const text = fc
    .array(fc.constantFrom(...chars, ...(lineBreaks ? ['\n', '\r\n'] : [])), {
      minLength: 1,
      maxLength: maxRunLength,
    })
    .map((parts) => parts.join(''));
  const marks = fc
    .tuple(fc.subarray([...PLAIN_MARKS]), fc.option(fc.constantFrom(...LINKS), { nil: undefined }))
    .map(([plain, link]) => (link === undefined ? plain : [link, ...plain]));
  const inline: fc.Arbitrary<Inline> =
    atoms.length === 0
      ? fc.record({ type: fc.constant('text' as const), text, marks })
      : fc.oneof(
          { weight: 4, arbitrary: fc.record({ type: fc.constant('text' as const), text, marks }) },
          fc.record({
            type: fc.constant('raw' as const),
            source: fc.constantFrom(...atoms),
            marks,
          }),
        );
  const content = fc.array(inline, { maxLength: maxRuns });
  const blockShapes: fc.Arbitrary<Block>[] = [
    content.map((c) => ({ id: '', type: 'paragraph' as const, content: c })),
    fc.record({
      id: fc.constant(''),
      type: fc.constant('heading' as const),
      level: fc.integer({ min: 1, max: MAX_HEADING_LEVEL }).filter(isHeadingLevel),
      content,
    }),
    content.map((c) => ({ id: '', type: 'quote' as const, content: c })),
    fc.record({
      id: fc.constant(''),
      type: fc.constant('bullet' as const),
      indent: fc.integer({ min: 0, max: MAX_INDENT }),
      content,
    }),
    fc.record(
      {
        id: fc.constant(''),
        type: fc.constant('ordered' as const),
        indent: fc.integer({ min: 0, max: MAX_INDENT }),
        start: fc.integer({ min: 0, max: 12 }),
        content,
      },
      { requiredKeys: ['id', 'type', 'indent', 'content'] },
    ),
    fc.constant({ id: '', type: 'divider' as const }),
  ];
  if (raw.length > 0) {
    blockShapes.push(
      fc.record({
        id: fc.constant(''),
        type: fc.constant('raw' as const),
        source: fc.constantFrom(...raw),
      }),
    );
  }
  return fc.array(fc.oneof(...blockShapes), { minLength: 1, maxLength: maxBlocks });
}

/** Blocks as outside input may bring them: ids from a small pool, so some repeat or are empty. */
export function untrustedBlocks(chars: readonly string[]): fc.Arbitrary<Block[]> {
  return fc
    .tuple(
      blocks(chars, SHORT, SHORT, MAX_BLOCKS, { lineBreaks: true }),
      fc.array(fc.constantFrom('', 'a', 'b', 'c'), {
        minLength: MAX_BLOCKS,
        maxLength: MAX_BLOCKS,
      }),
    )
    .map(([list, ids]) => list.map((block, index) => ({ ...block, id: ids[index] ?? '' })));
}

/** Normalized documents with unique ids. */
export function docs(
  chars: readonly string[],
  maxRunLength: number,
  maxRuns: number,
  maxBlocks = MAX_BLOCKS,
  shapes: Shapes = {},
): fc.Arbitrary<Doc> {
  return blocks(chars, maxRunLength, maxRuns, maxBlocks, shapes).map((list) => {
    const id = counter();
    return normalizeDoc({ blocks: list.map((b) => ({ ...b, id: id() })) }, id);
  });
}

/** Every position in a document. */
export function positions(doc: Doc): Pos[] {
  return doc.blocks.flatMap((block) => {
    const length = contentLength(blockContent(block) ?? []);
    return Array.from({ length: length + 1 }, (_, offset) => ({ blockId: block.id, offset }));
  });
}

export function withoutIds(doc: Doc): Record<string, unknown>[] {
  return doc.blocks.map((b) =>
    Object.fromEntries(Object.entries(b).filter(([key]) => key !== 'id')),
  );
}
