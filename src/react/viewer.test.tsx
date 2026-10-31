import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { expect, test } from 'vitest';
import { toJSON, parseMarkdown } from '../core/internal';
import { MdViewer } from './viewer';

test('renders markdown into the DOM', () => {
  render(<MdViewer markdown="**hello**" />);
  expect(document.querySelector('strong')?.textContent).toBe('hello');
});

test('updates when the markdown prop changes', () => {
  const { rerender } = render(<MdViewer markdown="first" />);
  rerender(<MdViewer markdown="second" />);
  expect(document.body.textContent).toContain('second');
  expect(document.body.textContent).not.toContain('first');
});

test('accepts JSON instead of markdown', () => {
  const json = toJSON(parseMarkdown('> quoted'));
  render(<MdViewer json={json} />);
  expect(document.querySelector('blockquote')).not.toBeNull();
});

test('passes extra div props to the container', () => {
  render(<MdViewer markdown="x" data-testid="container" className="my-class" />);
  const el = screen.getByTestId('container');
  expect(el.className).toBe('my-class');
});

test('works in Strict Mode without double-mounting errors', () => {
  expect(() =>
    render(
      <StrictMode>
        <MdViewer markdown="# hi" />
      </StrictMode>,
    ),
  ).not.toThrow();
  expect(document.querySelector('h1')?.textContent).toBe('hi');
});
