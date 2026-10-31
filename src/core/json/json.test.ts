import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { Doc } from '../model';
import {
  DENSE_CHARS,
  WIDE_CHARS,
  counter,
  docs,
  withoutIds,
} from '../model/arbitrary.test-support';
import { SCHEMA_VERSION, SchemaError, fromJSON, toJSON } from '.';

const load = (value: unknown) => fromJSON(value, counter('n'));
const viaText = (doc: Doc): unknown => JSON.parse(JSON.stringify(toJSON(doc)));

describe('round trip', () => {
  test('any normalized document survives toJSON, JSON text and fromJSON, apart from its ids', () => {
    fc.assert(
      fc.property(fc.oneof(docs(WIDE_CHARS, 4, 4), docs(DENSE_CHARS, 3, 6)), (doc) => {
        expect(withoutIds(load(viaText(doc)))).toEqual(withoutIds(doc));
      }),
      { numRuns: 500 },
    );
  });

  test('stores no block ids; loading gives every block a new one', () => {
    const doc: Doc = { blocks: [{ id: 'kept-nowhere', type: 'divider' }] };
    expect(JSON.stringify(toJSON(doc))).not.toContain('kept-nowhere');
    expect(load(viaText(doc)).blocks.map((b) => b.id)).toEqual(['n0']);
  });

  test('writes the current schema version', () => {
    expect(toJSON({ blocks: [] }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  test('normalizes what it loads, and ignores an id field', () => {
    const doc = load({
      schemaVersion: 1,
      doc: {
        blocks: [
          { id: 'a', type: 'paragraph', content: [{ type: 'text', text: 'x\ny', marks: [] }] },
          { id: 'a', type: 'divider' },
        ],
      },
    });
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'divider']);
    expect(doc.blocks.map((b) => b.id)).toEqual(['n0', 'n2', 'n1']);
  });
});

describe('rejects what it cannot read, saying where', () => {
  test.each([
    [null, 'json'],
    [{ doc: { blocks: [] } }, 'json.schemaVersion'],
    [{ schemaVersion: 0, doc: { blocks: [] } }, 'json.schemaVersion'],
    [{ schemaVersion: 1.5, doc: { blocks: [] } }, 'json.schemaVersion'],
    [{ schemaVersion: 1, doc: { blocks: {} } }, 'json.doc.blocks'],
    [
      { schemaVersion: 1, doc: { blocks: [{ id: 'a', type: 'table' }] } },
      'json.doc.blocks[0].type',
    ],
    [
      { schemaVersion: 1, doc: { blocks: [{ id: 'a', type: 'heading', level: 7, content: [] }] } },
      'json.doc.blocks[0].level',
    ],
    [
      {
        schemaVersion: 1,
        doc: {
          blocks: [
            {
              id: 'a',
              type: 'paragraph',
              content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }],
            },
          ],
        },
      },
      'json.doc.blocks[0].content[0].marks[0].href',
    ],
  ])('%j fails at %s', (value, path) => {
    expect(() => load(value)).toThrow(SchemaError);
    try {
      load(value);
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      expect(error instanceof SchemaError ? error.path : '').toBe(path);
    }
  });

  test('a newer version is refused rather than guessed at', () => {
    expect(() => load({ schemaVersion: SCHEMA_VERSION + 1, doc: { blocks: [] } })).toThrow(
      /newer release/,
    );
  });
});

test('without an id function, the blocks get ids from a counter of the call', () => {
  const json = toJSON({
    blocks: [
      { id: 'x', type: 'divider' },
      { id: 'y', type: 'divider' },
    ],
  });
  expect(fromJSON(json).blocks.map((b) => b.id)).toEqual(['b0', 'b1']);
});
