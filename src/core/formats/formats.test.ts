import { expect, test } from 'vitest';
import { FORMATS, isFormat } from '.';

test('every FORMATS key is a format, and nothing else is', () => {
  for (const key of Object.keys(FORMATS)) expect(isFormat(key)).toBe(true);
  for (const value of ['paragraph', 'toString', 'constructor', '', 1, null, undefined]) {
    expect(isFormat(value)).toBe(false);
  }
});
