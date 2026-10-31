/**
 * Measures what each package entry costs a consumer: the built entry bundled
 * with its dependencies the way an app's bundler does it (ESM, minified,
 * unused exports dropped), then gzipped. Fails when a case exceeds its
 * budget. Run after `npm run build`.
 *
 *   npm run check:size            check the budgets
 *   npm run check:size -- --why   also list the bytes each package adds
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { log } from 'node:console';
import { argv, cwd, exit } from 'node:process';

const KIB = 1024;

/**
 * What a consumer imports, and the most it may cost, gzipped: about 10%
 * above what it cost when the budget was set (docs/performance.md). Raise a budget
 * only on purpose, in the same change that explains why.
 */
const CASES = [
  { name: '. (everything)', source: "export * from './dist/index.js';", budget: 38 * KIB },
  { name: './core (everything)', source: "export * from './dist/core.js';", budget: 36 * KIB },
  {
    name: './core markdown + JSON',
    source: "export { parseMarkdown, serializeMarkdown, toJSON, fromJSON } from './dist/core.js';",
    budget: 32 * KIB,
  },
  {
    name: './core JSON + HTML',
    source: "export { fromJSON, serializeHtml } from './dist/core.js';",
    budget: 30 * KIB,
  },
  {
    name: './core JSON only',
    source: "export { toJSON, fromJSON } from './dist/core.js';",
    budget: 4.5 * KIB,
  },
];

const why = argv.includes('--why');
let failed = false;

for (const { name, source, budget } of CASES) {
  const result = await build({
    stdin: { contents: source, resolveDir: cwd(), loader: 'js' },
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0]?.contents ?? new Uint8Array();
  const gzipped = gzipSync(code).length;
  const over = gzipped > budget;
  failed ||= over;
  log(
    `${over ? 'OVER' : 'ok  '} ${name.padEnd(26)} ${kb(code.length).padStart(9)} min ${kb(gzipped).padStart(9)} gzip   budget ${kb(budget)}`,
  );
  if (why) {
    const output = Object.values(result.metafile.outputs)[0];
    const byPackage = new Map();
    for (const [path, { bytesInOutput }] of Object.entries(output?.inputs ?? {})) {
      const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
      const owner = match?.[1] ?? 'this package';
      byPackage.set(owner, (byPackage.get(owner) ?? 0) + bytesInOutput);
    }
    for (const [owner, bytes] of [...byPackage].sort((a, b) => b[1] - a[1])) {
      log(`       ${kb(bytes).padStart(9)} min  ${owner}`);
    }
  }
}

function kb(bytes) {
  return `${(bytes / KIB).toFixed(1)} kB`;
}

if (failed) exit(1);
