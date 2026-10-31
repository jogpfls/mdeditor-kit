import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  // `.` is the React binding, `./core` the framework-free editor model.
  entry: { index: 'src/index.ts', core: 'src/core/index.ts' },
  // ESM only: the markdown parser packages are ESM-only themselves.
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'es2022',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  async onSuccess() {
    // React Server Components: prepend 'use client' to the index entry only.
    // The banner option in tsup/rollup drops module-level directives, so we
    // add it here after the build writes the file.
    const file = 'dist/index.js';
    writeFileSync(file, "'use client';\n" + readFileSync(file, 'utf8'));
  },
});
