import { isSafeHref } from '../../core/internal';

/** Whether an attribute value may be written. */
type AttributeRule = (value: string) => boolean;

const ANY: AttributeRule = () => true;
const URL: AttributeRule = isSafeHref;
const ALIGN: AttributeRule = (value) => value === 'left' || value === 'right' || value === 'center';
const NUMBER: AttributeRule = (value) => /^\d{1,9}$/.test(value);
const LANGUAGE: AttributeRule = (value) => /^language-[\w+#.-]+$/.test(value);
const FLAG: AttributeRule = (value) => value === '';

/**
 * Every element and attribute micromark writes for CommonMark with GFM
 * tables, task lists and strikethrough, with HTML in the source escaped (see
 * `rawRenderer`). Nothing else is built: an element not listed is dropped
 * and its content kept (a script or a style goes with its content), an attribute not listed is dropped, and an address
 * is kept only when the URL policy allows it.
 */
const ALLOWED: Readonly<Record<string, Readonly<Record<string, AttributeRule>>>> = {
  p: {},
  h1: {},
  h2: {},
  h3: {},
  h4: {},
  h5: {},
  h6: {},
  blockquote: {},
  ul: {},
  ol: { start: NUMBER },
  li: {},
  pre: {},
  code: { class: LANGUAGE },
  hr: {},
  br: {},
  em: {},
  strong: {},
  del: {},
  a: { href: URL, title: ANY },
  img: { src: URL, alt: ANY, title: ANY },
  table: {},
  thead: {},
  tbody: {},
  tr: {},
  th: { align: ALIGN },
  td: { align: ALIGN },
  input: { type: (value) => value === 'checkbox', checked: FLAG, disabled: FLAG },
};

/**
 * Builds rendered raw source as DOM without ever handing the string to the
 * DOM as markup: the parser only reads it, and the nodes are created anew
 * from the allow list. Scripts in the parsed copy never run, and nothing of
 * it is inserted.
 */
export function sanitize(html: string, document: Document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  appendChildren(parsed.body, fragment, document);
  return fragment;
}

function appendChildren(from: Node, to: Node, document: Document): void {
  for (const child of Array.from(from.childNodes)) {
    if (child instanceof Text) {
      to.appendChild(document.createTextNode(child.data));
    } else if (child instanceof Element) {
      appendElement(child, to, document);
    }
  }
}

/** Elements whose content is not text to show, dropped with it. */
const DROPPED: ReadonlySet<string> = new Set(['script', 'style', 'template', 'noscript']);

function appendElement(source: Element, to: Node, document: Document): void {
  const tag = source.tagName.toLowerCase();
  if (DROPPED.has(tag)) return;
  const rules = ALLOWED[tag];
  if (rules === undefined) {
    appendChildren(source, to, document);
    return;
  }
  const element = document.createElement(tag);
  for (const { name, value } of Array.from(source.attributes)) {
    const rule = rules[name];
    if (rule !== undefined && rule(value)) element.setAttribute(name, value);
  }
  appendChildren(source, element, document);
  to.appendChild(element);
}
