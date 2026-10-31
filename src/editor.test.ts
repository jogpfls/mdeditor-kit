import { describe, expect, test, vi } from 'vitest';
import {
  selectionTransaction,
  textSelection,
  toJSON,
  type EditorState,
  type Transaction,
} from './core/internal';
import { createEditor } from './editor';

describe('createEditor', () => {
  test('creates an editor with an empty document', () => {
    const editor = createEditor();
    const state = editor.getState();
    expect(state.doc.blocks).toHaveLength(1);
    expect(state.doc.blocks[0]?.type).toBe('paragraph');
  });

  test('creates an editor from a markdown string', () => {
    const editor = createEditor({ defaultValue: '# Hello\n\nWorld' });
    const state = editor.getState();
    expect(state.doc.blocks).toHaveLength(2);
    expect(state.doc.blocks[0]?.type).toBe('heading');
  });

  test('creates an editor from JSON', () => {
    const src = createEditor({ defaultValue: '# Title' });
    const json = toJSON(src.getState().doc);
    const editor = createEditor({ defaultJSON: json });
    const state = editor.getState();
    expect(state.doc.blocks[0]?.type).toBe('heading');
  });
});

describe('dispatch', () => {
  test('applies a transaction and updates state', () => {
    const editor = createEditor({ defaultValue: 'hello' });
    const state = editor.getState();
    const blockId = state.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    const sel = textSelection({ blockId, offset: 2 });
    const tr = selectionTransaction(state, sel);
    editor.dispatch(tr);
    expect(editor.getState().selection).toEqual(sel);
  });

  test('notifies all subscribers', () => {
    const editor = createEditor({ defaultValue: 'hello' });
    const state = editor.getState();
    const blockId = state.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    const listener1 = vi.fn<(p: EditorState, n: EditorState) => void>();
    const listener2 = vi.fn<(p: EditorState, n: EditorState) => void>();
    editor.subscribe(listener1);
    editor.subscribe(listener2);
    const tr = selectionTransaction(state, textSelection({ blockId, offset: 1 }));
    editor.dispatch(tr);
    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  test('notifies with correct prev and next state', () => {
    const editor = createEditor({ defaultValue: 'test' });
    const prev = editor.getState();
    const blockId = prev.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    let capturedPrev: EditorState | undefined;
    let capturedNext: EditorState | undefined;
    editor.subscribe((p, n) => {
      capturedPrev = p;
      capturedNext = n;
    });
    const tr = selectionTransaction(prev, textSelection({ blockId, offset: 2 }));
    editor.dispatch(tr);
    expect(capturedPrev).toBe(prev);
    expect(capturedNext).toBe(editor.getState());
  });
});

describe('subscribe / unsubscribe', () => {
  test('unsubscribe stops future notifications', () => {
    const editor = createEditor({ defaultValue: 'hello' });
    const state = editor.getState();
    const blockId = state.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    const listener = vi.fn<(p: EditorState, n: EditorState) => void>();
    const unsub = editor.subscribe(listener);
    unsub();
    const tr = selectionTransaction(state, textSelection({ blockId, offset: 1 }));
    editor.dispatch(tr);
    expect(listener).not.toHaveBeenCalled();
  });

  test('unsubscribing one listener does not affect others', () => {
    const editor = createEditor({ defaultValue: 'hello' });
    const state = editor.getState();
    const blockId = state.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    const a = vi.fn<(p: EditorState, n: EditorState) => void>();
    const b = vi.fn<(p: EditorState, n: EditorState) => void>();
    const unsub = editor.subscribe(a);
    editor.subscribe(b);
    unsub();
    const tr = selectionTransaction(state, textSelection({ blockId, offset: 1 }));
    editor.dispatch(tr);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
});

describe('mount and destroy', () => {
  test('mount renders state into DOM root', () => {
    const editor = createEditor({ defaultValue: 'hello world' });
    const root = document.createElement('div');
    document.body.appendChild(root);
    editor.mount(root);
    expect(root.querySelector('[data-block-id]')).not.toBeNull();
    editor.destroy();
    expect(root.childElementCount).toBe(0);
  });

  test('destroy clears listeners so no future notifications fire', () => {
    const editor = createEditor();
    const listener = vi.fn<(p: EditorState, n: EditorState) => void>();
    editor.subscribe(listener);
    editor.destroy();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('dispatch type check', () => {
  test('Transaction type is accepted by dispatch', () => {
    const editor = createEditor();
    const state = editor.getState();
    const blockId = state.doc.blocks[0]?.id;
    if (blockId === undefined) throw new Error('no block');
    const tr: Transaction = selectionTransaction(state, textSelection({ blockId, offset: 0 }));
    editor.dispatch(tr);
    expect(editor.getState().selection.kind).toBe('text');
  });
});
