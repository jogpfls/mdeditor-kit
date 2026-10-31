import type {
  Code,
  Html,
  List,
  Nodes,
  PhrasingContent,
  PhrasingContentMap,
  Root,
  RootContent,
  RootContentMap,
} from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFootnoteFromMarkdown } from 'mdast-util-gfm-footnote';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmFootnote } from 'micromark-extension-gfm-footnote';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { assertNever } from '../lang';
import {
  MAX_INDENT,
  isHeadingLevel,
  normalizeContent,
  normalizeDoc,
  text,
  idCounter,
  type Block,
  type CreateId,
  type Doc,
  type Inline,
  type Mark,
  type MarkType,
} from '../model';
import { HTML_BLOCK_STARTS } from './syntax';

/**
 * Where a flow node sits: at the top level, in a quote, or in a list item.
 * A plain line becomes a block of the container's type.
 */
type Container =
  | { readonly type: 'paragraph' }
  | { readonly type: 'quote' }
  | { readonly type: 'bullet'; readonly indent: number }
  | { readonly type: 'ordered'; readonly indent: number; readonly start?: number };

const ROOT: Container = { type: 'paragraph' };
const QUOTE: Container = { type: 'quote' };

const LINE_ENDING = /\r\n|\r|\n/g;
const HAS_LINE_ENDING = /[\r\n]/;
const WHITESPACE_ONLY = /^\s*$/u;

type Context = {
  readonly source: string;
  readonly createId: CreateId;
  /** The link each definition label stands for, by its normalized label. */
  readonly definitions: ReadonlyMap<string, Mark>;
};

/**
 * Reads markdown into a document. What the model can represent so that
 * writing it back renders the same becomes blocks and marks; the rest is kept
 * as its source, so nothing is lost or flattened (decision D2):
 *
 * - Soft line breaks join a paragraph's lines with a space. A hard break
 *   starts a new block (see the canonical exceptions).
 * - Links and reference links become link marks. Images, inline HTML and
 *   footnote references become atoms holding their source, as does a mark
 *   nested inside the same mark.
 * - A quote of paragraphs becomes quote blocks, one per paragraph. A list
 *   becomes list items when every item is a line of text followed by nested
 *   lists, no deeper than `MAX_INDENT`, and it is not a task list.
 * - Anything else at the top level (code blocks, HTML blocks, tables,
 *   definitions, footnotes, headings below level 4, and quotes or lists the
 *   model cannot represent) becomes a raw block holding its source.
 *
 * Block ids come from `createId`, by default a counter of this call's own.
 */
export function parseMarkdown(markdown: string, createId: CreateId = idCounter()): Doc {
  const tree = readTree(markdown);
  const context: Context = { source: markdown, createId, definitions: definitionsOf(tree) };
  const blocks = tree.children.flatMap(
    (node) => flow(node.type, node, ROOT, context) ?? [rawBlock(node, context)],
  );
  return normalizeDoc({ blocks }, createId);
}

/** The markdown's syntax tree, read with the GFM extensions the editor knows. */
export function readTree(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfmStrikethrough(), gfmTable(), gfmTaskListItem(), gfmFootnote()],
    mdastExtensions: [
      gfmStrikethroughFromMarkdown(),
      gfmTableFromMarkdown(),
      gfmTaskListItemFromMarkdown(),
      gfmFootnoteFromMarkdown(),
    ],
  });
}

// ---------------------------------------------------------------------------
// Flow: one rule per mdast node type. A rule returns `null` when the model
// cannot represent the node in that container; the top-level node around it
// then becomes a raw block.

type FlowRule<N> = (node: N, container: Container, context: Context) => Block[] | null;

const FLOW: { readonly [T in keyof RootContentMap]: FlowRule<RootContentMap[T]> } = {
  paragraph: (node, container, context) =>
    inlineLines(node.children, context)?.map((line) => lineBlock(line, container, context)) ?? null,
  heading: (node, container, context) => {
    const level = node.depth;
    if (container.type !== 'paragraph' || !isHeadingLevel(level)) return null;
    return (
      inlineLines(node.children, context)?.map((content): Block => ({
        id: context.createId(),
        type: 'heading',
        level,
        content,
      })) ?? null
    );
  },
  blockquote: (node, container, context) => {
    if (container.type !== 'paragraph') return null;
    if (node.children.length === 0) return [lineBlock([], QUOTE, context)];
    const blocks: Block[] = [];
    for (const child of node.children) {
      const lines = child.type === 'paragraph' ? flow(child.type, child, QUOTE, context) : null;
      if (lines === null) return null;
      blocks.push(...lines);
    }
    return blocks;
  },
  list: (node, container, context) =>
    container.type === 'paragraph' ? listBlocks(node, 0, context) : null,
  thematicBreak: (_node, container, context) =>
    container.type === 'paragraph' ? [{ id: context.createId(), type: 'divider' }] : null,
  // Kept as source wherever they appear.
  code: unrepresentable,
  html: unrepresentable,
  definition: unrepresentable,
  table: unrepresentable,
  footnoteDefinition: unrepresentable,
  yaml: unrepresentable,
  // Never flow content; kept as source should a parser ever put one there.
  listItem: unrepresentable,
  tableRow: unrepresentable,
  tableCell: unrepresentable,
  break: unrepresentable,
  delete: unrepresentable,
  emphasis: unrepresentable,
  footnoteReference: unrepresentable,
  image: unrepresentable,
  imageReference: unrepresentable,
  inlineCode: unrepresentable,
  link: unrepresentable,
  linkReference: unrepresentable,
  strong: unrepresentable,
  text: unrepresentable,
};

function unrepresentable(): null {
  return null;
}

/** Applies the rule for a node's type. Generic in the type, so the rule and the node agree. */
function flow<K extends keyof RootContentMap>(
  type: K,
  node: RootContentMap[K],
  container: Container,
  context: Context,
): Block[] | null {
  return FLOW[type](node, container, context);
}

/**
 * A list's items at `depth`, or `null` when the model cannot represent the
 * list: a task list, an item holding anything but a line of text followed by
 * nested lists, or nesting deeper than `MAX_INDENT`. Only the first item keeps
 * the list's start number.
 */
function listBlocks(list: List, depth: number, context: Context): Block[] | null {
  if (depth > MAX_INDENT) return null;
  const blocks: Block[] = [];
  for (const [index, item] of list.children.entries()) {
    if (typeof item.checked === 'boolean') return null;
    const container: Container =
      list.ordered === true
        ? { type: 'ordered', indent: depth, ...(index === 0 ? startOf(list) : {}) }
        : { type: 'bullet', indent: depth };
    const [head, ...rest] = item.children;
    const lines = itemLines(head, container, context);
    blocks.push(...(lines ?? [lineBlock([], container, context)]));
    for (const child of lines === null ? item.children : rest) {
      const nested = child.type === 'list' ? listBlocks(child, depth + 1, context) : null;
      if (nested === null) return null;
      blocks.push(...nested);
    }
  }
  return blocks;
}

/**
 * The item's own line: its first paragraph, or a one-line HTML block, which
 * in a tight list renders just as an atom holding it would. `null` when the
 * item starts with anything else.
 */
function itemLines(
  head: RootContent | undefined,
  container: Container,
  context: Context,
): Block[] | null {
  if (head?.type === 'paragraph') return flow(head.type, head, container, context);
  if (head?.type === 'html' && !HAS_LINE_ENDING.test(head.value)) {
    return [lineBlock([{ type: 'raw', source: head.value, marks: [] }], container, context)];
  }
  return null;
}

function startOf(list: List): { readonly start?: number } {
  return typeof list.start === 'number' ? { start: list.start } : {};
}

function lineBlock(content: readonly Inline[], container: Container, context: Context): Block {
  const id = context.createId();
  switch (container.type) {
    case 'paragraph':
    case 'quote':
      return { id, type: container.type, content };
    case 'bullet':
      return { id, type: container.type, indent: container.indent, content };
    case 'ordered':
      return container.start === undefined
        ? { id, type: container.type, indent: container.indent, content }
        : { id, type: container.type, indent: container.indent, start: container.start, content };
    default:
      return assertNever(container);
  }
}

// ---------------------------------------------------------------------------
// Raw blocks

/**
 * A top-level node kept as its source. Two kinds are rewritten so that they
 * render the same but stay self-contained when other blocks follow them: an
 * indented code block becomes a fenced one (indented code after a list would
 * join the list), and a fenced code block or HTML block left open at the end
 * of the document is closed.
 */
function rawBlock(node: RootContent, context: Context): Block {
  return { id: context.createId(), type: 'raw', source: rawSource(node, context) };
}

function rawSource(node: RootContent, context: Context): string {
  const source = lineSourceOf(node, context);
  switch (node.type) {
    case 'code':
      return closedCode(node, source);
    case 'html':
      return closedHtml(node, source);
    case 'paragraph':
    case 'heading':
    case 'blockquote':
    case 'list':
    case 'thematicBreak':
    case 'definition':
    case 'table':
    case 'footnoteDefinition':
    case 'yaml':
    case 'listItem':
    case 'tableRow':
    case 'tableCell':
    case 'break':
    case 'delete':
    case 'emphasis':
    case 'footnoteReference':
    case 'image':
    case 'imageReference':
    case 'inlineCode':
    case 'link':
    case 'linkReference':
    case 'strong':
    case 'text':
      return source;
    default:
      return assertNever(node);
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** A fence is at least three characters. */
const MIN_FENCE = 3;

function closedCode(node: Code, source: string): string {
  const opening = FENCE.exec(source)?.[1];
  if (opening === undefined) {
    const longest = Math.max(0, ...(node.value.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(longest + 1, MIN_FENCE));
    return `${fence}\n${node.value}\n${fence}`;
  }
  const lines = source.split(LINE_ENDING);
  const last = lines.length > 1 ? lines[lines.length - 1] : undefined;
  const closing = last === undefined ? undefined : FENCE.exec(last)?.[1];
  const closes =
    closing !== undefined &&
    closing[0] === opening[0] &&
    closing.length >= opening.length &&
    last?.trim() === closing;
  // The source of a fence left open ends at the end of the document, line ending included.
  return closes ? source : `${source.replace(/(?:\r\n|\r|\n)$/, '')}\n${opening}`;
}

/**
 * An HTML block that only ends at a marker (CommonMark kinds 1 to 5), closed
 * if it was left open at the end of the document: otherwise it would swallow
 * whatever is written after it.
 */
function closedHtml(node: Html, source: string): string {
  for (const kind of HTML_BLOCK_STARTS) {
    const match = kind.start.exec(node.value);
    if (match === null) continue;
    if (kind.end === null) return source;
    const end = kind.end(match);
    return source.toLowerCase().includes(end.toLowerCase()) ? source : `${source}\n${end}`;
  }
  return source;
}

// ---------------------------------------------------------------------------
// Inline: one rule per mdast phrasing type.

type InlineState = {
  readonly lines: Inline[][];
  /** Set when the content holds something the model cannot represent at all. */
  unrepresentable: boolean;
};

type InlineRule<N> = (
  node: N,
  marks: readonly Mark[],
  state: InlineState,
  context: Context,
) => void;

const INLINE: { readonly [T in keyof PhrasingContentMap]: InlineRule<PhrasingContentMap[T]> } = {
  text: (node, marks, state) => pushText(node.value, marks, state),
  inlineCode: (node, marks, state) => pushText(node.value, [...marks, { type: 'code' }], state),
  strong: (node, marks, state, context) => nest(node, 'bold', marks, state, context),
  emphasis: (node, marks, state, context) => nest(node, 'italic', marks, state, context),
  delete: (node, marks, state, context) => nest(node, 'strike', marks, state, context),
  link: (node, marks, state, context) => {
    // A link without text has nothing to carry its mark: it stays source.
    if (node.children.length === 0) return pushAtom(sourceOf(node, context), marks, state);
    children(node.children, [...marks, linkMark(node.url, node.title)], state, context);
  },
  linkReference: (node, marks, state, context) => {
    // CommonMark only reads a reference whose label is defined, so this finds one.
    const link = context.definitions.get(node.identifier);
    if (link === undefined) return pushAtom(sourceOf(node, context), marks, state);
    children(node.children, [...marks, link], state, context);
  },
  image: (node, marks, state, context) => pushAtom(sourceOf(node, context), marks, state),
  imageReference: (node, marks, state, context) => pushAtom(sourceOf(node, context), marks, state),
  footnoteReference: (node, marks, state, context) =>
    pushAtom(sourceOf(node, context), marks, state),
  html: (node, marks, state) => pushAtom(node.value, marks, state),
  break: (_node, _marks, state) => {
    state.lines.push([]);
  },
};

function inline<K extends keyof PhrasingContentMap>(
  type: K,
  node: PhrasingContentMap[K],
  marks: readonly Mark[],
  state: InlineState,
  context: Context,
): void {
  INLINE[type](node, marks, state, context);
}

function children(
  nodes: readonly PhrasingContent[],
  marks: readonly Mark[],
  state: InlineState,
  context: Context,
): void {
  for (const node of nodes) inline(node.type, node, marks, state, context);
}

type MarkNode = Extract<PhrasingContent, { type: 'strong' | 'emphasis' | 'delete' }>;

/**
 * A mark's content. A mark holding the same mark again (`_*a*_`, emphasis in
 * emphasis) cannot be held by the model, which has one mark of a type. Nor
 * can it be kept as an atom: its delimiters may be part of a longer run
 * (`____a_]_`), which reads differently once cut. So the whole block it is in
 * stays source.
 */
function nest(
  node: MarkNode,
  type: Exclude<MarkType, 'link' | 'code'>,
  marks: readonly Mark[],
  state: InlineState,
  context: Context,
): void {
  if (holdsSame(node.children, node.type)) {
    state.unrepresentable = true;
    return;
  }
  children(node.children, [...marks, { type }], state, context);
}

/** Whether any node below is of the given mark node type. */
function holdsSame(nodes: readonly PhrasingContent[], type: MarkNode['type']): boolean {
  return nodes.some(
    (node) => node.type === type || ('children' in node && holdsSame(node.children, type)),
  );
}

/**
 * Splits phrasing content into lines at hard breaks, since one line is one
 * block. A line holding only whitespace is empty. `null` when the content
 * holds something the model cannot represent (see `nest`).
 */
function inlineLines(nodes: readonly PhrasingContent[], context: Context): Inline[][] | null {
  const state: InlineState = { lines: [[]], unrepresentable: false };
  children(nodes, [], state, context);
  if (state.unrepresentable) return null;
  return state.lines.map((line) => {
    const content = normalizeContent(line);
    return isBlank(content) ? [] : [...content];
  });
}

function isBlank(content: readonly Inline[]): boolean {
  return content.every((piece) => piece.type === 'text' && WHITESPACE_ONLY.test(piece.text));
}

/** Text, with soft line breaks read as the space they render as. */
function pushText(value: string, marks: readonly Mark[], state: InlineState): void {
  state.lines[state.lines.length - 1]?.push(text(value.replace(LINE_ENDING, ' '), marks));
}

function pushAtom(source: string, marks: readonly Mark[], state: InlineState): void {
  state.lines[state.lines.length - 1]?.push({ type: 'raw', source, marks });
}

function linkMark(href: string, title: string | null | undefined): Mark {
  return typeof title === 'string' ? { type: 'link', href, title } : { type: 'link', href };
}

/**
 * The link each definition stands for. The first definition of a label wins,
 * as in CommonMark; labels are compared in mdast's normalized form.
 */
function definitionsOf(tree: Root): ReadonlyMap<string, Mark> {
  const found = new Map<string, Mark>();
  const visit = (node: Nodes) => {
    if (node.type === 'definition' && !found.has(node.identifier)) {
      found.set(node.identifier, linkMark(node.url, node.title));
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  return found;
}

/**
 * The markdown a top-level node was parsed from, from the start of its first
 * line: the indent before it matters (a fence indented by one space strips
 * one space from every line of its code).
 */
function lineSourceOf(node: Nodes, context: Context): string {
  const source = sourceOf(node, context);
  const start = node.position?.start.offset;
  if (start === undefined) return source;
  const lineStart =
    Math.max(
      context.source.lastIndexOf('\n', start - 1),
      context.source.lastIndexOf('\r', start - 1),
    ) + 1;
  const indent = context.source.slice(lineStart, start);
  return /^[ \t]*$/.test(indent) ? indent + source : source;
}

/** The markdown a node was parsed from. */
function sourceOf(node: Nodes, context: Context): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return '';
  return context.source.slice(start, end);
}
