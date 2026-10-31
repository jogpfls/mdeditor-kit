import { assertNever, charClass } from '../lang';
import { MARK_TYPES, type HeadingLevel, type MarkType } from '../model';

/**
 * How a mark is written in markdown.
 *
 * - `delimited` marks wrap text in delimiter runs (`**`, `*`, `~~`). Their
 *   delimiters only count when they flank text the right way, so whitespace at
 *   their edges moves outside them. `alternative` is the other delimiter
 *   CommonMark or GFM reads as the same mark: the serializer writes it where
 *   the usual one would merge with a neighbouring run (`*a*__b__`), and
 *   escapes it in text. Its character follows stricter flanking rules when it
 *   is `_`.
 * - `code` is a code span: it keeps every character, spaces included.
 * - `link` wraps its text in `open` and `close`, followed by the destination.
 */
export type MarkSyntax =
  | {
      readonly kind: 'delimited';
      readonly delimiter: string;
      readonly alternative: string;
    }
  | { readonly kind: 'code'; readonly delimiter: string }
  | { readonly kind: 'link'; readonly open: string; readonly close: string };

/**
 * Every piece of markdown syntax the editor reads or writes. The serializer,
 * the escaping rules and the input rules all derive from this table, so they
 * cannot disagree. Heading levels come from `HEADING_LEVELS` in the model.
 */
export const MARKDOWN_SYNTAX = {
  /** Repeated once per level: `#`, `##` … */
  heading: { marker: '#' },
  quote: { marker: '>' },
  /** `written` is what the serializer and the input rule use. */
  bullet: { markers: ['-', '*', '+'], written: '-' },
  /** A number of up to `maxDigits` digits followed by a delimiter. */
  ordered: { delimiters: ['.', ')'], written: '.', maxDigits: 9 },
  divider: { written: '---' },
  /** Characters that start inline syntax besides the mark delimiters. */
  inlineStarts: ['\\', '<'],
  marks: {
    strike: { kind: 'delimited', delimiter: '~~', alternative: '~' },
    bold: { kind: 'delimited', delimiter: '**', alternative: '__' },
    italic: { kind: 'delimited', delimiter: '*', alternative: '_' },
    code: { kind: 'code', delimiter: '`' },
    link: { kind: 'link', open: '[', close: ']' },
  },
} as const satisfies {
  readonly marks: Record<MarkType, MarkSyntax>;
  readonly [part: string]: unknown;
};

/** A mark's syntax, widened so callers switch on `kind`. */
export function markSyntax(type: MarkType): MarkSyntax {
  return MARKDOWN_SYNTAX.marks[type];
}

/** The marks written with delimiter runs. */
export type DelimitedMark = {
  [M in MarkType]: (typeof MARKDOWN_SYNTAX.marks)[M] extends { kind: 'delimited' } ? M : never;
}[MarkType];

export function isDelimited(type: MarkType): type is DelimitedMark {
  const syntax = markSyntax(type);
  switch (syntax.kind) {
    case 'delimited':
      return true;
    case 'code':
    case 'link':
      return false;
    default:
      return assertNever(syntax);
  }
}

export function headingMarker(level: HeadingLevel): string {
  return MARKDOWN_SYNTAX.heading.marker.repeat(level);
}

/** Every delimiter, written or not, that opens or closes a mark. */
export function markDelimiters(type: MarkType): readonly string[] {
  const syntax = markSyntax(type);
  switch (syntax.kind) {
    case 'delimited':
      return [syntax.delimiter, syntax.alternative];
    case 'code':
      return [syntax.delimiter];
    case 'link':
      return [syntax.open, syntax.close];
    default:
      return assertNever(syntax);
  }
}

/** A character class matching every character that starts inline syntax. */
export const INLINE_START_CLASS = charClass([
  ...MARKDOWN_SYNTAX.inlineStarts,
  ...new Set(MARK_TYPES.flatMap(markDelimiters).map((delimiter) => delimiter.slice(0, 1))),
]);

/** A character class matching every character that starts a block marker. */
export const BLOCK_START_CLASS = charClass([
  MARKDOWN_SYNTAX.heading.marker,
  MARKDOWN_SYNTAX.quote.marker,
  ...MARKDOWN_SYNTAX.bullet.markers,
]);

/** A character class matching the delimiters after an ordered list number. */
export const ORDERED_DELIMITER_CLASS = charClass(MARKDOWN_SYNTAX.ordered.delimiters);

/**
 * How an empty text block is written, since an empty line means nothing in
 * markdown: a non-breaking space as a character reference, which every
 * renderer reads the same way, HTML allowed or not. A list item writes it
 * after its marker. Headings, and a quote on its own, keep their bare marker.
 * Reading back, a block whose text is only whitespace is empty.
 */
export const EMPTY_TEXT = '&nbsp;';

/** Block tag names that start an HTML block of CommonMark kind 6. */
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const ATTRIBUTE =
  String.raw`(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>` +
  '`' +
  String.raw`]+|'[^']*'|"[^"]*"))?)`;
const OPEN_TAG = String.raw`<[A-Za-z][A-Za-z0-9-]*${ATTRIBUTE}*\s*\/?>`;
const CLOSING_TAG = String.raw`<\/[A-Za-z][A-Za-z0-9-]*\s*>`;

/**
 * The seven ways a line starts an HTML block in CommonMark (4.6), after up to
 * three spaces. Kinds 1 to 5 end only at their `end` marker, not at a blank
 * line; kind 7 is a lone tag on its line.
 */
export const HTML_BLOCK_STARTS: readonly {
  readonly start: RegExp;
  readonly end: ((match: RegExpExecArray) => string) | null;
}[] = [
  {
    start: /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/i,
    end: (match) => `</${match[1] ?? 'pre'}>`,
  },
  { start: /^ {0,3}<!--/, end: () => '-->' },
  { start: /^ {0,3}<\?/, end: () => '?>' },
  { start: /^ {0,3}<![A-Za-z]/, end: () => '>' },
  { start: /^ {0,3}<!\[CDATA\[/, end: () => ']]>' },
  { start: new RegExp(String.raw`^ {0,3}<\/?(?:${BLOCK_TAGS})(?=\s|\/?>|$)`, 'i'), end: null },
  {
    start: new RegExp(String.raw`^ {0,3}(?:${OPEN_TAG}|${CLOSING_TAG})[ \t]*$`),
    end: null,
  },
];

/** Whether a line of markdown would start an HTML block. */
export function startsHtmlBlock(line: string): boolean {
  return HTML_BLOCK_STARTS.some((kind) => kind.start.test(line));
}

/**
 * Whether a line starts an HTML block that goes on past the line: one that
 * ends at a blank line, or one whose end marker the line does not hold.
 */
export function startsOpenHtmlBlock(line: string): boolean {
  return HTML_BLOCK_STARTS.some((kind) => {
    const match = kind.start.exec(line);
    if (match === null) return false;
    return kind.end === null || !line.slice(match[0].length).includes(kind.end(match));
  });
}
