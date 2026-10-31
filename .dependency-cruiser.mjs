/**
 * Import rules for src/, checked in CI by `npm run check:deps`. CONTRIBUTING.md
 * explains the architecture these rules enforce. Tests follow the same rules
 * as the code they test.
 */

/**
 * What each core module may import, besides itself. This table is the
 * dependency diagram; adding a core module means adding a row.
 */
const CORE_MODULES = {
  lang: [],
  model: ['lang'],
  transform: ['lang', 'model'],
  state: ['lang', 'model', 'transform'],
  history: ['lang', 'model', 'state', 'transform'],
  formats: ['lang', 'model'],
  queries: ['lang', 'model', 'formats', 'state'],
  commands: ['lang', 'model', 'formats', 'queries', 'state', 'transform'],
  markdown: ['lang', 'model'],
  'url-policy': [],
  html: ['lang', 'markdown', 'model', 'url-policy'],
  json: ['lang', 'model'],
  'input-rules': [
    'lang',
    'model',
    'formats',
    'markdown',
    'state',
    'transform',
    'commands',
    'history',
  ],
};

/** The markdown parser and its types. Only core/markdown may use them. */
const PARSER =
  'node_modules/(micromark|mdast-util-from-markdown|mdast-util-gfm-[a-z-]+|micromark-extension-gfm-[a-z-]+|@types/mdast)/';
/** Packages core tests may use besides the parser. */
const TEST_TOOLS = 'node_modules/(vitest|@vitest|fast-check)/';
const TEST_FILE = '\\.test(-support)?\\.tsx?$';
const DECLARED = Object.keys(CORE_MODULES).join('|');

const moduleDirection = Object.entries(CORE_MODULES).map(([module, allowed]) => ({
  name: `core-${module}-imports`,
  comment: `core/${module} may import only: ${allowed.join(', ') || 'nothing else in core'}.`,
  severity: 'error',
  from: { path: `^src/core/${module}/` },
  to: { path: '^src/core/', pathNot: `^src/core/(${[module, ...allowed].join('|')})/` },
}));

export default {
  forbidden: [
    ...moduleDirection,
    {
      name: 'core-module-declared',
      comment: 'Every core module needs a row in CORE_MODULES in .dependency-cruiser.mjs.',
      severity: 'error',
      from: { path: `^src/core/(?!(${DECLARED})/)[^/]+/` },
      to: {},
    },
    {
      name: 'core-import-module-index',
      comment:
        'Outside a module, import only its index.ts (tests may also use its *.test-support.ts).',
      severity: 'error',
      from: { path: '^src/core/([^/]+)/' },
      to: {
        path: '^src/core/[^/]+/',
        pathNot: ['^src/core/$1/', '^src/core/[^/]+/index\\.ts$', '\\.test-support\\.ts$'],
      },
    },
    {
      name: 'no-test-support-in-production',
      comment: 'Test helpers are not part of the package.',
      severity: 'error',
      from: { path: '^src/', pathNot: TEST_FILE },
      to: { path: '\\.test-support\\.ts$' },
    },
    {
      name: 'core-stays-in-core',
      comment: 'core depends on nothing outside itself: no view, no React, no editor.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/(?!core/)' },
    },
    {
      name: 'core-no-node-builtins',
      comment: 'core runs anywhere, so it may not use Node built-in modules.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-npm-allowlist',
      comment: 'core may only use the markdown parser packages.',
      severity: 'error',
      from: { path: '^src/core/', pathNot: TEST_FILE },
      to: { path: 'node_modules/', pathNot: PARSER },
    },
    {
      name: 'core-test-npm-allowlist',
      comment: 'core tests may use the parser packages, vitest and fast-check.',
      severity: 'error',
      from: { path: `^src/core/.*${TEST_FILE}` },
      to: { path: 'node_modules/', pathNot: [PARSER, TEST_TOOLS] },
    },
    {
      name: 'parser-only-in-markdown',
      comment: 'The markdown parser is an implementation detail of core/markdown.',
      severity: 'error',
      from: { path: '^src/core/', pathNot: '^src/core/markdown/' },
      to: { path: PARSER },
    },
    {
      name: 'view-imports-core-index',
      comment: 'view uses core through its entry points only: index.ts (public) and internal.ts.',
      severity: 'error',
      from: { path: '^src/view/' },
      to: { path: '^src/core/', pathNot: '^src/core/(index|internal)\\.ts$' },
    },
    {
      name: 'view-no-react',
      comment: 'view is framework-free: React lives in src/react.',
      severity: 'error',
      from: { path: '^src/view/' },
      to: { path: ['node_modules/(react|react-dom)/', '^src/react/', '^src/editor\\.ts$'] },
    },
    {
      name: 'react-not-into-view',
      comment: 'react reaches the view through src/editor.ts.',
      severity: 'error',
      from: { path: '^src/react/' },
      to: { path: '^src/view/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: { path: '^src/' },
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
