/**
 * Measures how core's editing cost grows with document size: each operation
 * runs on documents of 10,000 and 20,000 blocks, and the ratio between the two
 * should stay near 2 (linear). A verification tool, not a CI gate.
 *
 *   npm run bench
 */
import {
  applyInputRules,
  applyTransaction,
  createHistory,
  deleteTargetRange,
  insertFragment,
  insertText,
  isActive,
  parseMarkdown,
  recordTransaction,
  serializeHtml,
  serializeMarkdown,
  splitBlock,
  toggleFormat,
  type Block,
  type EditorState,
  type Transaction,
} from '../src/core/internal';

const SIZES = [10_000, 20_000] as const;
const PASTED = 5_000;
const RUNS = 5;

function makeBlocks(count: number, prefix: string): Block[] {
  return Array.from({ length: count }, (_, i): Block => {
    const id = `${prefix}${i}`;
    const content = [
      { type: 'text' as const, text: `block ${i} plain `, marks: [] },
      { type: 'text' as const, text: 'bold', marks: [{ type: 'bold' as const }] },
    ];
    switch (i % 4) {
      case 0:
        return { id, type: 'heading', level: 2, content };
      case 1:
        return { id, type: 'bullet', indent: 0, content };
      case 2:
        return { id, type: 'bullet', indent: 1, content };
      default:
        return { id, type: 'paragraph', content };
    }
  });
}

function stateOf(
  blocks: readonly Block[],
  anchorId: string,
  anchorOffset: number,
  focusId = anchorId,
  focusOffset = anchorOffset,
): EditorState {
  return {
    doc: { blocks },
    selection: {
      kind: 'text',
      anchor: { blockId: anchorId, offset: anchorOffset },
      focus: { blockId: focusId, offset: focusOffset },
    },
    storedMarks: null,
  };
}

/** Runs the command, applies its transaction and records it, as the editor will. */
function dispatch(state: EditorState, make: (state: EditorState) => Transaction | null) {
  const tr = make(state);
  if (tr === null) throw new Error('command did not apply');
  recordTransaction(createHistory(), state, tr);
  return applyTransaction(state, tr);
}

function time(run: () => void): number {
  run();
  const samples = Array.from({ length: RUNS }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return samples.sort((a, b) => a - b)[Math.floor(RUNS / 2)] ?? 0;
}

const env = (() => {
  let next = 0;
  return { createId: () => `new${next++}` };
})();

/** Parsing `count` blocks of markdown, each written by `line` and joined by `separator`. */
function parsing(count: number, line: (i: number) => string, separator: string): () => void {
  const markdown = Array.from({ length: count }, (_, i) => line(i)).join(separator);
  return () => parseMarkdown(markdown, env.createId);
}

const cases: Record<string, (blocks: readonly Block[]) => () => void> = {
  'select all, italic': (blocks) => () =>
    dispatch(stateOf(blocks, 'b0', 0, `b${blocks.length - 1}`, 4), (s) =>
      toggleFormat('italic')(s, undefined, env),
    ),
  'select all, delete': (blocks) => () =>
    dispatch(stateOf(blocks, 'b0', 0), (s) =>
      deleteTargetRange(
        s,
        { from: { blockId: 'b0', offset: 0 }, to: { blockId: `b${blocks.length - 1}`, offset: 4 } },
        env,
      ),
    ),
  [`paste ${PASTED} blocks`]: (blocks) => {
    const fragment = makeBlocks(PASTED, 'f');
    const middle = `b${Math.floor(blocks.length / 2) + 3}`;
    return () => dispatch(stateOf(blocks, middle, 2), (s) => insertFragment(s, { fragment }, env));
  },
  'one keystroke': (blocks) => {
    const middle = `b${Math.floor(blocks.length / 2) + 3}`;
    return () => {
      const after = dispatch(stateOf(blocks, middle, 2), (s) => insertText(s, { text: 'a' }, env));
      applyInputRules(after, env);
    };
  },
  'is bold active (all)': (blocks) => {
    const state = stateOf(blocks, 'b0', 0, `b${blocks.length - 1}`, 4);
    return () => isActive(state, 'bold');
  },
  'serialize markdown': (blocks) => () => serializeMarkdown(blocks),
  'parse markdown': (blocks) => {
    const markdown = serializeMarkdown(blocks);
    return () => parseMarkdown(markdown, env.createId);
  },
  'serialize HTML': (blocks) => () => serializeHtml(blocks),
  // Parsing by the shape of the markdown: the parser's cost grows with the
  // number of lists and quotes that end with more blocks after them.
  'parse: paragraphs': (blocks) => parsing(blocks.length, (i) => `para ${i}`, '\n\n'),
  'parse: one list': (blocks) => parsing(blocks.length, (i) => `- item ${i}`, '\n'),
  'parse: one quote': (blocks) => parsing(blocks.length, (i) => `> para ${i}`, '\n>\n'),
  'parse: list, para, …': (blocks) =>
    parsing(blocks.length, (i) => (i % 2 === 0 ? `- item ${i}` : `para ${i}`), '\n\n'),
  Enter: (blocks) => {
    const middle = `b${Math.floor(blocks.length / 2) + 3}`;
    return () => dispatch(stateOf(blocks, middle, 2), (s) => splitBlock(s, undefined, env));
  },
};

const rows = Object.entries(cases).map(([name, make]) => {
  const [small, large] = SIZES.map((size) => time(make(makeBlocks(size, 'b'))));
  return { name, small: small ?? 0, large: large ?? 0 };
});

console.log(
  `operation                ${SIZES.map((s) => `${s} blocks`.padStart(14)).join('')}   ratio`,
);
for (const { name, small, large } of rows) {
  console.log(
    `${name.padEnd(24)} ${`${small.toFixed(2)} ms`.padStart(14)}${`${large.toFixed(2)} ms`.padStart(14)}   ${(large / small).toFixed(2)}`,
  );
}
