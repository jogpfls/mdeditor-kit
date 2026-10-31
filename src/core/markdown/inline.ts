import { assertNever, escapeRegExp } from '../lang';
import { normalizeContent, sameMark, text, type Inline, type Mark, type MarkType } from '../model';
import {
  BLOCK_START_CLASS,
  INLINE_START_CLASS,
  MARKDOWN_SYNTAX,
  ORDERED_DELIMITER_CLASS,
  isDelimited,
  markSyntax,
} from './syntax';

/** Whitespace as JavaScript's `\s` sees it, a superset of both classifiers below. */
const WHITESPACE = /\s/;

/**
 * Removes delimited marks from whitespace at the edges of every span the
 * serializer would write, since `**bold **` is not bold in CommonMark. Spans
 * are taken from `buildTree`, the same nesting the serializer uses, so a mark
 * split around an overlapping one is trimmed where it is split. Whitespace in
 * a code span is kept marked: the backticks give the delimiter something to
 * flank. An atom is never whitespace. Trimming can change the nesting, so it
 * repeats until no span has whitespace at an edge.
 */
export function trimMarkEdges(content: readonly Inline[]): readonly Inline[] {
  let current = normalizeContent(content);
  for (;;) {
    const edges = whitespaceEdges(buildTree(current));
    if (edges.length === 0) return current;
    current = normalizeContent(
      current.flatMap((inline, index) =>
        withoutEdgeMarks(
          inline,
          edges.filter((edge) => edge.index === index),
        ),
      ),
    );
  }
}

/** Whitespace at the start or end of a delimited span, by the content index it is in. */
type Edge = { readonly index: number; readonly side: 'start' | 'end'; readonly type: MarkType };

function whitespaceEdges(nodes: readonly Node[]): Edge[] {
  return nodes.flatMap((node): Edge[] => {
    switch (node.kind) {
      case 'text':
      case 'code':
      case 'raw':
        return [];
      case 'span': {
        const inner = whitespaceEdges(node.children);
        if (!isDelimited(node.mark.type)) return inner;
        const first = edgeLeaf(node.children, 'start');
        const last = edgeLeaf(node.children, 'end');
        const own: Edge[] = [];
        if (first !== null && WHITESPACE.test(first.text.slice(0, 1))) {
          own.push({ index: first.index, side: 'start', type: node.mark.type });
        }
        if (last !== null && WHITESPACE.test(last.text.slice(-1))) {
          own.push({ index: last.index, side: 'end', type: node.mark.type });
        }
        return [...own, ...inner];
      }
      default:
        return assertNever(node);
    }
  });
}

/** The text leaf at the start or end of a span's content, or `null` if code or an atom is there. */
function edgeLeaf(
  nodes: readonly Node[],
  side: 'start' | 'end',
): { readonly text: string; readonly index: number } | null {
  const node = side === 'start' ? nodes[0] : nodes[nodes.length - 1];
  if (node === undefined) return null;
  switch (node.kind) {
    case 'text':
      return { text: node.text, index: node.index };
    case 'code':
    case 'raw':
      return null;
    case 'span':
      return edgeLeaf(node.children, side);
    default:
      return assertNever(node);
  }
}

/** A text run with the given marks removed from its leading or trailing whitespace. */
function withoutEdgeMarks(inline: Inline, edges: readonly Edge[]): Inline[] {
  if (edges.length === 0 || inline.type !== 'text') return [inline];
  const drop = (side: Edge['side']) =>
    edges.filter((edge) => edge.side === side).map((edge) => edge.type);
  const lead = /^\s*/u.exec(inline.text)?.[0] ?? '';
  const trail = /\s*$/u.exec(inline.text.slice(lead.length))?.[0] ?? '';
  const middle = inline.text.slice(lead.length, inline.text.length - trail.length);
  const without = (types: readonly MarkType[]) =>
    inline.marks.filter((mark) => !types.includes(mark.type));
  const startDrops = drop('start');
  const endDrops = drop('end');
  if (middle === '') return [text(inline.text, without([...startDrops, ...endDrops]))];
  return [
    text(lead, without(startDrops)),
    text(middle, inline.marks),
    text(trail, without(endDrops)),
  ];
}

// ---------------------------------------------------------------------------
// Serialization

/** A marked stretch written as a span: a delimited mark or a link. */
type Span = { readonly mark: Mark; readonly children: Node[] };
/** Leaves remember which content item they came from (`index`). */
type Node =
  | { readonly kind: 'text' | 'code'; readonly text: string; readonly index: number }
  | { readonly kind: 'raw'; readonly source: string; readonly index: number }
  | ({ readonly kind: 'span' } & Span);

/** A piece of the output line: a span's opening or closing, or a leaf. */
type Piece =
  | { readonly kind: 'open' | 'close'; readonly span: Span }
  | { readonly kind: 'leaf'; readonly leaf: 'text' | 'code' | 'raw'; readonly output: string };

/** Where the line content sits, which decides what needs escaping. */
export type LineContext = { readonly heading: boolean };

/**
 * Writes content as inline markdown, without any HTML (decision D3). The
 * content must already be canonical (see `canonical`).
 *
 * Each delimited span is written so that CommonMark reads it as written:
 *
 * - Its delimiter is the usual one, or the alternative (`_`, `__`) where the
 *   usual one would run into the closing delimiter just before it
 *   (`*a*__b__`, not `*a***b**`).
 * - Where a delimiter would not flank its text the right way, the character
 *   next to it outside the span is written as a numeric character reference,
 *   which counts as punctuation (`**"인용"**&#51008;`). Flanking must hold
 *   under every classifier in `CLASSIFIERS`, so the output reads the same in
 *   renderers that classify characters differently.
 */
export function serializeInline(content: readonly Inline[], context: LineContext): string {
  const pieces = flatten(buildTree(content));
  const outputs = pieces.map((piece, index) => initialOutput(piece, index, pieces, context));
  // Writing a character as a reference changes what a span placed earlier
  // sees next to its delimiter, so placing repeats until nothing changes.
  // References are only ever added, so this ends.
  let changed = true;
  while (changed) {
    changed = false;
    pieces.forEach((piece, index) => {
      if (piece.kind === 'open' && placeDelimiters(piece.span, index, pieces, outputs)) {
        changed = true;
      }
    });
  }
  pieces.forEach((piece, index) => {
    // `!` right before a link would turn it into an image.
    const before = pieces[index - 1];
    if (opensLink(piece) && before?.kind === 'leaf' && before.leaf === 'text') {
      outputs[index - 1] = (outputs[index - 1] ?? '').replace(/!$/, '\\!');
    }
  });
  return outputs.join('');
}

/** A piece's output before delimiters are placed: leaves are final, spans use their usual edges. */
function initialOutput(
  piece: Piece,
  index: number,
  pieces: readonly Piece[],
  context: LineContext,
): string {
  switch (piece.kind) {
    case 'open':
    case 'close':
      return spanEdge(piece.kind, piece.span, null);
    case 'leaf':
      switch (piece.leaf) {
        case 'text':
          return lineEdges(piece.output, index === 0, index === pieces.length - 1, context);
        case 'code':
        case 'raw':
          return piece.output;
        default:
          return assertNever(piece.leaf);
      }
    default:
      return assertNever(piece);
  }
}

function opensLink(piece: Piece): boolean {
  return piece.kind === 'open' && piece.span.mark.type === 'link';
}

/**
 * Decides how a delimited span opening at `open` is written, updating
 * `outputs`: which delimiter, and which neighbouring characters to write as
 * references. Links are written as they are. Returns whether it wrote a new
 * reference.
 */
function placeDelimiters(
  span: Span,
  open: number,
  pieces: readonly Piece[],
  outputs: string[],
): boolean {
  const syntax = markSyntax(span.mark.type);
  switch (syntax.kind) {
    case 'delimited':
      break;
    case 'link':
    case 'code':
      return false;
    default:
      assertNever(syntax);
  }
  const close = pieces.findIndex((piece) => piece.kind === 'close' && piece.span === span);
  // A delimiter runs into the same character next to it: the closer of the
  // span before, or the edge of an atom's source, which is written as it is.
  const touching = (index: number, edge: 'first' | 'last'): string | null => {
    const piece = pieces[index];
    const output = outputs[index] ?? '';
    const char = edge === 'first' ? output.slice(0, 1) : output.slice(-1);
    if (piece?.kind === 'leaf' && piece.leaf === 'raw') return char;
    return piece?.kind === 'close' && index === open - 1 ? char : null;
  };
  const neighbours = [
    touching(open - 1, 'last'),
    touching(open + 1, 'first'),
    touching(close - 1, 'last'),
    touching(close + 1, 'first'),
  ];
  const runsInto = (delimiter: string) => neighbours.includes(delimiter.slice(0, 1));
  const delimiter =
    [syntax.delimiter, syntax.alternative].find((d) => !runsInto(d)) ?? syntax.delimiter;
  outputs[open] = delimiter;
  outputs[close] = delimiter;

  const opens = canOpen(delimiter, outputs[open - 1] ?? null, outputs[open + 1] ?? null);
  const closes = canClose(delimiter, outputs[close - 1] ?? null, outputs[close + 1] ?? null);
  return (
    (!opens && encodeEdge(pieces, outputs, open - 1, 'last')) ||
    (!closes && encodeEdge(pieces, outputs, close + 1, 'first'))
  );
}

/**
 * Writes the first or last character of a text leaf as a character
 * reference. Returns whether it changed anything: an edge that already ends a
 * reference (`;`) or starts one (`&`) is left alone, and so is anything but
 * text.
 */
function encodeEdge(
  pieces: readonly Piece[],
  outputs: string[],
  index: number,
  edge: 'first' | 'last',
): boolean {
  const piece = pieces[index];
  const output = outputs[index];
  if (piece?.kind !== 'leaf' || piece.leaf !== 'text' || output === undefined) return false;
  const chars = Array.from(output);
  switch (edge) {
    case 'first': {
      const [first = '', ...rest] = chars;
      if (first === '&' || first === '') return false;
      outputs[index] = characterReference(first) + rest.join('');
      return true;
    }
    case 'last': {
      const last = chars[chars.length - 1] ?? '';
      if (last === ';' || last === '') return false;
      outputs[index] = chars.slice(0, -1).join('') + characterReference(last);
      return true;
    }
    default:
      return assertNever(edge);
  }
}

/**
 * Nests content into spans. A span stays open while the following content
 * still carries its mark and every mark outside it. Of the marks that start
 * at the same place, the one that goes on longest opens first and so encloses
 * the others, which keeps it from being split where they end; marks that go
 * on equally long open in `MARK_TYPES` order.
 */
function buildTree(content: readonly Inline[]): Node[] {
  const root: Node[] = [];
  const open: Span[] = [];
  const parent = () => open[open.length - 1]?.children ?? root;
  content.forEach((inline, index) => {
    const keep = open.findIndex((span) => !inline.marks.some((mark) => sameMark(mark, span.mark)));
    if (keep !== -1) open.length = keep;

    // A switch rather than filters, so a new kind of mark syntax fails to
    // compile here instead of being written as plain text.
    let verbatim = false;
    const starting: Mark[] = [];
    for (const mark of inline.marks) {
      const syntax = markSyntax(mark.type);
      switch (syntax.kind) {
        case 'delimited':
        case 'link':
          if (!open.some((span) => sameMark(span.mark, mark))) starting.push(mark);
          break;
        case 'code':
          verbatim = true;
          break;
        default:
          assertNever(syntax);
      }
    }
    // A stable sort keeps `MARK_TYPES` order among marks that go on equally long.
    starting.sort((a, b) => extent(content, index, b) - extent(content, index, a));
    for (const mark of starting) {
      const span: Span = { mark, children: [] };
      parent().push({ kind: 'span', ...span });
      open.push(span);
    }
    switch (inline.type) {
      case 'text':
        parent().push({ kind: verbatim ? 'code' : 'text', text: inline.text, index });
        break;
      case 'raw':
        parent().push({ kind: 'raw', source: inline.source, index });
        break;
      default:
        assertNever(inline);
    }
  });
  return root;
}

/** How many content items from `from` on carry `mark`. */
function extent(content: readonly Inline[], from: number, mark: Mark): number {
  let end = from;
  while (content[end]?.marks.some((other) => sameMark(other, mark)) === true) end += 1;
  return end - from;
}

function flatten(nodes: readonly Node[]): Piece[] {
  return nodes.flatMap((node): Piece[] => {
    switch (node.kind) {
      case 'text':
        return [{ kind: 'leaf', leaf: 'text', output: escapeText(node.text) }];
      case 'code':
        return [{ kind: 'leaf', leaf: 'code', output: codeSpan(node.text) }];
      case 'raw':
        return [{ kind: 'leaf', leaf: 'raw', output: node.source }];
      case 'span':
        return [
          { kind: 'open', span: node },
          ...flatten(node.children),
          { kind: 'close', span: node },
        ];
      default:
        return assertNever(node);
    }
  });
}

/**
 * What opens or closes a span: a delimited mark's delimiter (`chosen`, or
 * its usual one before one is chosen), or a link's brackets and destination.
 */
function spanEdge(edge: 'open' | 'close', span: Span, chosen: string | null): string {
  const syntax = markSyntax(span.mark.type);
  switch (syntax.kind) {
    case 'delimited':
      return chosen ?? syntax.delimiter;
    case 'link':
      return edge === 'open' ? syntax.open : `${syntax.close}${linkTail(span.mark)}`;
    case 'code':
      return '';
    default:
      return assertNever(syntax);
  }
}

/**
 * Whether a delimiter between `before` and `after` can open emphasis, under
 * every classifier. `_` is stricter than `*` and `~`: it must not also be able
 * to close, unless punctuation comes before it.
 */
function canOpen(delimiter: string, before: string | null, after: string | null): boolean {
  return CLASSIFIERS.every((c) => {
    const left = leftFlanking(c, before, after);
    if (!isUnderscore(delimiter)) return left;
    return (
      left &&
      (!rightFlanking(c, before, after) || classify(c, edge(c, before, 'last')) === 'punctuation')
    );
  });
}

/** Whether a delimiter between `before` and `after` can close emphasis, under every classifier. */
function canClose(delimiter: string, before: string | null, after: string | null): boolean {
  return CLASSIFIERS.every((c) => {
    const right = rightFlanking(c, before, after);
    if (!isUnderscore(delimiter)) return right;
    return (
      right &&
      (!leftFlanking(c, before, after) || classify(c, edge(c, after, 'first')) === 'punctuation')
    );
  });
}

function isUnderscore(delimiter: string): boolean {
  return delimiter.startsWith('_');
}

function edge(c: Classifier, text: string | null, which: 'first' | 'last'): string | null {
  if (text === null) return null;
  return which === 'first' ? c.first(text) : c.last(text);
}

type CharClass = 'whitespace' | 'punctuation' | 'other';

/** One reading of CommonMark's character classes. */
type Classifier = {
  readonly first: (text: string) => string;
  readonly last: (text: string) => string;
  readonly whitespace: RegExp;
  readonly punctuation: RegExp;
};

/**
 * Two readings of the classes a delimiter's neighbours fall into.
 *
 * - micromark, which parses here, looks at UTF-16 code units with `\s` as
 *   whitespace, so half of a surrogate pair is neither class.
 * - The CommonMark 0.31 spec looks at code points, with Zs plus tab, line feed,
 *   form feed and carriage return as whitespace, and P or S as punctuation,
 *   so an emoji is punctuation.
 */
const CLASSIFIERS: readonly Classifier[] = [
  {
    first: (text) => text.slice(0, 1),
    last: (text) => text.slice(-1),
    whitespace: /\s/,
    punctuation: /\p{P}|\p{S}/u,
  },
  {
    first: (text) => Array.from(text)[0] ?? '',
    last: (text) => Array.from(text).pop() ?? '',
    whitespace: /[\t\n\f\r\p{Zs}]/u,
    punctuation: /\p{P}|\p{S}/u,
  },
];

/** The class of a character. The edge of the line counts as whitespace. */
function classify(classifier: Classifier, char: string | null): CharClass {
  if (char === null || char === '' || classifier.whitespace.test(char)) return 'whitespace';
  if (classifier.punctuation.test(char)) return 'punctuation';
  return 'other';
}

function leftFlanking(c: Classifier, before: string | null, after: string | null): boolean {
  const next = classify(c, edge(c, after, 'first'));
  const previous = classify(c, edge(c, before, 'last'));
  return next !== 'whitespace' && (next !== 'punctuation' || previous !== 'other');
}

function rightFlanking(c: Classifier, before: string | null, after: string | null): boolean {
  const previous = classify(c, edge(c, before, 'last'));
  const next = classify(c, edge(c, after, 'first'));
  return previous !== 'whitespace' && (previous !== 'punctuation' || next !== 'other');
}

// ---------------------------------------------------------------------------
// Escaping

/**
 * Characters that start inline syntax anywhere in a line, and `&` where it
 * would start a character reference.
 */
const INLINE_SPECIAL = new RegExp(`${INLINE_START_CLASS}|&(?=[#A-Za-z0-9])`, 'g');
/** Spaces and tabs, which CommonMark strips from both ends of a line. */
const STRIPPED = /[ \t]/;
/** Syntax that only counts at the start of a block's content. */
const BLOCK_START = new RegExp(
  `^(?:${BLOCK_START_CLASS}|\\d{1,${MARKDOWN_SYNTAX.ordered.maxDigits}}${ORDERED_DELIMITER_CLASS})`,
);
/** An ATX heading's optional closing sequence. */
const HEADING_CLOSE = new RegExp(
  `(^|[ \\t])((?:${escapeRegExp(MARKDOWN_SYNTAX.heading.marker)})+)$`,
);

function escapeText(text: string): string {
  return text.replace(INLINE_SPECIAL, '\\$&');
}

/**
 * Protects the edges of a line. Leading and trailing spaces become character
 * references so they are not stripped, and syntax that would turn the content
 * into another block (`# `, `- `, `1. `, `> `) is escaped.
 */
function lineEdges(output: string, first: boolean, last: boolean, context: LineContext): string {
  let result = output;
  if (last && STRIPPED.test(result.slice(-1))) {
    result = result.slice(0, -1) + characterReference(result.slice(-1));
  }
  if (last && context.heading) {
    result = result.replace(HEADING_CLOSE, '$1\\$2');
  }
  if (first && STRIPPED.test(result.slice(0, 1))) {
    return characterReference(result.slice(0, 1)) + result.slice(1);
  }
  if (first) {
    return result.replace(BLOCK_START, (match) =>
      /^\d/.test(match) ? `${match.slice(0, -1)}\\${match.slice(-1)}` : `\\${match}`,
    );
  }
  return result;
}

function characterReference(char: string): string {
  return `&#${char.codePointAt(0) ?? 0};`;
}

/**
 * A code span holding `text` exactly. The fence is one backtick longer than
 * the longest backtick run inside, and the content is padded with a space on
 * each side when CommonMark would otherwise strip or merge its edges.
 */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const needsPadding =
    text.startsWith('`') ||
    text.endsWith('`') ||
    (text.startsWith(' ') && text.endsWith(' ') && !/^ +$/.test(text));
  const padding = needsPadding ? ' ' : '';
  return `${fence}${padding}${text}${padding}${fence}`;
}

// ---------------------------------------------------------------------------
// Links

/** A destination needs angle brackets when it is empty or holds any of these, or a control character. */
const NEEDS_BRACKETS = /[\s<>()\\&]/;
/** Characters a bracketed destination or a title escapes with a backslash. */
const DESTINATION_ESCAPES = /[\\<>]|&(?=[#A-Za-z0-9])/g;
const TITLE_ESCAPES = /[\\"]|&(?=[#A-Za-z0-9])/g;
/** C0 controls end below this code point; DEL is the one control above it. */
const FIRST_PRINTABLE = 0x20;
const DELETE = 0x7f;

function isControl(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < FIRST_PRINTABLE || code === DELETE;
}

/** What follows a link's text: `(destination "title")`. */
function linkTail(mark: Mark): string {
  switch (mark.type) {
    case 'link': {
      const title =
        mark.title === undefined ? '' : ` "${escapeLinkPart(mark.title, TITLE_ESCAPES)}"`;
      return `(${linkDestination(mark.href)}${title})`;
    }
    case 'strike':
    case 'bold':
    case 'italic':
    case 'code':
      return '';
    default:
      return assertNever(mark);
  }
}

/** A destination that reads back as `href` exactly. */
function linkDestination(href: string): string {
  if (href !== '' && !NEEDS_BRACKETS.test(href) && !Array.from(href).some(isControl)) return href;
  return `<${escapeLinkPart(href, DESTINATION_ESCAPES)}>`;
}

function escapeLinkPart(value: string, escapes: RegExp): string {
  // Control characters cannot be written literally; references read back as them.
  return Array.from(value.replace(escapes, '\\$&'), (char) =>
    isControl(char) ? characterReference(char) : char,
  ).join('');
}
