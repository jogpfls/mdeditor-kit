import { assertNever } from '../lang';
import {
  isListBlock,
  listNumbers,
  normalizeContent,
  sameMark,
  withContent,
  withMarks,
  type Block,
  type Doc,
  type Inline,
  type ListBlock,
  type TextBlock,
  type Mark,
} from '../model';
import { serializeInline, trimMarkEdges, type LineContext } from './inline';
import { parseMarkdown } from './parse';
import {
  EMPTY_TEXT,
  MARKDOWN_SYNTAX,
  headingMarker,
  startsHtmlBlock,
  startsOpenHtmlBlock,
} from './syntax';

const PLAIN: LineContext = { heading: false };
const HEADING: LineContext = { heading: true };

/** CommonMark replaces NUL with U+FFFD wherever it appears. */
const NUL = '\0';
const REPLACEMENT = '�';

/**
 * Maps a document onto the part of the model that markdown can express:
 *
 * - bold, italic and strike are removed from whitespace at the edges of what
 *   they mark, since `**bold **` is not bold;
 * - NUL becomes U+FFFD, as CommonMark requires, in text, link addresses and
 *   titles, atoms and raw blocks;
 * - in a block that starts with a link, code inside that link loses its mark
 *   when its `]` is directly followed by `:` (see `avoidDefinition`);
 * - a block whose text is only whitespace (U+00A0 included) and holds no
 *   atom is empty, since that is how an empty block is written;
 * - a paragraph, quote or list item whose line would start an HTML block
 *   becomes a raw block, or for a list item one atom (see `htmlLineBlock`);
 * - adjacent raw blocks that markdown reads as one become one (see
 *   `mergedRaws`).
 *
 * Serializing a document and its canonical form gives the same markdown.
 */
export function canonical(doc: Doc): Doc {
  return { blocks: mergedRaws(swallowedLists(doc.blocks.map(canonicalBlock))) };
}

/**
 * A list item whose line starts an HTML block that runs on to the next line
 * (`<span class="x">` alone, `<div>`) takes in the items nested under it: in
 * markdown they are part of that HTML block, not items. The model cannot
 * hold that, so the whole list becomes what markdown reads it as, a raw
 * block. The blocks of the list lend their ids, in order, to what replaces
 * them.
 */
function swallowedLists(blocks: readonly Block[]): readonly Block[] {
  const result: Block[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) break;
    if (!isListBlock(block)) {
      result.push(block);
      index += 1;
      continue;
    }
    let end = index;
    while (end < blocks.length && isList(blocks[end])) end += 1;
    const run = blocks.slice(index, end);
    if (run.some((item, i) => swallowsNext(item, run[i + 1]))) {
      let fresh = 0;
      const read = parseMarkdown(writeBlocks(blocks, index, end), () => `${block.id}-${fresh++}`);
      result.push(...read.blocks.map((parsed, i) => ({ ...parsed, id: run[i]?.id ?? parsed.id })));
    } else {
      result.push(...run);
    }
    index = end;
  }
  return result;
}

/** Whether a list item's line starts an HTML block that takes in the item nested under it. */
function swallowsNext(item: Block, next: Block | undefined): boolean {
  if (!isListBlock(item) || next === undefined || !isListBlock(next)) return false;
  if (next.indent <= item.indent) return false;
  const [only, ...rest] = item.content;
  return only?.type === 'raw' && rest.length === 0 && startsOpenHtmlBlock(only.source);
}

/**
 * Adjacent raw blocks that markdown reads as one (two task lists with the
 * same marker, say) become one raw block, holding what is written for both.
 * Parsing only reads them as two when they are two, so only blocks placed
 * next to each other by editing merge.
 */
function mergedRaws(blocks: readonly Block[]): readonly Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (previous?.type === 'raw' && block.type === 'raw') {
      const source = `${previous.source}\n\n${block.source}`;
      let next = 0;
      const read = parseMarkdown(source, () => `raw${next++}`).blocks;
      if (read.length === 1 && read[0]?.type === 'raw') {
        merged[merged.length - 1] = { ...previous, source: read[0].source };
        continue;
      }
    }
    merged.push(block);
  }
  return merged;
}

function canonicalBlock(block: Block): Block {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
    case 'bullet':
    case 'ordered':
      return htmlLineBlock(
        withContent(
          block,
          // Trimming last: dropping a code mark can leave whitespace at a mark's edge.
          emptyIfBlank(trimMarkEdges(avoidDefinition(block.content.map(canonicalInline)))),
        ),
      );
    case 'raw':
      return { ...block, source: withoutNul(block.source) };
    case 'divider':
      return block;
    default:
      return assertNever(block);
  }
}

/**
 * A text block whose markdown line would start an HTML block (it begins with
 * inline HTML such as `<div>` or a lone `<kbd>`) cannot be written as that
 * block: a paragraph or a quote becomes a raw block holding the line, and a
 * list item holds the whole line as one atom, which renders the same in a
 * tight list. A heading's line never starts an HTML block.
 */
function htmlLineBlock(block: TextBlock): Block {
  const [first] = block.content;
  if (first?.type !== 'raw') return block;
  const line = serializeInline(block.content, PLAIN);
  if (!startsHtmlBlock(line)) return block;
  switch (block.type) {
    case 'paragraph':
      return { id: block.id, type: 'raw', source: line };
    case 'quote':
      return { id: block.id, type: 'raw', source: `${MARKDOWN_SYNTAX.quote.marker} ${line}` };
    case 'bullet':
    case 'ordered':
      return withContent(block, [{ type: 'raw', source: line, marks: [] }]);
    case 'heading':
      return block;
    default:
      return assertNever(block);
  }
}

function canonicalInline(inline: Inline): Inline {
  const marks = inline.marks.map(canonicalMark);
  switch (inline.type) {
    case 'text':
      return { ...inline, text: withoutNul(inline.text), marks };
    case 'raw':
      return { ...inline, source: withoutNul(inline.source), marks };
    default:
      return assertNever(inline);
  }
}

function canonicalMark(mark: Mark): Mark {
  switch (mark.type) {
    case 'link':
      return mark.title === undefined
        ? { type: 'link', href: withoutNul(mark.href) }
        : { type: 'link', href: withoutNul(mark.href), title: withoutNul(mark.title) };
    case 'strike':
    case 'bold':
    case 'italic':
    case 'code':
      return mark;
    default:
      return assertNever(mark);
  }
}

/**
 * A line that starts with a link reads as a link reference definition when
 * the label CommonMark scans, up to the first unescaped `]`, is followed by
 * `:` (`` [`]:a`](x) `` defines the label `` ` ``). Text escapes its `]`, but
 * a code span cannot, so code holding that first `]` before a `:` loses its
 * code mark and is written as escaped text instead. Repeats until the first
 * unescaped `]` is safe.
 */
function avoidDefinition(content: readonly Inline[]): readonly Inline[] {
  const link = content[0]?.marks.find((mark) => mark.type === 'link');
  if (link === undefined) return content;
  let result = content;
  for (;;) {
    const hit = firstLabelEnd(result, link);
    if (hit === null || !hit.colonAfter || hit.inline.type !== 'text') return result;
    const target = hit.inline;
    result = normalizeContent(
      result.map((inline) =>
        inline === target
          ? withMarks(
              inline,
              inline.marks.filter((m) => m.type !== 'code'),
            )
          : inline,
      ),
    );
  }
}

/** The inline holding the first `]` that is not escaped inside the leading link, and what follows it. */
function firstLabelEnd(
  content: readonly Inline[],
  link: Mark,
): { readonly inline: Inline; readonly colonAfter: boolean } | null {
  const inLink = content.filter((_, index) =>
    content.slice(0, index + 1).every((each) => each.marks.some((mark) => sameMark(mark, link))),
  );
  for (const [index, inline] of inLink.entries()) {
    const verbatim = verbatimOutput(inline);
    const at = verbatim?.indexOf(']') ?? -1;
    if (verbatim === null || at === -1) continue;
    const within = verbatim.charAt(at + 1);
    const next = within === '' ? firstChar(inLink[index + 1]) : within;
    return { inline, colonAfter: next === ':' };
  }
  return null;
}

/** What an inline writes without escaping: code text and atom source. Plain text is escaped. */
function verbatimOutput(inline: Inline): string | null {
  switch (inline.type) {
    case 'text':
      return inline.marks.some((mark) => mark.type === 'code') ? inline.text : null;
    case 'raw':
      return inline.source;
    default:
      return assertNever(inline);
  }
}

function firstChar(inline: Inline | undefined): string {
  if (inline === undefined) return '';
  switch (inline.type) {
    case 'text':
      return inline.text.slice(0, 1);
    case 'raw':
      return inline.source.slice(0, 1);
    default:
      return assertNever(inline);
  }
}

const BLANK = /^\s*$/u;

function emptyIfBlank(content: readonly Inline[]): readonly Inline[] {
  const blank = content.every((piece) => piece.type === 'text' && BLANK.test(piece.text));
  return blank ? [] : content;
}

function withoutNul(value: string): string {
  return value.replaceAll(NUL, REPLACEMENT);
}

/**
 * Writes blocks as CommonMark with GFM strikethrough.
 *
 * Consecutive list items are separated by a single line break so the list
 * stays tight. Consecutive quote blocks are one quote, their paragraphs
 * separated by a line holding only `>` (decision D4). Every other pair of
 * blocks gets a blank line, which keeps lines from merging into one paragraph
 * and `---` from turning the paragraph above it into a setext heading. The
 * exception is an ordered run that starts at a number other than 1 right
 * after another item: CommonMark only lets `1.` interrupt the item's text, so
 * a blank line goes before it. An empty block is written with `&nbsp;` (see
 * `EMPTY_TEXT`). A document that is a single empty paragraph is the empty
 * string. Raw blocks are written as they are.
 */
export function serializeMarkdown(blocks: readonly Block[]): string {
  const written = canonical({ blocks }).blocks;
  const [only] = written;
  if (written.length === 1 && only?.type === 'paragraph' && only.content.length === 0) return '';
  return writeBlocks(written, 0, written.length);
}

/**
 * Writes the blocks `[from, to)` of a document already in canonical form,
 * where `from` starts the document or follows a block that is not a list
 * item. The blocks around the range still count: they decide the markers a
 * list may use.
 */
function writeBlocks(written: readonly Block[], from: number, to: number): string {
  const numbers = listNumbers(written);
  const lists = new ListLayout();
  let avoid = NOTHING;
  let markdown = '';
  for (let index = from; index < to; index += 1) {
    const block = written[index];
    if (block === undefined) break;
    const previous = index > from ? written[index - 1] : undefined;
    const next = written[index + 1];
    if (isList(block) && !isList(previous)) avoid = neighbourMarkers(written, index);
    const inQuote =
      block.type === 'quote' && (previous?.type === 'quote' || next?.type === 'quote');
    const line = serializeBlock(block, { number: numbers[index] ?? null, lists, avoid, inQuote });
    markdown += previous === undefined ? line : separator(previous, block) + line;
  }
  return markdown;
}

/** What goes between two consecutive blocks. */
function separator(previous: Block, block: Block): string {
  if (previous.type === 'quote' && block.type === 'quote') {
    return `\n${MARKDOWN_SYNTAX.quote.marker}\n`;
  }
  const tight = isListBlock(previous) && isListBlock(block) && !hasStart(block);
  return tight ? '\n' : '\n\n';
}

/**
 * Whether an item starts an ordered run at a number other than 1. Only the
 * first item of a run keeps a start number, and never 1 (see `listRepairs`).
 */
function hasStart(block: ListBlock): boolean {
  switch (block.type) {
    case 'bullet':
      return false;
    case 'ordered':
      return block.start !== undefined;
    default:
      return assertNever(block);
  }
}

/** What a block's markdown depends on besides the block. */
type Surroundings = {
  /** The number an ordered item shows. */
  readonly number: number | null;
  readonly lists: ListLayout;
  /** Marker characters the current list run must not use (see `neighbourMarkers`). */
  readonly avoid: ReadonlySet<string>;
  /** The quote block is one paragraph of a longer quote, where an empty one needs `&nbsp;`. */
  readonly inQuote: boolean;
};

/** One block's markdown. */
function serializeBlock(block: Block, { number, lists, avoid, inQuote }: Surroundings): string {
  switch (block.type) {
    case 'paragraph':
      lists.reset();
      return inlineOr(block.content, PLAIN, EMPTY_TEXT);
    case 'heading':
      lists.reset();
      return withMarker(headingMarker(block.level), block.content, HEADING);
    case 'quote':
      lists.reset();
      return inQuote && block.content.length === 0
        ? `${MARKDOWN_SYNTAX.quote.marker} ${EMPTY_TEXT}`
        : withMarker(MARKDOWN_SYNTAX.quote.marker, block.content, PLAIN);
    case 'bullet':
    case 'ordered':
      return lists.prefix(block, number, avoid) + inlineOr(block.content, PLAIN, EMPTY_TEXT);
    case 'divider':
      lists.reset();
      return MARKDOWN_SYNTAX.divider.written;
    case 'raw':
      lists.reset();
      return block.source;
    default:
      return assertNever(block);
  }
}

function inlineOr(content: readonly Inline[], context: LineContext, empty: string): string {
  return content.length === 0 ? empty : serializeInline(content, context);
}

/** A marker followed by the content, or the bare marker when there is none. */
function withMarker(marker: string, content: readonly Inline[], context: LineContext): string {
  return content.length === 0 ? marker : `${marker} ${serializeInline(content, context)}`;
}

/**
 * Tracks list indentation while serializing. A nested item is indented to the
 * content column of its parent (two spaces under `- `, three under `1. `).
 * The numbers come from `listNumbers`, which follows the editor's numbering.
 */
class ListLayout {
  #columns: number[] = [];

  reset(): void {
    this.#columns = [];
  }

  /** The prefix of an item; a top-level item avoids the marker characters in `avoid`. */
  prefix(block: ListBlock, number: number | null, avoid: ReadonlySet<string>): string {
    const depth = block.indent;
    const indent = ' '.repeat(this.#columns[depth - 1] ?? 0);
    const marker = listMarker(block, number, depth === 0 ? avoid : NOTHING);
    this.#columns.length = depth;
    this.#columns[depth] = indent.length + marker.length;
    return indent + marker;
  }
}

const NOTHING: ReadonlySet<string> = new Set();

const LIST_ITEM_LINE = /^ {0,3}(?:([-*+])|\d{1,9}([.)]))(?:[ \t]|$)/;

/**
 * The marker characters a list run must not use: those of a raw block right
 * before it that ends in a list item, or right after it that starts with one
 * (a task list kept as source). With the same character, CommonMark would
 * read the two as one list.
 */
function neighbourMarkers(blocks: readonly Block[], index: number): ReadonlySet<string> {
  let end = index;
  while (end < blocks.length && isList(blocks[end])) end += 1;
  const before = blocks[index - 1];
  const after = blocks[end];
  return new Set(
    [
      before?.type === 'raw' ? listMarkerOf(before.source, 'last') : null,
      after?.type === 'raw' ? listMarkerOf(after.source, 'first') : null,
    ].filter((marker) => marker !== null),
  );
}

function isList(block: Block | undefined): boolean {
  return block !== undefined && isListBlock(block);
}

/** The marker character (`-`, `*`, `+`, `.` or `)`) of the first or last top-level item line. */
function listMarkerOf(source: string, which: 'first' | 'last'): string | null {
  const lines = source.split(/\r\n|\r|\n/);
  for (const line of which === 'first' ? lines : lines.reverse()) {
    const match = LIST_ITEM_LINE.exec(line);
    if (match !== null) return match[1] ?? match[2] ?? null;
  }
  return null;
}

function listMarker(block: ListBlock, number: number | null, avoid: ReadonlySet<string>): string {
  switch (block.type) {
    case 'bullet': {
      const { markers, written } = MARKDOWN_SYNTAX.bullet;
      return `${[written, ...markers].find((m) => !avoid.has(m)) ?? written} `;
    }
    case 'ordered': {
      const { delimiters, written } = MARKDOWN_SYNTAX.ordered;
      return `${number ?? 1}${[written, ...delimiters].find((d) => !avoid.has(d)) ?? written} `;
    }
    default:
      return assertNever(block);
  }
}
