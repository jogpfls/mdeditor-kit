import {
  type CommandEnv,
  type EditorState,
  type HistoryState,
  type Transaction,
} from '../core/internal';

/** The interface the view calls back into: the editor provides this. */
export type EditorHost = {
  getState(): EditorState;
  dispatch(tr: Transaction): void;
  /** Live history snapshot, read by input commands that need it (undo, redo, undoInputRule). */
  getHistory(): HistoryState;
  /** Stable env for running commands: createId bound to this editor's id counter. */
  readonly env: CommandEnv;
};
