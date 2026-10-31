import { expect, test } from 'vitest';
import { isSafeHref } from '.';

test.each([
  'https://example.com',
  'http://example.com/a?b',
  'HTTPS://EXAMPLE.COM',
  'mailto:a@example.com',
  '/relative/path',
  '../up',
  '#section',
  '?q=1',
  '//example.com/protocol-relative',
  '',
])('%j may be a live link', (href) => {
  expect(isSafeHref(href)).toBe(true);
});

test.each([
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  '  javascript:alert(1)',
  '\u0001javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox',
  'file:///etc/passwd',
])('%j may not', (href) => {
  expect(isSafeHref(href)).toBe(false);
});
