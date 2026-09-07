import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('mdeditor-kit entry point', () => {
  it('exposes the package name', () => {
    expect(PACKAGE_NAME).toBe('mdeditor-kit');
  });
});
