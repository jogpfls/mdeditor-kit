import { assertNever } from '../lang';
import { isTextBlock, marksAt, text as textRun, type Block, type Mark } from '../model';
import type { EditorState, TextSelection, Transaction } from '../state';
import { Draft } from '../transform';
import {
  caretAt,
  deleteRange,
  deleteSelection,
  finish,
  gapIndex,
  insertBlocksAt,
  type Command,
  type CommandEnv,
} from './command';
import { insertFragmentAt } from './fragment';

const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Types text at the selection, replacing what is selected. The text takes the
 * stored marks, or else the marks of the content before it (see `marksAt`).
 * Text holding line breaks becomes several blocks, since one line is one
 * block. With a block selected, the text goes into a new paragraph after
 * that block; at a gap, into a new paragraph there.
 */
export const insertText: Command<{ readonly text: string }> = (state, { text }, env) => {
  if (text === '') return null;
  const { selection } = state;
  const lines = text.split(LINE_BREAK);
  switch (selection.kind) {
    case 'text':
      return typeIntoText(state, selection, lines, env);
    case 'block': {
      const draft = new Draft(state.doc);
      const index = draft.indexOf(selection.blockId);
      if (index < 0) return null;
      const at = insertBlocksAt(draft, index + 1, paragraphs(lines, state.storedMarks ?? [], env));
      return finish(state, draft, at, 'typing');
    }
    case 'gap': {
      const draft = new Draft(state.doc);
      const at = insertBlocksAt(
        draft,
        gapIndex(draft, selection),
        paragraphs(lines, state.storedMarks ?? [], env),
      );
      return finish(state, draft, at, 'typing');
    }
    default:
      return assertNever(selection);
  }
};

function typeIntoText(
  state: EditorState,
  selection: TextSelection,
  lines: readonly string[],
  env: CommandEnv,
): Transaction | null {
  const { draft, at } = deleteSelection(state, selection, env);
  const target = draft.at(at.blockId);
  if (target === null || !isTextBlock(target.block)) return null;
  const marks = state.storedMarks ?? marksAt(target.block.content, at.offset);
  const [only] = lines;
  if (lines.length > 1 || only === undefined) {
    const caret = insertFragmentAt(draft, at, paragraphs(lines, marks, env), env);
    return finish(state, draft, caretAt(caret.blockId, caret.offset), 'typing');
  }
  draft.apply({
    type: 'replaceText',
    blockId: at.blockId,
    from: at.offset,
    to: at.offset,
    content: [textRun(only, marks)],
  });
  return finish(state, draft, caretAt(at.blockId, at.offset + only.length), 'typing');
}

/** One paragraph per line, each with the given marks. Ids are fresh. */
function paragraphs(lines: readonly string[], marks: readonly Mark[], env: CommandEnv): Block[] {
  return lines.map((line): Block => ({
    id: env.createId(),
    type: 'paragraph',
    content: line === '' ? [] : [textRun(line, marks)],
  }));
}

/**
 * Deletes the range the browser chose for a deletion (`getTargetRanges()`),
 * so a grapheme made of several code units goes as one.
 */
export const deleteTargetRange: Command<{
  readonly from: { readonly blockId: string; readonly offset: number };
  readonly to: { readonly blockId: string; readonly offset: number };
}> = (state, { from, to }, env) => {
  if (from.blockId === to.blockId && from.offset === to.offset) return null;
  const draft = new Draft(state.doc);
  const at = deleteRange(draft, from, to, env);
  return finish(state, draft, caretAt(at.blockId, at.offset), 'typing');
};
