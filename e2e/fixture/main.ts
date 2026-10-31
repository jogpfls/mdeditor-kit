import { createEditor } from '../../src/editor';
import { serializeMarkdown } from '../../src/core/internal';

const editor = createEditor({ defaultValue: 'Hello **world**\n\n---\n\nAnother paragraph.' });

const root = document.getElementById('editor');
if (root instanceof HTMLElement) {
  root.setAttribute('contenteditable', 'true');
  root.setAttribute('role', 'textbox');
  root.setAttribute('aria-multiline', 'true');
  editor.mount(root);
}

const stateEl = document.getElementById('state');
function showState(state: ReturnType<typeof editor.getState>): void {
  if (stateEl instanceof HTMLElement) {
    stateEl.textContent = serializeMarkdown(state.doc.blocks);
  }
  const selInfo = `${state.selection.kind}:${JSON.stringify(state.selection)}`;
  const dbg = document.getElementById('debug-sel');
  if (dbg instanceof HTMLElement) dbg.textContent = selInfo;
}
showState(editor.getState());
editor.subscribe((_, next) => {
  showState(next);
});
