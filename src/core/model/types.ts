/**
 * An inline format applied to a stretch of content. A link carries its
 * address; the other marks carry nothing. Two marks are equal when their type
 * and every attribute are equal (see `sameMark`).
 */
export type Mark =
  | { readonly type: 'link'; readonly href: string; readonly title?: string }
  | { readonly type: 'strike' }
  | { readonly type: 'bold' }
  | { readonly type: 'italic' }
  | { readonly type: 'code' };

export type MarkType = Mark['type'];

/**
 * One entry per mark type, in the fixed order marks are listed everywhere:
 * normalized `marks` arrays, DOM nesting (outermost first) and the
 * serializers. A link encloses everything else. `satisfies` makes the object
 * list exactly the mark types; string keys keep their written order.
 *
 * `inclusive` says whether a mark grows when text is typed at its end. Code
 * and links do not: typing right after a code span or a link writes plain
 * text, since that is what a user who just closed them means. Typed inside
 * them, text still takes them on (see `marksAt`).
 */
const MARK_SPECS = {
  link: { inclusive: false },
  strike: { inclusive: true },
  bold: { inclusive: true },
  italic: { inclusive: true },
  code: { inclusive: false },
} as const satisfies Record<MarkType, { readonly inclusive: boolean }>;

function isMarkType(value: string): value is MarkType {
  return Object.prototype.hasOwnProperty.call(MARK_SPECS, value);
}

/** Whether a mark grows when text is typed at its end. */
export function isInclusive(type: MarkType): boolean {
  return MARK_SPECS[type].inclusive;
}

/** Every mark type, in the fixed order above. */
export const MARK_TYPES: readonly MarkType[] = Object.keys(MARK_SPECS).filter(isMarkType);

/** A stretch of text sharing one set of marks. Never contains a line break. */
export type TextRun = {
  readonly type: 'text';
  readonly text: string;
  readonly marks: readonly Mark[];
};

/**
 * Inline source the model cannot represent, kept verbatim so it is written
 * back exactly: an image, inline HTML. It takes up one position, cannot be
 * edited from inside, and input rules never look into it. It may carry any
 * mark but `code`, since a code span cannot hold it.
 */
export type InlineAtom = {
  readonly type: 'raw';
  readonly source: string;
  readonly marks: readonly Mark[];
};

/** The content of a text block: text runs and atoms. */
export type Inline = TextRun | InlineAtom;

/**
 * A heading level. This type is the only place that says how many levels
 * there are: the formats, the input rules and the markdown syntax all derive
 * from it, through `HEADING_LEVELS`.
 */
export type HeadingLevel = 1 | 2 | 3 | 4;

/** One entry per level; `satisfies` makes it list exactly the levels of the type. */
const LEVEL_SET = { 1: true, 2: true, 3: true, 4: true } as const satisfies Record<
  HeadingLevel,
  true
>;

export function isHeadingLevel(value: number): value is HeadingLevel {
  return value in LEVEL_SET;
}

/** The heading levels in ascending order. */
export const HEADING_LEVELS: readonly HeadingLevel[] = Object.keys(LEVEL_SET)
  .map(Number)
  .filter(isHeadingLevel)
  .sort((a, b) => a - b);

export const MAX_HEADING_LEVEL: HeadingLevel = HEADING_LEVELS.reduce((a, b) => (b > a ? b : a));

/**
 * The deepest list indent. Ordered lists are numbered 1, a, i by depth, so
 * three depths (0, 1, 2) exist.
 */
export const MAX_INDENT = 2;

/**
 * The largest number an ordered list may start at. CommonMark allows nine
 * digits, so every output format can write it.
 */
export const MAX_ORDERED_START = 999_999_999;

/** One line of the document. A line break always starts a new block. */
export type Block =
  | { readonly id: string; readonly type: 'paragraph'; readonly content: readonly Inline[] }
  | {
      readonly id: string;
      readonly type: 'heading';
      readonly level: HeadingLevel;
      readonly content: readonly Inline[];
    }
  | { readonly id: string; readonly type: 'quote'; readonly content: readonly Inline[] }
  | {
      readonly id: string;
      readonly type: 'bullet';
      readonly indent: number;
      readonly content: readonly Inline[];
    }
  | {
      readonly id: string;
      readonly type: 'ordered';
      readonly indent: number;
      /**
       * The number this item shows, when it starts a run of ordered items
       * and that number is not 1. Only the first item of a run has it; the
       * others count on from it (see `listNumbers`).
       */
      readonly start?: number;
      readonly content: readonly Inline[];
    }
  | { readonly id: string; readonly type: 'divider' }
  /**
   * Block source the model cannot represent (a code block, a table, an HTML
   * block), kept verbatim. It is edited only as a whole: deleted, copied or
   * moved. Its source may hold line breaks.
   */
  | { readonly id: string; readonly type: 'raw'; readonly source: string };

/** A block that holds editable content: every block but the divider and raw blocks. */
export type TextBlock = Exclude<Block, { readonly type: 'divider' | 'raw' }>;

/** A list block. Its number is not stored: it derives from earlier siblings. */
export type ListBlock = Extract<Block, { readonly type: 'bullet' | 'ordered' }>;

/** The whole document. Always holds at least one block, and block ids are unique. */
export type Doc = { readonly blocks: readonly Block[] };

/** A run of whole or partial blocks, the unit of copy and paste. */
export type Fragment = readonly Block[];

/**
 * An address in the document. `offset` counts the UTF-16 code units of the
 * block's text, plus one for each atom, so it matches what the user sees:
 * markdown syntax is never stored. A block without content has only offset 0.
 */
export type Pos = { readonly blockId: string; readonly offset: number };

/** Produces a new unique block id. Injected so that core stays deterministic. */
export type CreateId = () => string;
