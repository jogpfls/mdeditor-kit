import {
  MARK_TAGS,
  assertNever,
  isSafeHref,
  sortMarks,
  type Block,
  type EditorState,
  type HeadingLevel,
  type Inline,
  type Mark,
  type MarkType,
  type RawRenderer,
} from '../../core/internal';

/** A block's slot: its type, with headings named by level. */
type BlockSlot = Exclude<Block['type'], 'heading'> | `heading${HeadingLevel}`;

/**
 * A part of the rendered document that takes a class name from
 * `classNames`: every block type (headings by level), every mark, and atoms.
 * Derived from the model, so a new block type or mark is a new slot.
 */
export type MdSlot = BlockSlot | MarkType | 'atom';

/** A class name for any slot. Compared by value: a new object with the same names changes nothing. */
export type MdClassNames = { readonly [S in MdSlot]?: string };

/** What a description is rendered with, besides the state. */
export type RenderContext = {
  readonly classNames: MdClassNames;
  /** Shown in the first block when the document is a single empty paragraph. */
  readonly placeholder: string | null;
  /** Renders the source of raw blocks and atoms (see `rawRenderer`). */
  readonly raw: RawRenderer;
};

/** A DOM node to build. `html` is rendered raw source, built through the allow list (see `sanitize`). */
export type DomNode =
  | {
      readonly kind: 'element';
      readonly tag: string;
      readonly attrs: Readonly<Record<string, string>>;
      readonly children: readonly DomNode[];
    }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'html'; readonly html: string; readonly inline: boolean };

/** How one block is drawn, and the slots it used, so a change of class names redraws only it. */
export type BlockDescription = {
  readonly blockId: string;
  readonly node: Extract<DomNode, { kind: 'element' }>;
  readonly slots: ReadonlySet<MdSlot>;
};

/** What the state decorates a block with, besides the block itself. */
export type Decoration = {
  /** The block is selected as a whole (a block selection). */
  readonly selected: boolean;
  /** The placeholder to show in it, if any. */
  readonly placeholder: string | null;
};

/** The whole document as DOM to build: one description per block, and where the gap caret is. */
export type Description = {
  readonly blocks: readonly BlockDescription[];
  /** A gap selection is drawn as a widget before this block, or at the end for `null`. */
  readonly gap: { readonly beforeBlockId: string | null } | null;
};

/** Describes the whole document. The renderer describes only the blocks that changed. */
export function describe(state: EditorState, ctx: RenderContext): Description {
  const blocks = state.doc.blocks.map((block) =>
    describeBlock(block, decorationOf(state, block, ctx), ctx),
  );
  const { selection } = state;
  return {
    blocks,
    gap: selection.kind === 'gap' ? { beforeBlockId: selection.beforeBlockId } : null,
  };
}

/** What the state decorates a block with (see `Decoration`). */
export function decorationOf(state: EditorState, block: Block, ctx: RenderContext): Decoration {
  const { selection, doc } = state;
  const selected = selection.kind === 'block' && selection.blockId === block.id;
  const [only, ...rest] = doc.blocks;
  const empty =
    only === block && rest.length === 0 && block.type === 'paragraph' && block.content.length === 0;
  return { selected, placeholder: empty ? ctx.placeholder : null };
}

/**
 * Describes one block. Blocks are flat: every block is a direct child of the
 * root, keyed by `data-block-id`. A list item is a `div`, numbered by CSS; a
 * block without text and every atom are not editable. An empty text block
 * holds a `<br>` so it keeps its height and can hold the caret.
 */
export function describeBlock(
  block: Block,
  decoration: Decoration,
  ctx: RenderContext,
): BlockDescription {
  const slots = new Set<MdSlot>();
  const slot = blockSlot(block);
  slots.add(slot);
  const attrs: Record<string, string> = { 'data-block-id': block.id, 'data-type': block.type };
  if (decoration.selected) attrs['data-selected'] = 'true';
  if (decoration.placeholder !== null) attrs['data-placeholder'] = decoration.placeholder;
  const className = ctx.classNames[slot];

  switch (block.type) {
    case 'paragraph':
    case 'quote':
      return text(block.type === 'paragraph' ? 'p' : 'blockquote', block.content);
    case 'heading':
      attrs['data-level'] = String(block.level);
      return text(`h${block.level}`, block.content);
    case 'bullet':
      attrs['data-indent'] = String(block.indent);
      return text('div', block.content);
    case 'ordered':
      attrs['data-indent'] = String(block.indent);
      if (block.start !== undefined) attrs['style'] = `--md-start: ${block.start}`;
      return text('div', block.content);
    case 'divider':
      return finish('hr', [], { contenteditable: 'false' });
    case 'raw': {
      const html = ctx.raw.block(block.source);
      const children: DomNode[] =
        html === null
          ? [{ kind: 'text', text: block.source }]
          : [{ kind: 'html', html, inline: false }];
      return finish('div', children, { contenteditable: 'false' });
    }
    default:
      return assertNever(block);
  }

  function text(tag: string, content: readonly Inline[]): BlockDescription {
    if (content.length === 0) {
      attrs['data-empty'] = 'true';
      return finish(tag, [element('br', {}, [])], {});
    }
    return finish(
      tag,
      content.map((piece) => describeInline(piece, ctx, slots)),
      {},
    );
  }

  function finish(
    tag: string,
    children: readonly DomNode[],
    extra: Readonly<Record<string, string>>,
  ): BlockDescription {
    const all = { ...attrs, ...extra, ...(className === undefined ? {} : { class: className }) };
    return { blockId: block.id, node: element(tag, all, children), slots };
  }
}

function blockSlot(block: Block): BlockSlot {
  switch (block.type) {
    case 'heading':
      return `heading${block.level}`;
    case 'paragraph':
    case 'quote':
    case 'bullet':
    case 'ordered':
    case 'divider':
    case 'raw':
      return block.type;
    default:
      return assertNever(block);
  }
}

/** One piece of content inside its marks, outermost first (`MARK_TYPES` order). */
function describeInline(piece: Inline, ctx: RenderContext, slots: Set<MdSlot>): DomNode {
  const body = describeBody(piece, ctx, slots);
  return [...sortMarks(piece.marks)].reverse().reduce<DomNode>((inner, mark) => {
    slots.add(mark.type);
    return element(MARK_TAGS[mark.type], markAttrs(mark, ctx), [inner]);
  }, body);
}

function describeBody(piece: Inline, ctx: RenderContext, slots: Set<MdSlot>): DomNode {
  switch (piece.type) {
    case 'text':
      return { kind: 'text', text: piece.text };
    case 'raw': {
      slots.add('atom');
      const html = ctx.raw.inline(piece.source);
      const className = ctx.classNames.atom;
      return element(
        'span',
        {
          'data-atom': '',
          contenteditable: 'false',
          ...(className === undefined ? {} : { class: className }),
        },
        [
          html === null
            ? { kind: 'text', text: piece.source }
            : { kind: 'html', html, inline: true },
        ],
      );
    }
    default:
      return assertNever(piece);
  }
}

/** A link gets its address only when the URL policy allows it; the model keeps it either way. */
function markAttrs(mark: Mark, ctx: RenderContext): Record<string, string> {
  const className = ctx.classNames[mark.type];
  const attrs: Record<string, string> = className === undefined ? {} : { class: className };
  switch (mark.type) {
    case 'link':
      if (isSafeHref(mark.href)) attrs['href'] = mark.href;
      if (mark.title !== undefined) attrs['title'] = mark.title;
      return attrs;
    case 'strike':
    case 'bold':
    case 'italic':
    case 'code':
      return attrs;
    default:
      return assertNever(mark);
  }
}

function element(
  tag: string,
  attrs: Readonly<Record<string, string>>,
  children: readonly DomNode[],
): Extract<DomNode, { kind: 'element' }> {
  return { kind: 'element', tag, attrs, children };
}
