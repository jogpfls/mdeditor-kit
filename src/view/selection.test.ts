import { describe, expect, test } from 'vitest';
import {
  createState,
  parseMarkdown,
  rawRenderer,
  textSelection,
  type EditorState,
  type Selection,
} from '../core/internal';
import { Renderer } from './render';
import { readSelection, selectionFromDOM, syncSelection } from './selection';

/** Renders a state into a div attached to document.body and returns the root. */
function render(state: EditorState): HTMLElement {
  const root = document.createElement('div');
  root.setAttribute('contenteditable', 'true');
  const renderer = new Renderer(root);
  renderer.render(state, {
    classNames: {},
    placeholder: null,
    raw: rawRenderer(state.doc.blocks),
  });
  document.body.appendChild(root);
  return root;
}

function makeState(md: string, selection?: Selection): EditorState {
  const base = createState(parseMarkdown(md));
  return selection === undefined ? base : { ...base, selection };
}

function firstBlock(state: EditorState): string {
  const block = state.doc.blocks[0];
  if (block === undefined) throw new Error('document has no blocks');
  return block.id;
}

describe('syncSelection', () => {
  test('sets DOM selection for a text caret', () => {
    const state = makeState('hello world');
    const root = render(state);
    const blockId = firstBlock(state);
    const sel = textSelection({ blockId, offset: 5 });
    syncSelection(root, { ...state, selection: sel });
    const back = readSelection(root, state.doc);
    expect(back).toEqual(sel);
  });

  test('sets a range selection spanning characters', () => {
    const state = makeState('hello world');
    const root = render(state);
    const blockId = firstBlock(state);
    const sel = textSelection({ blockId, offset: 0 }, { blockId, offset: 5 });
    syncSelection(root, { ...state, selection: sel });
    const back = readSelection(root, state.doc);
    expect(back).toEqual(sel);
  });

  test('clears DOM selection for a block selection', () => {
    const state = makeState('---');
    const root = render(state);
    const blockId = firstBlock(state);
    syncSelection(root, { ...state, selection: { kind: 'block', blockId } });
    const domSel = window.getSelection();
    expect(domSel?.rangeCount).toBe(0);
  });

  test('is idempotent: second call does not move the anchor node', () => {
    const state = makeState('hello');
    const root = render(state);
    const blockId = firstBlock(state);
    const sel = textSelection({ blockId, offset: 2 });
    syncSelection(root, { ...state, selection: sel });
    const anchorBefore = window.getSelection()?.anchorNode;
    syncSelection(root, { ...state, selection: sel });
    expect(window.getSelection()?.anchorNode).toBe(anchorBefore);
  });

  test('places cursor at offset 0 in an empty block', () => {
    const state = makeState('');
    const root = render(state);
    const blockId = firstBlock(state);
    const sel = textSelection({ blockId, offset: 0 });
    syncSelection(root, { ...state, selection: sel });
    const back = readSelection(root, state.doc);
    expect(back).toEqual(sel);
  });
});

describe('readSelection', () => {
  test('returns null when selection is outside root', () => {
    const state = makeState('hello');
    const root = render(state);
    const other = document.createElement('p');
    other.textContent = 'outside';
    document.body.appendChild(other);
    const textNode = other.firstChild;
    if (textNode === null) throw new Error('no text node');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    expect(readSelection(root, state.doc)).toBeNull();
  });

  test('reads a caret position correctly', () => {
    const state = makeState('hello world');
    const root = render(state);
    const blockId = firstBlock(state);
    const sel = textSelection({ blockId, offset: 3 });
    syncSelection(root, { ...state, selection: sel });
    expect(readSelection(root, state.doc)).toEqual(sel);
  });

  test('reads a range across two blocks', () => {
    const state = makeState('first\n\nsecond');
    const root = render(state);
    const blocks = state.doc.blocks;
    const b0 = blocks[0];
    const b1 = blocks[1];
    if (b0 === undefined || b1 === undefined) throw new Error('missing blocks');
    const sel = textSelection({ blockId: b0.id, offset: 2 }, { blockId: b1.id, offset: 3 });
    syncSelection(root, { ...state, selection: sel });
    expect(readSelection(root, state.doc)).toEqual(sel);
  });
});

describe('selectionFromDOM', () => {
  test('returns null when DOM selection matches model', () => {
    const state = makeState('hello');
    const root = render(state);
    syncSelection(root, state);
    expect(selectionFromDOM(root, state)).toBeNull();
  });

  test('returns a transaction when DOM selection differs from model', () => {
    const state = makeState('hello');
    const root = render(state);
    const blockId = firstBlock(state);
    const moved = textSelection({ blockId, offset: 3 });
    syncSelection(root, { ...state, selection: moved });
    const tr = selectionFromDOM(root, state);
    expect(tr).not.toBeNull();
    expect(tr?.selection).toEqual(moved);
  });
});
