import { type EditorState } from '../core/internal';
import { RawSource, Renderer, type MdClassNames } from './render';
import { createInputHandler } from './input';
import { selectionFromDOM, syncSelection } from './selection';
import { type EditorHost } from './types';

/** Id of the visually hidden Esc→Tab hint used as aria-describedby on the input. */
const ESC_TAB_HINT_ID = 'md-esc-tab-hint';

/**
 * Inserts a visually hidden paragraph near `root` that describes the Esc→Tab
 * focus-move shortcut, and wires `root`'s aria-describedby to it.
 * Idempotent: re-uses an existing hint in the same document.
 */
function ensureEscTabHint(root: HTMLElement): void {
  const doc = root.ownerDocument;
  if (doc.getElementById(ESC_TAB_HINT_ID) === null) {
    const hint = doc.createElement('p');
    hint.id = ESC_TAB_HINT_ID;
    hint.setAttribute(
      'style',
      'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0',
    );
    hint.textContent = 'Press Escape then Tab to move focus out of the editor.';
    doc.body.appendChild(hint);
  }
  const current = root.getAttribute('aria-describedby') ?? '';
  if (!current.split(' ').includes(ESC_TAB_HINT_ID)) {
    root.setAttribute(
      'aria-describedby',
      current.length > 0 ? `${current} ${ESC_TAB_HINT_ID}` : ESC_TAB_HINT_ID,
    );
  }
}

/** How a view draws, apart from the state. Compared by value, so passing a new object each time is fine. */
export type ViewOptions = {
  readonly classNames?: MdClassNames;
  readonly placeholder?: string;
};

/**
 * A view that only shows a state: the renderer and nothing else, no input,
 * no selection. `MdViewer` uses it, so a read-only document looks exactly
 * like the editor.
 */
export type ReadonlyView = {
  /** Starts drawing into `root`, which the view owns until `destroy`. */
  mount(root: HTMLElement): void;
  show(state: EditorState): void;
  configure(options: ViewOptions): void;
  /** Stops drawing and empties the root. The view can be mounted again. */
  destroy(): void;
};

/**
 * The live editor view: renders state, keeps DOM selection in sync, and
 * dispatches selection transactions when the user moves the caret.
 */
export type EditorView = {
  mount(root: HTMLElement): void;
  update(prev: EditorState, next: EditorState): void;
  focus(): void;
  destroy(): void;
};

export function createReadonlyView(options: ViewOptions = {}): ReadonlyView {
  let current = options;
  let state: EditorState | null = null;
  let renderer: Renderer | null = null;
  const raw = new RawSource();

  const draw = () => {
    if (renderer === null || state === null) return;
    renderer.render(state, {
      classNames: current.classNames ?? {},
      placeholder: current.placeholder ?? null,
      raw: raw.for(state.doc.blocks),
    });
  };

  return {
    mount(root) {
      renderer?.clear();
      renderer = new Renderer(root);
      draw();
    },
    show(next) {
      state = next;
      draw();
    },
    configure(next) {
      current = next;
      draw();
    },
    destroy() {
      renderer?.clear();
      renderer = null;
    },
  };
}

export function createEditorView(host: EditorHost, options: ViewOptions = {}): EditorView {
  const current = options;
  let root: HTMLElement | null = null;
  let renderer: Renderer | null = null;
  const raw = new RawSource();
  const input = createInputHandler(host);

  function draw(prev: EditorState, next: EditorState): void {
    if (renderer === null || root === null) return;
    renderer.render(next, {
      classNames: current.classNames ?? {},
      placeholder: current.placeholder ?? null,
      raw: raw.for(next.doc.blocks),
    });
    syncSelection(root, next);
    void prev; // prev available for future use (e.g. scroll-into-view)
  }

  function onSelectionChange(): void {
    if (root === null) return;
    const state = host.getState();
    const win = root.ownerDocument.defaultView;
    if (win === null) return;
    const domSel = win.getSelection();
    if (domSel === null || domSel.rangeCount === 0 || !root.contains(domSel.anchorNode)) return;
    const tr = selectionFromDOM(root, state);
    if (tr !== null) host.dispatch(tr);
  }

  return {
    mount(newRoot) {
      if (root !== null) {
        root.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
        input.detach();
        renderer?.clear();
      }
      root = newRoot;
      renderer = new Renderer(root);
      ensureEscTabHint(root);
      root.ownerDocument.addEventListener('selectionchange', onSelectionChange);
      input.attach(root);
      const state = host.getState();
      draw(state, state);
    },
    update(prev, next) {
      draw(prev, next);
    },
    focus() {
      if (root === null) return;
      root.focus({ preventScroll: true });
      syncSelection(root, host.getState());
    },
    destroy() {
      if (root !== null) {
        root.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
        input.detach();
        renderer?.clear();
        renderer = null;
        root = null;
      }
    },
  };
}
