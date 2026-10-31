/**
 * The full editor loop for tests: dispatching records history, and typing
 * runs input rules after each character, the way the view will. Not part of
 * the package: only test files import it.
 */
import { harness } from '../commands/harness.test-support';
import { createHistory, recordTransaction, type HistoryState } from '../history';
import type { Block, Pos } from '../model';
import { applyInputRules } from '.';

export function editor(blocks: readonly Block[], anchor: Pos, focus: Pos = anchor) {
  let history: HistoryState = createHistory();
  const ed = harness(blocks, anchor, focus, {
    env: (createId) => ({
      createId,
      get history() {
        return history;
      },
    }),
    observe: (before, tr) => {
      history = recordTransaction(history, before, tr);
    },
    afterType: applyInputRules,
  });
  return {
    ...ed,
    get state() {
      return ed.state;
    },
    get history() {
      return history;
    },
  };
}
