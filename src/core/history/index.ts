import { assertNever } from '../lang';
import { ATOM_CHAR, blockContent, contentText, type Doc } from '../model';
import {
  caretOf,
  sameSelection,
  transaction,
  type EditorState,
  type Selection,
  type Transaction,
  type TransactionOrigin,
} from '../state';
import { applySteps, mergeSteps, type Step } from '../transform';

/** One undoable change: possibly several transactions grouped together. */
type Entry = {
  readonly steps: readonly Step[];
  /** Steps that undo `steps`, in the order they apply. */
  readonly inverse: readonly Step[];
  readonly selectionBefore: Selection;
  readonly selectionAfter: Selection;
  /** Typing that later typing may join, or `null`. */
  readonly typing: { readonly blockId: string; readonly time: number | null } | null;
};

export type HistoryOptions = {
  /** How many entries undo keeps; older ones are dropped. */
  readonly depth: number;
  /** A pause longer than this (ms) between keystrokes starts a new entry. */
  readonly groupDelay: number;
};

const DEFAULT_OPTIONS: HistoryOptions = { depth: 100, groupDelay: 500 };

export type HistoryState = {
  readonly done: readonly Entry[];
  readonly undone: readonly Entry[];
  /** The origin of the last transaction that counted (see `recordTransaction`). */
  readonly lastOrigin: TransactionOrigin | null;
  readonly options: HistoryOptions;
};

export function createHistory(options: Partial<HistoryOptions> = {}): HistoryState {
  return { done: [], undone: [], lastOrigin: null, options: { ...DEFAULT_OPTIONS, ...options } };
}

/**
 * Observes a transaction applied to `before`.
 *
 * Changes to the document are recorded as entries. Typing (and IME
 * composition) in one block extends the previous entry until one of these
 * ends the group:
 *
 * - anything else happens: a transaction of another origin, or a selection
 *   transaction that actually moves the selection (one that leaves it where
 *   it was is not an event and is ignored);
 * - a word starts: a letter or digit is typed right after whitespace or
 *   punctuation;
 * - the pause since the previous keystroke is longer than `groupDelay`, by
 *   the times the view stamps on transactions (core reads no clock);
 * - the typing replaces a selection.
 *
 * An input rule always gets an entry of its own. Extending an entry merges
 * the new steps into its last one, so it costs the same for every keystroke.
 * Only the last `depth` entries are kept.
 */
export function recordTransaction(
  history: HistoryState,
  before: EditorState,
  tr: Transaction,
): HistoryState {
  switch (tr.origin) {
    case 'selection':
      if (sameSelection(before.selection, tr.selection)) return history;
      return { ...history, lastOrigin: tr.origin };
    case 'undo':
      return move(history, 'done', 'undone', tr.origin);
    case 'redo':
      return move(history, 'undone', 'done', tr.origin);
    case 'typing':
    case 'composition':
    case 'input-rule':
    case 'command':
    case 'paste':
    case 'cut':
    case 'drop':
      return recordChange(history, before, tr);
    default:
      return assertNever(tr.origin);
  }
}

function recordChange(history: HistoryState, before: EditorState, tr: Transaction): HistoryState {
  if (tr.steps.length === 0) return { ...history, lastOrigin: tr.origin };

  const typingBlock = typingBlockOf(tr);
  const typing = typingBlock === null ? null : { blockId: typingBlock, time: tr.time };
  const previous = history.done[history.done.length - 1];
  const extendsPrevious =
    previous?.typing !== undefined &&
    previous.typing !== null &&
    typingBlock === previous.typing.blockId &&
    isTyping(history.lastOrigin) &&
    !endsGroup(history.options, previous.typing.time, before, tr);

  const entry: Entry =
    extendsPrevious && previous !== undefined
      ? {
          steps: mergeInto(previous.steps, tr.steps, 'append'),
          inverse: mergeInto(previous.inverse, tr.inverse, 'prepend'),
          selectionBefore: previous.selectionBefore,
          selectionAfter: tr.selection,
          typing,
        }
      : {
          steps: tr.steps,
          inverse: tr.inverse,
          selectionBefore: before.selection,
          selectionAfter: tr.selection,
          typing,
        };
  const kept = extendsPrevious ? history.done.slice(0, -1) : history.done;
  const done = [...kept, entry].slice(-history.options.depth);
  return { ...history, done, undone: [], lastOrigin: tr.origin };
}

/** Whether a keystroke starts a new group although it types into the same block. */
function endsGroup(
  options: HistoryOptions,
  lastTime: number | null,
  before: EditorState,
  tr: Transaction,
): boolean {
  if (caretOf(before.selection) === null) return true;
  if (lastTime !== null && tr.time !== null && tr.time - lastTime > options.groupDelay) return true;
  return startsWord(before.doc, tr.steps[0]);
}

const WORD = /[\p{L}\p{N}\p{M}]/u;
const BREAK = /[\s\p{P}\p{S}]/u;

/** Whether a step types a letter or digit right after whitespace or punctuation. */
function startsWord(doc: Doc, step: Step | undefined): boolean {
  if (step?.type !== 'replaceText' || step.from !== step.to) return false;
  const typed = contentText(step.content).slice(0, 1);
  const block = doc.blocks.find((candidate) => candidate.id === step.blockId);
  const previous = contentText(block === undefined ? [] : (blockContent(block) ?? [])).charAt(
    step.from - 1,
  );
  return WORD.test(typed) && previous !== ATOM_CHAR && BREAK.test(previous);
}

/**
 * Adds steps to an entry's list, merging neighbours where one continues the
 * other. `append` adds after (forward steps); `prepend` adds before (inverses,
 * which apply newest first).
 */
function mergeInto(
  existing: readonly Step[],
  added: readonly Step[],
  where: 'append' | 'prepend',
): readonly Step[] {
  switch (where) {
    case 'append': {
      const last = existing[existing.length - 1];
      const [first, ...rest] = added;
      const merged = last === undefined || first === undefined ? null : mergeSteps(last, first);
      return merged === null
        ? [...existing, ...added]
        : [...existing.slice(0, -1), merged, ...rest];
    }
    case 'prepend': {
      const head = existing[0];
      const tail = added[added.length - 1];
      const merged = head === undefined || tail === undefined ? null : mergeSteps(tail, head);
      return merged === null
        ? [...added, ...existing]
        : [...added.slice(0, -1), merged, ...existing.slice(1)];
    }
    default:
      return assertNever(where);
  }
}

/** The block a typing transaction changed, or `null` if it may not join a group. */
function typingBlockOf(tr: Transaction): string | null {
  if (!isTyping(tr.origin)) return null;
  const blocks = new Set(tr.steps.map(textChangeBlock));
  const [only] = blocks;
  return blocks.size === 1 && only !== undefined ? only : null;
}

/** The block a step changes the text of, or `null` for a step that changes structure. */
function textChangeBlock(step: Step): string | null {
  switch (step.type) {
    case 'replaceText':
      return step.blockId;
    case 'replaceBlocks':
    case 'addMark':
    case 'removeMark':
    case 'setBlockKind':
      return null;
    default:
      return assertNever(step);
  }
}

function isTyping(origin: TransactionOrigin | null): boolean {
  return origin === 'typing' || origin === 'composition';
}

function move(
  history: HistoryState,
  from: 'done' | 'undone',
  to: 'done' | 'undone',
  origin: TransactionOrigin,
): HistoryState {
  const entry = history[from][history[from].length - 1];
  if (entry === undefined) return history;
  return {
    ...history,
    [from]: history[from].slice(0, -1),
    [to]: [...history[to], entry].slice(-history.options.depth),
    lastOrigin: origin,
  };
}

/** The origin of the last transaction that counted, for `undoInputRule`. */
export function lastOrigin(history: HistoryState): TransactionOrigin | null {
  return history.lastOrigin;
}

type HistoryEnv = { readonly history: HistoryState };

/** Undoes the last entry, restoring the selection from before it. */
export function undo(state: EditorState, _input: unknown, env: HistoryEnv): Transaction | null {
  const entry = env.history.done[env.history.done.length - 1];
  if (entry === undefined) return null;
  return transaction(applySteps(state.doc, entry.inverse), entry.selectionBefore, 'undo');
}

/** Redoes the last undone entry, restoring the selection from after it. */
export function redo(state: EditorState, _input: unknown, env: HistoryEnv): Transaction | null {
  const entry = env.history.undone[env.history.undone.length - 1];
  if (entry === undefined) return null;
  return transaction(applySteps(state.doc, entry.steps), entry.selectionAfter, 'redo');
}
