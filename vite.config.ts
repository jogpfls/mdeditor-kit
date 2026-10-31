import { defineConfig } from 'vite';

/** Serves the e2e fixture only. The package itself is built by tsup. */
export default defineConfig({
  root: 'e2e/fixture',
  server: { port: 5174 },
  preview: { port: 5174 },
});
