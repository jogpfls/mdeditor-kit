/**
 * Blocks and positions written by hand for tests, and a readable description
 * of a document. Depends on the model only, so every module's tests may use it.
 * Not part of the package.
 */
import { assertNever } from '../lang';
import {
  blockContent,
  text as textRun,
  type Block,
  type Doc,
  type HeadingLevel,
  type Inline,
  type Mark,
  type Pos,
  type TextRun,
} from '.';

const plain = (text: string): TextRun[] => (text === '' ? [] : [textRun(text)]);

export const p = (id: string, text = ''): Block => ({
  id,
  type: 'paragraph',
  content: plain(text),
});

export const h = (id: string, level: HeadingLevel, text = ''): Block => ({
  id,
  type: 'heading',
  level,
  content: plain(text),
});

export const quote = (id: string, text = ''): Block => ({
  id,
  type: 'quote',
  content: plain(text),
});

export const item = (id: string, type: 'bullet' | 'ordered', indent: number, text = ''): Block => ({
  id,
  type,
  indent,
  content: plain(text),
});

export const hr = (id: string): Block => ({ id, type: 'divider' });

export const at = (blockId: string, offset: number): Pos => ({ blockId, offset });

/** The document as readable lines, e.g. `h1 제목`, `bullet1 **굵게**`. */
export function lines(doc: Doc): string[] {
  return doc.blocks.map(describe);
}

/** How a mark opens and closes in `lines`: markdown-like, but readable rather than exact. */
function signs(mark: Mark): readonly [string, string] {
  switch (mark.type) {
    case 'link':
      return ['[', `](${mark.href}${mark.title === undefined ? '' : ` "${mark.title}"`})`];
    case 'strike':
      return ['~~', '~~'];
    case 'bold':
      return ['**', '**'];
    case 'italic':
      return ['_', '_'];
    case 'code':
      return ['`', '`'];
    default:
      return assertNever(mark);
  }
}

function describeInline(inline: Inline): string {
  const body = ((): string => {
    switch (inline.type) {
      case 'text':
        return inline.text;
      case 'raw':
        return `{${inline.source}}`;
      default:
        return assertNever(inline);
    }
  })();
  const open = inline.marks.map((mark) => signs(mark)[0]).join('');
  const close = [...inline.marks]
    .reverse()
    .map((mark) => signs(mark)[1])
    .join('');
  return open + body + close;
}

function describe(block: Block): string {
  const prefix = blockPrefix(block);
  const content = blockContent(block);
  if (content === null) return prefix;
  return `${prefix} ${content.map(describeInline).join('')}`.trimEnd();
}

/** `h1`, `bullet0`, `ordered1`, `ordered0@3` (an ordered item starting at 3), `raw <source>`. */
function blockPrefix(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `h${block.level}`;
    case 'bullet':
      return `${block.type}${block.indent}`;
    case 'ordered':
      return `${block.type}${block.indent}${block.start === undefined ? '' : `@${block.start}`}`;
    case 'raw':
      return `raw ${block.source}`;
    case 'paragraph':
    case 'quote':
    case 'divider':
      return block.type;
    default:
      return assertNever(block);
  }
}
