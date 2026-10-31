import {
  assertNever,
  rawRenderer,
  type Block,
  type EditorState,
  type RawRenderer,
} from '../../core/internal';
import {
  decorationOf,
  describeBlock,
  type Decoration,
  type DomNode,
  type MdClassNames,
  type MdSlot,
  type RenderContext,
} from './describe';
import { sanitize } from './sanitize';

/** What is drawn for a block, and what it was drawn from. */
type Drawn = {
  readonly element: HTMLElement;
  readonly block: Block;
  readonly decoration: Decoration;
  readonly slots: ReadonlySet<MdSlot>;
  readonly raw: RawRenderer;
};

/**
 * Writes a state into a root element and keeps it in step, block by block.
 * Blocks are matched by id. A block whose object, decoration and used class
 * names are all unchanged keeps its element untouched; otherwise its element
 * is rebuilt from its description, and replaced when its tag changes.
 * Blocks are moved, added and removed to match the document's order, and
 * anything else found in the root is removed.
 */
export class Renderer {
  readonly #root: HTMLElement;
  #drawn = new Map<string, Drawn>();
  #classNames: MdClassNames | null = null;
  #gap: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  render(state: EditorState, ctx: RenderContext): void {
    const changed =
      this.#classNames === null ? null : changedSlots(this.#classNames, ctx.classNames);
    this.#classNames = ctx.classNames;

    const drawn = new Map<string, Drawn>();
    const order: HTMLElement[] = [];
    const { selection } = state;
    const gapBefore = selection.kind === 'gap' ? selection.beforeBlockId : undefined;
    for (const block of state.doc.blocks) {
      const decoration = decorationOf(state, block, ctx);
      const old = this.#drawn.get(block.id);
      const next =
        old !== undefined && isCurrent(old, block, decoration, ctx, changed)
          ? old
          : this.#draw(old, block, decoration, ctx);
      drawn.set(block.id, next);
      if (gapBefore === block.id) order.push(this.#gapWidget());
      order.push(next.element);
    }
    if (gapBefore === null) order.push(this.#gapWidget());
    this.#drawn = drawn;
    this.#arrange(order);
  }

  /** Removes everything drawn. */
  clear(): void {
    this.#drawn = new Map();
    this.#classNames = null;
    this.#root.replaceChildren();
  }

  #draw(old: Drawn | undefined, block: Block, decoration: Decoration, ctx: RenderContext): Drawn {
    const description = describeBlock(block, decoration, ctx);
    const { node } = description;
    const document = this.#root.ownerDocument;
    const reuse = old !== undefined && old.element.tagName.toLowerCase() === node.tag;
    const element = reuse ? old.element : document.createElement(node.tag);
    for (const name of element.getAttributeNames()) {
      if (!(name in node.attrs)) element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
    element.replaceChildren(...node.children.map((child) => build(child, document)));
    return { element, block, decoration, slots: description.slots, raw: ctx.raw };
  }

  /** The widget that shows a gap selection: a caret between blocks, not editable. */
  #gapWidget(): HTMLElement {
    if (this.#gap === null) {
      const widget = this.#root.ownerDocument.createElement('div');
      widget.setAttribute('data-gap', '');
      widget.setAttribute('contenteditable', 'false');
      this.#gap = widget;
    }
    return this.#gap;
  }

  /** Puts the root's children in this order, moving as few as possible, and removes the rest. */
  #arrange(order: readonly HTMLElement[]): void {
    const root = this.#root;
    let cursor = root.firstChild;
    for (const element of order) {
      if (cursor === element) {
        cursor = cursor.nextSibling;
        continue;
      }
      root.insertBefore(element, cursor);
    }
    while (cursor !== null) {
      const next = cursor.nextSibling;
      root.removeChild(cursor);
      cursor = next;
    }
  }
}

/**
 * Whether what is drawn for a block still matches: the same block object,
 * the same decoration, no change to a class name it uses, and, if it shows
 * raw source, the same renderer for it.
 */
function isCurrent(
  old: Drawn,
  block: Block,
  decoration: Decoration,
  ctx: RenderContext,
  changed: ReadonlySet<MdSlot> | null,
): boolean {
  if (old.block !== block) return false;
  if (old.decoration.selected !== decoration.selected) return false;
  if (old.decoration.placeholder !== decoration.placeholder) return false;
  const showsRaw = old.slots.has('raw') || old.slots.has('atom');
  if (showsRaw && old.raw !== ctx.raw) return false;
  return changed === null || ![...old.slots].some((slot) => changed.has(slot));
}

/** The slots whose class name differs between two `classNames` values. */
function changedSlots(a: MdClassNames, b: MdClassNames): ReadonlySet<MdSlot> {
  const changed = new Set<MdSlot>();
  for (const slot of slotsOf(a, b)) if (a[slot] !== b[slot]) changed.add(slot);
  return changed;
}

function slotsOf(a: MdClassNames, b: MdClassNames): ReadonlySet<MdSlot> {
  const slots = new Set<MdSlot>();
  for (const names of [a, b]) {
    for (const key of Object.keys(names)) if (isSlotOf(names, key)) slots.add(key);
  }
  return slots;
}

function isSlotOf(names: MdClassNames, key: string): key is MdSlot {
  return Object.prototype.hasOwnProperty.call(names, key);
}

function build(node: DomNode, document: Document): Node {
  switch (node.kind) {
    case 'text':
      return document.createTextNode(node.text);
    case 'html':
      return sanitize(node.html, document);
    case 'element': {
      const element = document.createElement(node.tag);
      for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value);
      for (const child of node.children) element.appendChild(build(child, document));
      return element;
    }
    default:
      return assertNever(node);
  }
}

/**
 * The renderer for raw source in a document. Raw source renders against the
 * document's link definitions, so the renderer is replaced only when the
 * raw blocks themselves change: then every block showing raw source is
 * redrawn, and otherwise none is. Rendering a raw block costs a parse, which
 * is why it is not redone on every keystroke.
 */
export class RawSource {
  #blocks: readonly Block[] = [];
  #renderer: RawRenderer | null = null;

  for(blocks: readonly Block[]): RawRenderer {
    const raws = blocks.filter((block) => block.type === 'raw');
    const same = raws.length === this.#blocks.length && raws.every((b, i) => b === this.#blocks[i]);
    if (this.#renderer === null || !same) {
      this.#blocks = raws;
      this.#renderer = rawRenderer(blocks);
    }
    return this.#renderer;
  }
}
