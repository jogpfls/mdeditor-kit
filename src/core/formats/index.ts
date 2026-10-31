import type { HeadingLevel, Mark } from '../model';

/** The block shape a block or insert format produces. */
export type BlockAttrs =
  | { readonly type: 'heading'; readonly level: HeadingLevel }
  | { readonly type: 'quote' }
  | { readonly type: 'bullet'; readonly indent: number }
  | { readonly type: 'ordered'; readonly indent: number }
  | { readonly type: 'divider' };

/**
 * How a format acts on the document.
 *
 * - `mark` toggles an inline mark on the selection. Links have no format:
 *   they are kept and edited as content, not toggled.
 * - `block` toggles the type of the blocks the selection touches.
 * - `insert` inserts a new block and has no on/off state.
 *
 * `shortcut` is written as `Mod-Shift-x`, where `Mod` is Cmd on macOS and Ctrl
 * elsewhere.
 */
export type FormatSpec =
  | { readonly kind: 'mark'; readonly mark: Mark; readonly shortcut?: string }
  | { readonly kind: 'block'; readonly block: BlockAttrs; readonly shortcut?: string }
  | { readonly kind: 'insert'; readonly block: BlockAttrs; readonly shortcut?: string };

/**
 * One heading format per level, named `heading1`, `heading2` … The levels
 * come from `HEADING_LEVELS` in the model; adding a level there makes this
 * table fail to compile until the matching format is added.
 */
type HeadingFormats = {
  readonly [L in HeadingLevel as `heading${L}`]: {
    readonly kind: 'block';
    readonly block: { readonly type: 'heading'; readonly level: L };
  };
};

/** Every format the editor supports. This table is the only list of them. */
export const FORMATS = {
  bold: { kind: 'mark', mark: { type: 'bold' }, shortcut: 'Mod-b' },
  italic: { kind: 'mark', mark: { type: 'italic' }, shortcut: 'Mod-i' },
  strike: { kind: 'mark', mark: { type: 'strike' }, shortcut: 'Mod-Shift-x' },
  code: { kind: 'mark', mark: { type: 'code' }, shortcut: 'Mod-e' },
  heading1: { kind: 'block', block: { type: 'heading', level: 1 } },
  heading2: { kind: 'block', block: { type: 'heading', level: 2 } },
  heading3: { kind: 'block', block: { type: 'heading', level: 3 } },
  heading4: { kind: 'block', block: { type: 'heading', level: 4 } },
  quote: { kind: 'block', block: { type: 'quote' } },
  bullet: { kind: 'block', block: { type: 'bullet', indent: 0 } },
  ordered: { kind: 'block', block: { type: 'ordered', indent: 0 } },
  divider: { kind: 'insert', block: { type: 'divider' } },
} as const satisfies Record<string, FormatSpec> & HeadingFormats;

/** The name of a supported format, such as `'bold'` or `'heading2'`. */
export type Format = keyof typeof FORMATS;

/**
 * Whether a value names a format, derived from the keys of `FORMATS`. Use it
 * to narrow a string from outside, such as a `<select>` value, before passing
 * it to `toggle`.
 */
export function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FORMATS, value);
}

/** The heading format of a level. */
export function headingFormat(level: HeadingLevel): Format {
  return `heading${level}` as const;
}

/** The spec of a format, widened so callers switch on `kind`. */
export function formatSpec(format: Format): FormatSpec {
  return FORMATS[format];
}
