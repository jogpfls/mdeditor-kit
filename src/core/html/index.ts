import { assertNever } from '../lang';
import {
  isListBlock,
  sortMarks,
  type Block,
  type Inline,
  type ListBlock,
  type Mark,
  type MarkType,
} from '../model';
import { rawRenderer, type RawHtmlOptions, type RawRenderer } from '../markdown';
import { isSafeHref } from '../url-policy';

/**
 * The element each mark is written as, from the outside in (`MARK_TYPES`
 * order). The editor's own rendering uses the same elements.
 */
export const MARK_TAGS = {
  link: 'a',
  strike: 's',
  bold: 'strong',
  italic: 'em',
  code: 'code',
} as const satisfies Record<MarkType, string>;

/**
 * The `type` of an ordered list by depth, so a standalone HTML copy keeps the
 * 1 / a / i numbering the editor shows.
 */
const ORDERED_TYPES = ['', 'a', 'i'] as const;

/**
 * Writes blocks as HTML. Text is always escaped. Flat list blocks become
 * nested `ul` and `ol` elements, and an empty text block holds a `<br>` so it
 * keeps its height where it is pasted. A link becomes `a`, with its `href`
 * only when `isSafeHref` allows it.
 *
 * Source the model keeps verbatim (atoms and raw blocks: images, tables, code
 * blocks, HTML) is rendered the way CommonMark renders it (see
 * `rawRenderer`). HTML in it is escaped, so the result is safe to show,
 * unless `allowDangerousHtml` is set; then it is written as it is and must be
 * sanitized by whoever shows it. Source that cannot be rendered on its own (a
 * footnote) is written as escaped text, as it was written.
 */
export function serializeHtml(blocks: readonly Block[], options: RawHtmlOptions = {}): string {
  const raw = rawRenderer(blocks, options);
  let html = '';
  /** The list elements currently open, outermost first. */
  const open: ListBlock[] = [];

  for (const block of blocks) {
    if (!isListBlock(block)) {
      while (open.length > 0) html += closeList(open);
      html += serializeBlock(block, raw);
      continue;
    }
    // A fragment may start inside a nested list; it then nests from the top.
    const depth = Math.min(block.indent, open.length);
    while (open.length > depth + 1) html += closeList(open);
    if (open[depth] !== undefined && open[depth].type !== block.type) html += closeList(open);
    if (open.length === depth + 1) {
      html += '</li>';
    } else {
      open.push(block);
      html += openList(block);
    }
    html += `<li>${inline(block.content, raw)}`;
  }
  while (open.length > 0) html += closeList(open);
  return html;
}

function serializeBlock(block: Block, raw: RawRenderer): string {
  switch (block.type) {
    case 'paragraph':
      return `<p>${inline(block.content, raw)}</p>`;
    case 'heading':
      return `<h${block.level}>${inline(block.content, raw)}</h${block.level}>`;
    case 'quote':
      return `<blockquote>${inline(block.content, raw)}</blockquote>`;
    case 'bullet':
    case 'ordered':
      return `<li>${inline(block.content, raw)}</li>`;
    case 'divider':
      return '<hr>';
    case 'raw':
      return raw.block(block.source) ?? `<p>${escapeHtml(block.source)}</p>`;
    default:
      return assertNever(block);
  }
}

function openList(block: ListBlock): string {
  switch (block.type) {
    case 'bullet':
      return '<ul>';
    case 'ordered': {
      const type = ORDERED_TYPES[block.indent] ?? '';
      const attributes = [
        type === '' ? '' : ` type="${type}"`,
        block.start === undefined ? '' : ` start="${block.start}"`,
      ].join('');
      return `<ol${attributes}>`;
    }
    default:
      return assertNever(block);
  }
}

/** Closes the innermost open list. */
function closeList(open: ListBlock[]): string {
  const list = open.pop();
  if (list === undefined) return '';
  switch (list.type) {
    case 'bullet':
      return '</li></ul>';
    case 'ordered':
      return '</li></ol>';
    default:
      return assertNever(list);
  }
}

function inline(content: readonly Inline[], raw: RawRenderer): string {
  if (content.length === 0) return '<br>';
  return content
    .map((piece) => {
      const marks = sortMarks(piece.marks);
      const opening = marks.map(openTag).join('');
      const closing = [...marks]
        .reverse()
        .map((mark) => `</${MARK_TAGS[mark.type]}>`)
        .join('');
      return opening + inlineBody(piece, raw) + closing;
    })
    .join('');
}

function inlineBody(piece: Inline, raw: RawRenderer): string {
  switch (piece.type) {
    case 'text':
      return escapeHtml(piece.text);
    case 'raw':
      return raw.inline(piece.source) ?? escapeHtml(piece.source);
    default:
      return assertNever(piece);
  }
}

function openTag(mark: Mark): string {
  switch (mark.type) {
    case 'link': {
      const href = isSafeHref(mark.href) ? ` href="${escapeHtml(mark.href)}"` : '';
      const title = mark.title === undefined ? '' : ` title="${escapeHtml(mark.title)}"`;
      return `<a${href}${title}>`;
    }
    case 'strike':
    case 'bold':
    case 'italic':
    case 'code':
      return `<${MARK_TAGS[mark.type]}>`;
    default:
      return assertNever(mark);
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
