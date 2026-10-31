/**
 * The contract for markdown that comes from outside. With f = serialize ∘
 * parse:
 *
 * - idempotence: f(f(md)) === f(md);
 * - same meaning: md and f(md) render to the same HTML, once whitespace and
 *   the documented exceptions are normalized (see `normalize`), both with a
 *   renderer that allows HTML (micromark, GFM) and with one that does not
 *   (markdown-it's defaults).
 *
 * The inputs are every CommonMark spec example, real READMEs (this
 * repository's and those of installed packages), and random markdown.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import spec from 'commonmark-spec';
import fc from 'fast-check';
import MarkdownIt from 'markdown-it';
import { micromark } from 'micromark';
import { gfmFootnote, gfmFootnoteHtml } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { gfmTaskListItem, gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item';
import { describe, expect, test } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '../../src/core';

/** Property tests run thousands of cases; they get more time than the default. */
const PROPERTY_TIMEOUT = 60_000;

const root = resolve(import.meta.dirname, '../..');

function f(markdown: string): string {
  let next = 0;
  return serializeMarkdown(parseMarkdown(markdown, () => `b${next++}`).blocks);
}

const withHtml = (markdown: string) =>
  micromark(markdown, {
    allowDangerousHtml: true,
    extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem(), gfmFootnote()],
    htmlExtensions: [
      gfmStrikethroughHtml(),
      gfmTableHtml(),
      gfmTaskListItemHtml(),
      gfmFootnoteHtml(),
    ],
  });
const markdownIt = new MarkdownIt();
const withoutHtml = (markdown: string) => markdownIt.render(markdown);

/**
 * HTML compared up to what the contract allows to differ. Each rule is a
 * documented exception (docs/markdown.md):
 *
 * - whitespace: runs collapse, whitespace around block tags goes, and U+00A0
 *   counts as whitespace (an empty block is written as `&nbsp;`);
 * - inline content is compared as text with the formats on each character,
 *   not as a tree: the model keeps which marks cover which text, not how
 *   they nest, and neighbouring links to the same address are one link;
 * - whitespace keeps emphasis only where the text on both sides has it, and
 *   a paragraph holding nothing goes (canonical: marks leave edge whitespace,
 *   and a block of only whitespace is empty);
 * - a loose list renders as a tight one (the model does not keep looseness);
 * - neighbouring lists of the same kind, and neighbouring quotes, are one
 *   (the model does not keep where one ends and the next begins; D4);
 * - an HTML block or code fence left open at the end is closed.
 */
function normalize(html: string): string {
  const structural = html
    .replace(/&nbsp;|&#160;|\u00a0/g, ' ')
    .replace(/<li>\s*<p>([\s\S]*?)<\/p>/g, '<li>$1')
    .replace(/\s+/g, ' ')
    .replace(BLOCK_TAG, '$1');
  return flattenInline(structural)
    .replace(BLOCK_TAG, '$1')
    .replace(/<p><\/p>/g, '')
    .replace(/<\/ul><ul>/g, '')
    .replace(/<\/ol><ol(?: start="\d+")?>/g, '')
    .replace(/<\/blockquote><blockquote>/g, '')
    .trim()
    .replace(/\s*(?:<\/(?:pre|script|style|textarea)>|-->|\?>|\]\]>)$/, '');
}

const BLOCK_TAG =
  /\s*(<\/?(?:p|li|ul|ol|blockquote|h[1-6]|pre|hr|table|thead|tbody|tr|th|td|div|section)\b[^>]*>)\s*/g;
const FORMAT_TAG = /^<(\/?)(em|strong|del|s|code|a)\b([^>]*)>$/;
const EMPHASIS = new Set(['em', 'strong', 'del', 's']);

type Char = { readonly char: string; formats: Set<string> };

/**
 * Rewrites inline formatting as runs of text tagged with the formats on
 * them (`⟦em,strong⟧text`), so nesting order and where spans split do not
 * matter. Whitespace keeps an emphasis only when the nearest text on both
 * sides, within the same block, has it too.
 */
function flattenInline(html: string): string {
  const out: string[] = [];
  let chars: Char[] = [];
  const open: string[] = [];
  const flush = () => {
    out.push(runs(trimEdges(chars)));
    chars = [];
  };
  for (const token of html.split(/(<[^>]+>)/)) {
    if (token === '') continue;
    const format = FORMAT_TAG.exec(token);
    if (format !== null) {
      const name = format[2] === 'a' ? `a${format[3] ?? ''}` : (format[2] ?? '');
      if (format[1] === '/') {
        const index = open.map((tag) => tag.replace(/ .*$/, '')).lastIndexOf(format[2] ?? '');
        if (index !== -1) open.splice(index, 1);
      } else {
        open.push(name);
      }
      continue;
    }
    if (token.startsWith('<')) {
      flush();
      out.push(token);
      continue;
    }
    for (const char of token) chars.push({ char, formats: new Set(open) });
  }
  flush();
  return out.join('');
}

function trimEdges(chars: Char[]): Char[] {
  const isSpace = (c: Char | undefined) => c !== undefined && /\s/.test(c.char);
  chars.forEach((c, index) => {
    if (!isSpace(c)) return;
    const neighbour = (step: number) => {
      let i = index + step;
      while (isSpace(chars[i])) i += step;
      return chars[i];
    };
    const before = neighbour(-1);
    const after = neighbour(1);
    for (const format of [...c.formats]) {
      const tag = format.replace(/ .*$/, '');
      if (!EMPHASIS.has(tag)) continue;
      if (before?.formats.has(format) !== true || after?.formats.has(format) !== true) {
        c.formats.delete(format);
      }
    }
  });
  return chars;
}

function runs(chars: readonly Char[]): string {
  let result = '';
  // Plain text carries no marker, so whitespace next to block tags still goes.
  let key = '';
  for (const { char, formats } of chars) {
    const next = [...formats].sort().join(',');
    if (next !== key) {
      result += next === '' ? '⟦⟧' : `⟦${next}⟧`;
      key = next;
    }
    result += char;
  }
  // A format on nothing but whitespace shows nothing: its marker goes, the space stays.
  return result.replace(/\s+/g, ' ').replace(/⟦[^⟧]*⟧(\s*)(?=⟦|$)/g, '$1');
}

/**
 * A hard break splits a block in the model (one line is one block), so a
 * paragraph with one renders as two. Inputs that have one are only held to
 * idempotence. micromark writes a hard break as `<br />`; raw `<br>` HTML is
 * kept as written.
 */
function hasHardBreak(html: string): boolean {
  return html.includes('<br />');
}

/**
 * Whether the markdown holds HTML of its own. A renderer that does not allow
 * HTML shows it as text, and where its lines end depends on HTML block rules
 * that renderer does not apply, so the user's HTML is only held to the same
 * meaning where HTML is allowed (decision D3 is about the supported formats).
 */
function hasHtml(markdown: string): boolean {
  return withHtml(markdown) !== withoutHtmlMicromark(markdown);
}

const withoutHtmlMicromark = (markdown: string) =>
  micromark(markdown, {
    extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem(), gfmFootnote()],
    htmlExtensions: [
      gfmStrikethroughHtml(),
      gfmTableHtml(),
      gfmTaskListItemHtml(),
      gfmFootnoteHtml(),
    ],
  });

function checkContract(markdown: string): void {
  const once = f(markdown);
  expect(f(once), 'f is idempotent').toBe(once);
  if (hasHardBreak(withHtml(markdown))) return;
  // Where the two renderers read markdown free of HTML differently, there
  // is no one meaning to keep (micromark and markdown-it disagree on some
  // edge cases), so only idempotence holds. Markdown with HTML of its own is
  // held to the renderer that allows HTML.
  const renderers = hasHtml(markdown)
    ? [withHtml]
    : normalize(withoutHtml(markdown)) === normalize(withHtml(markdown))
      ? [withHtml, withoutHtml]
      : [];
  for (const render of renderers) {
    expect(normalize(render(once)), `same meaning as\n${markdown}\nwritten as\n${once}`).toBe(
      normalize(render(markdown)),
    );
  }
}

/** The spec's examples, with tabs written as → in the spec turned back into tabs. */
function specExamples() {
  return spec.tests.map((example) => ({
    ...example,
    markdown: example.markdown.replaceAll('→', '\t'),
  }));
}

describe('CommonMark spec examples', () => {
  const examples = specExamples();
  test('are all there', () => {
    expect(examples.length).toBeGreaterThan(600);
  });
  test.each(
    examples.map((example) => [example.number, example.section, example.markdown] as const),
  )('example %i (%s)', (_number, _section, markdown) => checkContract(markdown));
});

const READMES = [
  'README.md',
  'CONTRIBUTING.md',
  'node_modules/fast-check/README.md',
  'node_modules/micromark/README.md',
  'node_modules/mdast-util-from-markdown/README.md',
  'node_modules/eslint/README.md',
  'node_modules/dependency-cruiser/README.md',
  'node_modules/commonmark-spec/README.md',
  'node_modules/prettier/README.md',
  'node_modules/typescript/README.md',
];

describe('real READMEs', () => {
  const found = READMES.filter((path) => existsSync(resolve(root, path)));
  test('are there', () => {
    expect(found.length).toBeGreaterThanOrEqual(5);
  });
  test.each(found)('%s', (path) => checkContract(readFileSync(resolve(root, path), 'utf8')));
});

const PIECES = [
  'a',
  '가',
  ' ',
  '\n',
  '\n\n',
  '*',
  '**',
  '_',
  '__',
  '~~',
  '`',
  '[',
  ']',
  '(',
  ')',
  '#',
  '# ',
  '> ',
  '- ',
  '1. ',
  '3) ',
  '---',
  '\\',
  '&amp;',
  '&nbsp;',
  '<b>',
  '</b>',
  '<!-- c -->',
  '|',
  '![i](s.png)',
  '[l](u)',
  '"',
  '.',
  '은',
];

test(
  'random markdown',
  () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...PIECES), { maxLength: 24 }), (pieces) =>
        checkContract(pieces.join('')),
      ),
      // A fixed seed keeps CI deterministic; explore with more runs and other
      // seeds locally, and pin what turns up in core/markdown/known-gaps.test.ts.
      { numRuns: 3000, seed: 20261031 },
    );
  },
  PROPERTY_TIMEOUT,
);
