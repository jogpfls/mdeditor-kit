import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  minify: false,
  target: 'es2021',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // CSS imported from src is bundled into dist/index.css and exposed as
  // `mdeditor-kit/styles.css` so consumers opt in to the default styling.
  injectStyle: false,
});
