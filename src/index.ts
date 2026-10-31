'use client';

/**
 * The package's main entry: the React components. The editor itself is
 * still to come; `MdViewer` shows a document read-only with the editor's
 * renderer.
 *
 * @packageDocumentation
 */
export { MdViewer, type MdViewerProps } from './react';
export type { MdClassNames, MdSlot } from './editor';
export { FORMATS, isFormat, type Format, type MdJSON } from './core/internal';
