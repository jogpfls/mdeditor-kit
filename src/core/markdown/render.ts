import type { Nodes } from 'mdast';
import { micromark } from 'micromark';
import { gfmStrikethrough, gfmStrikethroughHtml } from 'micromark-extension-gfm-strikethrough';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import { gfmTaskListItem, gfmTaskListItemHtml } from 'micromark-extension-gfm-task-list-item';
import type { Block } from '../model';
import { readTree } from './parse';

export type RawHtmlOptions = {
  /**
   * Writes HTML that is in the document (`<kbd>`, `<details>`, an HTML block)
   * as it is, instead of as escaped text. The editor does not sanitize it:
   * whoever shows the result must, or it can run script on their page.
   */
  readonly allowDangerousHtml?: boolean;
};

/**
 * Renders the source the model keeps verbatim. Each returns `null` for
 * source that cannot be rendered on its own, which is then written as text.
 */
export type RawRenderer = {
  readonly block: (source: string) => string | null;
  readonly inline: (source: string) => string | null;
};

/**
 * A renderer for the raw blocks and atoms of one document, the way CommonMark
 * with GFM tables, task lists and strikethrough renders them (micromark).
 * Addresses that could run script (`javascript:` …) are dropped, and HTML in
 * the source is escaped unless `allowDangerousHtml` says otherwise.
 *
 * Reference links and images in the source resolve against the document's
 * link definitions, which are raw blocks of their own: every piece is
 * rendered with all of them before it, which render as nothing. Footnotes
 * cannot be rendered one piece at a time (a reference and its definition make
 * one section at the end of a page), so a piece holding one is `null`.
 */
export function rawRenderer(blocks: readonly Block[], options: RawHtmlOptions = {}): RawRenderer {
  const definitions = blocks
    .flatMap((block) => (block.type === 'raw' && isDefinitions(block.source) ? [block.source] : []))
    .join('\n\n');
  const render = (source: string): string | null => {
    if (holdsFootnote(readTree(source))) return null;
    return micromark(definitions === '' ? source : `${definitions}\n\n${source}`, {
      extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem()],
      htmlExtensions: [gfmStrikethroughHtml(), gfmTableHtml(), gfmTaskListItemHtml()],
      allowDangerousHtml: options.allowDangerousHtml === true,
      allowDangerousProtocol: false,
    });
  };
  return {
    block: render,
    inline: (source) => {
      const html = render(source);
      return html === null ? null : unwrapParagraph(html);
    },
  };
}

function isDefinitions(source: string): boolean {
  const { children } = readTree(source);
  return children.length > 0 && children.every((node) => node.type === 'definition');
}

function holdsFootnote(node: Nodes): boolean {
  if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference') return true;
  return 'children' in node && node.children.some(holdsFootnote);
}

const PARAGRAPH = /^<p>([\s\S]*)<\/p>$/;

/** Inline source renders as a paragraph of its own; its content is what goes inline. */
function unwrapParagraph(html: string): string {
  const trimmed = html.trim();
  return PARAGRAPH.exec(trimmed)?.[1] ?? trimmed;
}
