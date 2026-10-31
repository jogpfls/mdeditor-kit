/**
 * A minimal editor loop over commands, for tests. Modules above commands
 * extend it through hooks (recording history, running input rules after
 * typing). Not part of the package: only test files import it.
 */
import { counter } from '../model/arbitrary.test-support';
import { lines } from '../model/fixtures.test-support';
import type { Block, Pos } from '../model';
import {
  applyTransaction,
  normalizeSelection,
  selectionTransaction,
  textSelection,
  type Selection,
  type EditorState,
  type Transaction,
} from '../state';
import { insertText, type CommandEnv } from '.';

/** A command that takes no input, the shape of every chain entry. */
export type Plain<E> = (state: EditorState, input: undefined, env: E) => Transaction | null;

export type Hooks<E extends CommandEnv> = {
  /** The environment commands receive, built around the id generator. */
  readonly env: (createId: () => string) => E;
  /** Sees every transaction just before it applies. */
  readonly observe?: (before: EditorState, tr: Transaction) => void;
  /** Runs after each typed character, the way the view runs input rules. */
  readonly afterType?: (state: EditorState, env: E) => Transaction | null;
};

/** An editor over `blocks` whose commands get only `createId`. */
export function editor(blocks: readonly Block[], anchor: Pos, focus: Pos = anchor) {
  return harness(blocks, anchor, focus, { env: (createId) => ({ createId }) });
}

export function harness<E extends CommandEnv>(
  blocks: readonly Block[],
  anchor: Pos,
  focus: Pos,
  hooks: Hooks<E>,
) {
  const doc = { blocks };
  let state: EditorState = {
    doc,
    selection: normalizeSelection(doc, textSelection(anchor, focus)),
    storedMarks: null,
  };
  const env = hooks.env(counter('n'));

  const dispatch = (tr: Transaction) => {
    hooks.observe?.(state, tr);
    state = applyTransaction(state, tr);
  };

  /** Runs a command; returns whether it applied. */
  function run(command: (state: EditorState, env: E) => Transaction | null): boolean {
    const tr = command(state, env);
    if (tr === null) return false;
    dispatch(tr);
    return true;
  }

  return {
    get state() {
      return state;
    },
    env,
    dispatch,
    run,
    /** Runs a chain: the first command that applies wins. Returns its index, or -1. */
    chain(commands: readonly Plain<E>[]): number {
      return commands.findIndex((command) => run((current, e) => command(current, undefined, e)));
    },
    /** Runs a command that takes no input. */
    exec(command: Plain<E>): boolean {
      return run((current, e) => command(current, undefined, e));
    },
    /** Types text one character at a time. */
    type(text: string) {
      for (const char of text) {
        run((current, e) => insertText(current, { text: char }, e));
        const after = hooks.afterType?.(state, env) ?? null;
        if (after !== null) dispatch(after);
      }
    },
    select(anchorPos: Pos, focusPos: Pos = anchorPos) {
      dispatch(selectionTransaction(state, textSelection(anchorPos, focusPos)));
    },
    /** Selects anything: a block, a gap, or text. The selection is normalized. */
    setSelection(selection: Selection) {
      dispatch(selectionTransaction(state, selection));
    },
    /** The caret's position; throws when the selection is not a caret, since a test expected one. */
    caret(): Pos {
      const { selection } = state;
      if (selection.kind !== 'text')
        throw new Error(`Expected a caret, found a ${selection.kind} selection`);
      return selection.focus;
    },
    lines(): string[] {
      return lines(state.doc);
    },
  };
}
