/**
 * The names each package entry exports, values and types alike. Changing this
 * list is changing the public API: removing or renaming a name is a breaking
 * change, and adding one is a promise to keep it.
 */
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

function exportedNames(entry: string): string[] {
  const file = fileURLToPath(new URL(entry, import.meta.url));
  const program = ts.createProgram([file], { strict: true, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  if (module === undefined) throw new Error(`${entry} is not a module`);
  return checker
    .getExportsOfModule(module)
    .map((symbol) => symbol.getName())
    .sort();
}

test('. exports exactly these names', () => {
  expect(exportedNames('../../src/index.ts')).toEqual([
    'FORMATS',
    'Format',
    'MdClassNames',
    'MdJSON',
    'MdSlot',
    'MdViewer',
    'MdViewerProps',
    'isFormat',
  ]);
});

test('./core exports exactly these names', () => {
  expect(exportedNames('../../src/core/index.ts')).toEqual([
    'Block',
    'Doc',
    'HEADING_LEVELS',
    'HeadingLevel',
    'Inline',
    'InlineAtom',
    'MARK_TYPES',
    'MAX_INDENT',
    'Mark',
    'MarkType',
    'MdJSON',
    'SCHEMA_VERSION',
    'SchemaError',
    'StoredBlock',
    'TextRun',
    'fromJSON',
    'listNumbers',
    'parseMarkdown',
    'serializeHtml',
    'serializeMarkdown',
    'toJSON',
  ]);
});
