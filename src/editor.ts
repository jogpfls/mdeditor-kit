'use client';

import {
  applyTransaction,
  createHistory,
  createState,
  fromJSON,
  idCounter,
  parseMarkdown,
  recordTransaction,
  type Doc,
  type EditorState,
  type HistoryState,
  type MdJSON,
  type Transaction,
} from './core/internal';
import {
  createEditorView,
  createReadonlyView,
  type EditorHost,
  type EditorView,
  type ReadonlyView,
  type ViewOptions,
} from './view';

export type { MdClassNames, MdSlot, ViewOptions } from './view';

/** A document to show: markdown, or the JSON storage format (`toJSON`). */
type DocumentSource =
  | { readonly markdown: string; readonly json?: never }
  | { readonly json: MdJSON; readonly markdown?: never };

/**
 * A read-only document on screen: what `MdViewer` drives. It reads its
 * source into a document with ids from its own counter, and draws it with
 * the editor's renderer.
 */
export type Viewer = {
  mount(root: HTMLElement): void;
  show(source: DocumentSource): void;
  configure(options: ViewOptions): void;
  destroy(): void;
};

export function createViewer(options: ViewOptions = {}): Viewer {
  const createId = idCounter();
  const view: ReadonlyView = createReadonlyView(options);
  return {
    mount: (root) => view.mount(root),
    show: (source) => view.show(createState(readDoc(source, createId))),
    configure: (next) => view.configure(next),
    destroy: () => view.destroy(),
  };
}

/** A change listener. */
type StateListener = (prev: EditorState, next: EditorState) => void;

/**
 * The live, writable editor: owns state and history, notifies subscribers,
 * and mounts an `EditorView` when given a DOM root.
 */
export type Editor = {
  /** The current state. */
  getState(): EditorState;
  /** Applies a transaction and notifies subscribers. */
  dispatch(tr: Transaction): void;
  /**
   * Registers a listener for state changes. Returns a function that removes it.
   * Does not fire immediately: the listener gets (prev, next) on the next dispatch.
   */
  subscribe(listener: StateListener): () => void;
  /** Attaches the editor to a DOM element. Detaches from any previous root first. */
  mount(root: HTMLElement, options?: ViewOptions): void;
  /** Detaches from the DOM and clears all listeners. */
  destroy(): void;
  /** Focuses the editor's input area, if mounted. */
  focus(): void;
};

/** What createEditor accepts: an initial document, either as markdown or JSON. */
export type EditorInit =
  | { readonly defaultValue: string; readonly defaultJSON?: never }
  | { readonly defaultJSON: MdJSON; readonly defaultValue?: never }
  | Record<string, never>;

export function createEditor(init: EditorInit = {}): Editor {
  const createId = idCounter();
  const initialDoc =
    'defaultJSON' in init && init.defaultJSON !== undefined
      ? fromJSON(init.defaultJSON, createId)
      : parseMarkdown(
          'defaultValue' in init && init.defaultValue !== undefined ? init.defaultValue : '',
          createId,
        );

  let state: EditorState = createState(initialDoc);
  let history: HistoryState = createHistory();
  let view: EditorView | null = null;
  const listeners = new Set<StateListener>();

  const host: EditorHost = {
    getState: () => state,
    dispatch(tr: Transaction): void {
      const prev = state;
      state = applyTransaction(state, tr);
      history = recordTransaction(history, prev, tr);
      view?.update(prev, state);
      for (const listener of listeners) {
        listener(prev, state);
      }
    },
    getHistory: () => history,
    env: { createId },
  };

  return {
    getState: () => state,
    dispatch: (tr) => host.dispatch(tr),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount(root, options) {
      view?.destroy();
      view = createEditorView(host, options ?? {});
      view.mount(root);
    },
    destroy() {
      view?.destroy();
      view = null;
      listeners.clear();
    },
    focus() {
      view?.focus();
    },
  };
}

/** Reads a source into a document. JSON is checked and migrated; a bad one throws `SchemaError`. */
function readDoc(source: DocumentSource, createId: Parameters<typeof parseMarkdown>[1]): Doc {
  return source.json === undefined
    ? parseMarkdown(source.markdown, createId)
    : fromJSON(source.json, createId);
}
