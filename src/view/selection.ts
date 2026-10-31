import {
  assertNever,
  normalizeSelection,
  sameSelection,
  selectionTransaction,
  textSelection,
  type Doc,
  type EditorState,
  type Pos,
  type Selection,
  type Transaction,
} from '../core/internal';

/** Whether `ancestor` is an ancestor of (or the same as) `node`. */
function isAncestorOrSelf(ancestor: Node, node: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parentNode;
  }
  return false;
}

/**
 * Counts the model positions that a DOM node contributes.
 * Text nodes contribute their length; atom spans contribute 1; <br> 0.
 */
function countPositions(node: Node): number {
  if (node instanceof Text) return node.length;
  if (!(node instanceof Element)) return 0;
  if (node.hasAttribute('data-atom')) return 1;
  if (node.nodeName === 'BR') return 0;
  let total = 0;
  for (const child of node.childNodes) total += countPositions(child);
  return total;
}

/**
 * Converts a DOM position (targetNode, targetOffset) inside a block element to a model offset.
 * Walks the block tree counting positions until reaching the target.
 */
function domToOffset(blockEl: Element, targetNode: Node, targetOffset: number): number {
  let pos = 0;

  function countChildren(container: Node, upTo: number): void {
    let i = 0;
    for (const child of container.childNodes) {
      if (i >= upTo) break;
      pos += countPositions(child);
      i++;
    }
  }

  function find(container: Node): boolean {
    if (container === targetNode) {
      countChildren(container, targetOffset);
      return true;
    }
    for (const child of container.childNodes) {
      if (child === targetNode) {
        if (child instanceof Text) {
          pos += targetOffset;
        } else {
          countChildren(child, targetOffset);
        }
        return true;
      }
      if (child instanceof Element && child.hasAttribute('data-atom')) {
        if (isAncestorOrSelf(child, targetNode)) return true; // inside non-editable atom
        pos += 1;
        continue;
      }
      if (child instanceof Element && isAncestorOrSelf(child, targetNode)) {
        return find(child);
      }
      pos += countPositions(child);
    }
    return false;
  }

  find(blockEl);
  return pos;
}

/**
 * Converts a model offset inside a block element to a DOM position (node, offset)
 * suitable for `setBaseAndExtent`. Atoms use (parent, childIndex) to avoid
 * placing the cursor inside a non-editable element.
 */
function offsetToDOM(blockEl: Element, offset: number): { node: Node; offset: number } {
  // Empty block: only a <br>, cursor goes before it.
  if (offset === 0 && blockEl.firstChild?.nodeName === 'BR') {
    return { node: blockEl, offset: 0 };
  }

  let remaining = offset;

  function walk(container: Element): { node: Node; offset: number } | null {
    let childIdx = 0;
    for (const child of container.childNodes) {
      if (child instanceof Text) {
        const len = child.length;
        if (remaining <= len) return { node: child, offset: remaining };
        remaining -= len;
      } else if (child instanceof Element) {
        if (child.hasAttribute('data-atom')) {
          if (remaining === 0) return { node: container, offset: childIdx };
          remaining -= 1;
          if (remaining === 0) return { node: container, offset: childIdx + 1 };
        } else if (child.nodeName !== 'BR') {
          const result = walk(child);
          if (result !== null) return result;
        }
      }
      childIdx++;
    }
    return null;
  }

  return walk(blockEl) ?? { node: blockEl, offset: blockEl.childNodes.length };
}

/**
 * Walks up from `node` to find the nearest ancestor with `data-block-id`
 * that is a child of `root`. Returns null if none is found.
 */
function blockOf(root: Element, node: Node): Element | null {
  let current: Node | null = node;
  while (current !== null && current !== root) {
    if (current instanceof Element && current.hasAttribute('data-block-id')) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Converts a DOM anchor/focus point to a model `Pos`, or null when outside `root`.
 */
function pointToPos(root: Element, node: Node, offset: number): Pos | null {
  const blockEl = blockOf(root, node);
  if (blockEl === null) return null;
  const blockId = blockEl.getAttribute('data-block-id');
  if (blockId === null) return null;
  return { blockId, offset: domToOffset(blockEl, node, offset) };
}

/**
 * Reads the current window selection and converts it to a model selection.
 * Returns null when the selection is empty, outside `root`, or on a
 * non-editable element (block/gap — those are visual only).
 */
export function readSelection(root: Element, doc: Doc): Selection | null {
  const win = root.ownerDocument.defaultView;
  if (win === null) return null;
  const windowSel = win.getSelection();
  if (windowSel === null || windowSel.rangeCount === 0) return null;
  const anchorNode = windowSel.anchorNode;
  const focusNode = windowSel.focusNode;
  if (anchorNode === null || focusNode === null) return null;
  if (!root.contains(anchorNode)) return null;

  const anchor = pointToPos(root, anchorNode, windowSel.anchorOffset);
  if (anchor === null) return null;

  const focus = pointToPos(root, focusNode, windowSel.focusOffset);
  if (focus === null) return null;

  return normalizeSelection(doc, textSelection(anchor, focus));
}

/**
 * Pushes the model selection into the DOM. Does nothing when the DOM
 * selection already matches (idempotent — no self-event filter needed).
 *
 * Block and gap selections are represented visually (data-selected, gap widget);
 * they do not set a DOM text selection.
 */
export function syncSelection(root: Element, state: EditorState): void {
  const win = root.ownerDocument.defaultView;
  if (win === null) return;
  const windowSel = win.getSelection();
  if (windowSel === null) return;

  const { selection } = state;
  switch (selection.kind) {
    case 'text': {
      const anchorBlock = root.querySelector(`[data-block-id="${selection.anchor.blockId}"]`);
      const focusBlock = root.querySelector(`[data-block-id="${selection.focus.blockId}"]`);
      if (anchorBlock === null || focusBlock === null) return;
      const anchor = offsetToDOM(anchorBlock, selection.anchor.offset);
      const focus = offsetToDOM(focusBlock, selection.focus.offset);
      if (
        windowSel.anchorNode === anchor.node &&
        windowSel.anchorOffset === anchor.offset &&
        windowSel.focusNode === focus.node &&
        windowSel.focusOffset === focus.offset
      )
        return;
      windowSel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
      break;
    }
    case 'block':
    case 'gap':
      if (windowSel.rangeCount > 0) windowSel.removeAllRanges();
      break;
    default:
      assertNever(selection);
  }
}

/**
 * Converts a `StaticRange` from `InputEvent.getTargetRanges()` to model
 * positions. Returns null when either endpoint falls outside `root` or on a
 * non-text element.
 */
export function staticRangeToPos(
  root: Element,
  range: StaticRange,
): { readonly from: Pos; readonly to: Pos } | null {
  const from = pointToPos(root, range.startContainer, range.startOffset);
  const to = pointToPos(root, range.endContainer, range.endOffset);
  if (from === null || to === null) return null;
  return { from, to };
}

/**
 * Builds a selection-only transaction from the current DOM selection.
 * Returns null when the DOM selection is outside `root` or unchanged.
 */
export function selectionFromDOM(root: Element, state: EditorState): Transaction | null {
  const sel = readSelection(root, state.doc);
  if (sel === null) return null;
  if (sameSelection(state.selection, sel)) return null;
  return selectionTransaction(state, sel);
}
