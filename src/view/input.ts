import {
  FORMATS,
  applyInputRules,
  arrowSelection,
  deleteTargetRange,
  exitEmptyBlock,
  indentList,
  insertText,
  isFormat,
  isSafeHref,
  joinBackward,
  joinForward,
  outdentList,
  outdentListAtStart,
  redo,
  resetBlockAtStart,
  selectBlockBackward,
  selectBlockForward,
  selectionTransaction,
  splitBlock,
  toggleFormat,
  undo,
  undoInputRule,
  withTime,
  type CommandEnv,
  type EditorState,
  type FormatSpec,
  type HistoryState,
  type Transaction,
} from '../core/internal';
import { staticRangeToPos } from './selection';
import type { EditorHost } from './types';

/**
 * The env passed to commands: createId from the editor, plus live history for
 * the commands that need it (undo, redo, undoInputRule).
 */
type InputEnv = CommandEnv & { readonly history: HistoryState };

/**
 * A command in an input chain. `input: undefined` matches both `Command<undefined>` (which
 * requires exactly undefined) and undo/redo commands (which accept unknown). The env is the
 * wider `InputEnv` (has both createId and history), satisfying all callers.
 */
type InputCmd = (state: EditorState, input: undefined, env: InputEnv) => Transaction | null;

function makeEnv(host: EditorHost): InputEnv {
  return { ...host.env, history: host.getHistory() };
}

/**
 * Whether the current platform is macOS (or iOS). Used to map `Mod` to
 * Cmd vs Ctrl and to recognise platform-specific key aliases.
 */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

/**
 * Builds a canonical key string from a keyboard event for binding lookup:
 *   Mod, Alt, Shift (when present), then the key (letter → lowercase).
 * `Mod` is Cmd on macOS, Ctrl elsewhere, matching the `Mod-x` shortcut strings in FORMATS.
 */
function keyString(event: KeyboardEvent): string {
  const mod = isMac() ? event.metaKey : event.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  return parts.join('-');
}

const BACKSPACE_CHAIN: ReadonlyArray<InputCmd> = [
  undoInputRule,
  exitEmptyBlock,
  outdentListAtStart,
  resetBlockAtStart,
  joinBackward,
  selectBlockBackward,
];

const DELETE_CHAIN: ReadonlyArray<InputCmd> = [joinForward, selectBlockForward];

/** Returns the first non-null result of the chain, or null. */
function runChain(
  chain: ReadonlyArray<InputCmd>,
  env: InputEnv,
  host: EditorHost,
  time: number,
): Transaction | null {
  const state = host.getState();
  for (const cmd of chain) {
    const tr = cmd(state, undefined, env);
    if (tr !== null) return withTime(tr, time);
  }
  return null;
}

/** Tries deleteTargetRange with `getTargetRanges()`, falls back to chain. */
function runDelete(
  event: InputEvent,
  fallback: ReadonlyArray<InputCmd>,
  root: HTMLElement,
  host: EditorHost,
): void {
  event.preventDefault();
  const env = makeEnv(host);
  const time = event.timeStamp;
  const ranges = event.getTargetRanges();
  const first = ranges[0];
  if (first !== undefined && !first.collapsed) {
    const pos = staticRangeToPos(root, first);
    if (pos !== null) {
      const tr = deleteTargetRange(host.getState(), { from: pos.from, to: pos.to }, env);
      if (tr !== null) {
        host.dispatch(withTime(tr, time));
        return;
      }
    }
  }
  const tr = runChain(fallback, env, host, time);
  if (tr !== null) host.dispatch(tr);
}

/** Builds the key-binding map from FORMATS shortcuts and structural keys. */
function buildBindings(): Map<string, ReadonlyArray<InputCmd>> {
  const map = new Map<string, ReadonlyArray<InputCmd>>();
  for (const name of Object.keys(FORMATS)) {
    if (!isFormat(name)) continue;
    const spec: FormatSpec = FORMATS[name];
    if (spec.shortcut !== undefined) {
      map.set(spec.shortcut, [toggleFormat(name)]);
    }
  }
  map.set('Backspace', BACKSPACE_CHAIN);
  map.set('Delete', DELETE_CHAIN);
  map.set('Tab', [indentList]);
  map.set('Shift-Tab', [outdentList]);
  map.set('Mod-z', [undo]);
  map.set('Mod-Shift-z', [redo]);
  return map;
}

const BINDINGS: Map<string, ReadonlyArray<InputCmd>> = buildBindings();

/** Returns the element with `data-block-id` that contains `node`. */
function blockElOf(root: HTMLElement, node: Node): Element | null {
  let current: Node | null = node;
  while (current !== null && current !== root) {
    if (current instanceof Element && current.hasAttribute('data-block-id')) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Attaches DOM input event listeners to `root`.
 * Call `detach()` to remove them (on destroy or remount).
 */
export function createInputHandler(host: EditorHost): {
  attach(root: HTMLElement): void;
  detach(): void;
} {
  let attached: HTMLElement | null = null;
  /**
   * Set when Escape was just pressed; next Tab moves focus (D5). Cleared on
   * any other key.
   */
  let afterEsc = false;

  function onBeforeInput(event: Event): void {
    if (!(event instanceof InputEvent)) return;
    const root = attached;
    if (root === null) return;
    const env = makeEnv(host);
    const time = event.timeStamp;

    switch (event.inputType) {
      case 'insertText': {
        event.preventDefault();
        const text = event.data ?? '';
        if (text === '') return;
        const tr = insertText(host.getState(), { text }, env);
        if (tr === null) return;
        host.dispatch(withTime(tr, time));
        const ruleTr = applyInputRules(host.getState(), env);
        if (ruleTr !== null) host.dispatch(ruleTr);
        return;
      }
      case 'insertParagraph': {
        event.preventDefault();
        const chain: ReadonlyArray<InputCmd> = [exitEmptyBlock, splitBlock];
        const tr = runChain(chain, env, host, time);
        if (tr !== null) host.dispatch(tr);
        return;
      }
      case 'deleteContentBackward': {
        runDelete(event, BACKSPACE_CHAIN, root, host);
        return;
      }
      case 'deleteContentForward': {
        runDelete(event, DELETE_CHAIN, root, host);
        return;
      }
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward': {
        runDelete(event, BACKSPACE_CHAIN, root, host);
        return;
      }
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward': {
        runDelete(event, DELETE_CHAIN, root, host);
        return;
      }
      case 'insertCompositionText':
        return;
      default:
        event.preventDefault();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const key = keyString(event);

    if (key === 'Escape') {
      afterEsc = true;
      return;
    }

    if (key === 'Tab' && afterEsc) {
      afterEsc = false;
      return; // let browser move focus; do not run indentList
    }
    afterEsc = false;

    // Flush any pending DOM selection into the model. selectionchange can fire
    // asynchronously after pointer/key events; the synchronous dispatchEvent
    // ensures the view's onSelectionChange handler runs before any command.
    attached?.ownerDocument.dispatchEvent(new Event('selectionchange'));

    const state = host.getState();

    let arrowDir: 'backward' | 'forward' | null = null;
    if (key === 'ArrowLeft' || key === 'ArrowUp') arrowDir = 'backward';
    else if (key === 'ArrowRight' || key === 'ArrowDown') arrowDir = 'forward';

    if (arrowDir !== null) {
      const sel = arrowSelection(state, arrowDir);
      if (sel !== null) {
        event.preventDefault();
        host.dispatch(withTime(selectionTransaction(state, sel), event.timeStamp));
      }
      return;
    }

    const chain = BINDINGS.get(key);
    if (chain === undefined) return;
    const env = makeEnv(host);
    const tr = runChain(chain, env, host, event.timeStamp);
    if (tr !== null) {
      event.preventDefault();
      host.dispatch(tr);
    }
  }

  function onMouseDown(event: MouseEvent): void {
    const root = attached;
    if (root === null) return;
    const target = event.target;
    if (!(target instanceof Node)) return;

    const blockEl = blockElOf(root, target);
    if (blockEl === null) return;

    const isContentEditable =
      blockEl.getAttribute('contenteditable') === 'true' ||
      blockEl.getAttribute('contenteditable') === '';

    if (!isContentEditable && blockEl.getAttribute('contenteditable') !== null) {
      const blockId = blockEl.getAttribute('data-block-id');
      if (blockId !== null) {
        event.preventDefault();
        const state = host.getState();
        host.dispatch(selectionTransaction(state, { kind: 'block', blockId }));
      }
    }
  }

  function onClickCapture(event: MouseEvent): void {
    const root = attached;
    if (root === null) return;
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    const href = target.getAttribute('href') ?? '';
    const modKey = isMac() ? event.metaKey : event.ctrlKey;
    if (modKey && isSafeHref(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
    event.preventDefault();
  }

  return {
    attach(root) {
      if (attached !== null) {
        attached.removeEventListener('beforeinput', onBeforeInput);
        attached.removeEventListener('keydown', onKeyDown);
        attached.removeEventListener('mousedown', onMouseDown);
        attached.removeEventListener('click', onClickCapture, true);
      }
      attached = root;
      root.addEventListener('beforeinput', onBeforeInput);
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('mousedown', onMouseDown);
      root.addEventListener('click', onClickCapture, true);
    },
    detach() {
      if (attached === null) return;
      attached.removeEventListener('beforeinput', onBeforeInput);
      attached.removeEventListener('keydown', onKeyDown);
      attached.removeEventListener('mousedown', onMouseDown);
      attached.removeEventListener('click', onClickCapture, true);
      attached = null;
    },
  };
}
