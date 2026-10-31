import fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  DENSE_CHARS,
  WIDE_CHARS,
  counter,
  docs,
  withoutIds,
} from '../model/arbitrary.test-support';
import { canonical, parseMarkdown, serializeMarkdown } from '.';

const doc = fc.oneof(docs(WIDE_CHARS, 6, 5), docs(DENSE_CHARS, 3, 10));

const parse = (markdown: string) => parseMarkdown(markdown, counter());
const RUNS = { numRuns: 2000 };
/** Property tests parse thousands of documents; they get more time than the default. */
const TIMEOUT = 60_000;

test(
  'parse(serialize(doc)) equals canonical(doc)',
  () => {
    fc.assert(
      fc.property(doc, (d) => {
        const markdown = serializeMarkdown(d.blocks);
        expect(withoutIds(parse(markdown)), markdown).toEqual(withoutIds(canonical(d)));
      }),
      RUNS,
    );
  },
  TIMEOUT,
);

test(
  'canonical is idempotent',
  () => {
    fc.assert(
      fc.property(doc, (d) => {
        expect(canonical(canonical(d))).toEqual(canonical(d));
      }),
      RUNS,
    );
  },
  TIMEOUT,
);

test(
  'a document and its canonical form serialize the same',
  () => {
    fc.assert(
      fc.property(doc, (d) => {
        expect(serializeMarkdown(canonical(d).blocks)).toBe(serializeMarkdown(d.blocks));
      }),
      RUNS,
    );
  },
  TIMEOUT,
);

test(
  'a document already in canonical form round-trips unchanged',
  () => {
    fc.assert(
      fc.property(doc, (d) => {
        fc.pre(JSON.stringify(canonical(d)) === JSON.stringify(d));
        expect(withoutIds(parse(serializeMarkdown(d.blocks)))).toEqual(withoutIds(d));
      }),
      RUNS,
    );
  },
  TIMEOUT,
);
