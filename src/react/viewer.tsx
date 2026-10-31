import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import type { MdJSON } from '../core/internal';
import { createViewer, type MdClassNames } from '../editor';

type Source =
  | { readonly markdown: string; readonly json?: never }
  | { readonly json: MdJSON; readonly markdown?: never };

export type MdViewerProps = Source & {
  /** Class names for the parts of the document, the same slots the editor has. */
  readonly classNames?: MdClassNames;
} & Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'dangerouslySetInnerHTML'>;

/**
 * Shows a document read-only, drawn by the editor's own renderer: the same
 * CSS variables, class name slots and classes make it look exactly like the
 * editor. It renders an empty `div` that the viewer fills once mounted.
 */
export function MdViewer({ markdown, json, classNames, ...props }: MdViewerProps) {
  const root = useRef<HTMLDivElement>(null);
  const [viewer] = useState(() => createViewer());

  useEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    viewer.mount(element);
    return () => viewer.destroy();
  }, [viewer]);

  useEffect(() => {
    viewer.show(json === undefined ? { markdown: markdown ?? '' } : { json });
  }, [viewer, markdown, json]);

  useEffect(() => {
    viewer.configure(classNames === undefined ? {} : { classNames });
  }, [viewer, classNames]);

  return <div {...props} ref={root} />;
}
