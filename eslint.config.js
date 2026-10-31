import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import noEffect from 'eslint-plugin-react-you-might-not-need-an-effect';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.husky', '.claude'] },
  js.configs.recommended,
  comments.recommended,

  // Type-aware linting for source only. `strict-boolean-expressions` needs types.
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommendedTypeChecked,
      react.configs.flat.recommended,
      reactHooks.configs['recommended-latest'],
      noEffect.configs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Workarounds that hide a cause instead of removing it.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='setTimeout'][arguments.1.value=0]",
          message: 'setTimeout(fn, 0) defers a timing problem. Find the cause instead.',
        },
        {
          selector: "CallExpression[callee.property.name='setTimeout'][arguments.1.value=0]",
          message: 'setTimeout(fn, 0) defers a timing problem. Find the cause instead.',
        },
      ],
      // Narrow with discriminated unions and type guards instead. `as const`
      // is still allowed: it adds information rather than overriding it.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': false },
      ],
      '@eslint-community/eslint-comments/no-use': ['error', { allow: [] }],

      // Conditions must say what they mean. See CONTRIBUTING.md.
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
        },
      ],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          enforceConst: true,
          // `level: 1 | 2 | 3 | 4` is the specification, not a magic number.
          ignoreNumericLiteralTypes: true,
        },
      ],
      // Every classification is an exhaustive switch (CONTRIBUTING.md). A
      // missing case is an error even when a default exists: the default is
      // for assertNever, not for "everything else".
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        {
          considerDefaultExhaustiveForUnions: false,
          allowDefaultCaseForExhaustiveSwitch: true,
          requireDefaultForNonUnion: true,
        },
      ],
      'no-nested-ternary': 'error',
      eqeqeq: ['error', 'always'],

      // src ships to the browser. Node globals reach TypeScript here anyway,
      // through the test-time types, so the guard has to live in lint.
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message: 'src runs in a browser. Node globals are not available there.',
        },
        { name: 'Buffer', message: 'src runs in a browser. Node globals are not available there.' },
        {
          name: '__dirname',
          message: 'src runs in a browser. Node globals are not available there.',
        },
        {
          name: '__filename',
          message: 'src runs in a browser. Node globals are not available there.',
        },
        { name: 'global', message: 'Use globalThis.' },
      ],

      'react/no-array-index-key': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },

  // Offsets and counts are the specification in tests, not magic numbers.
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'vitest.setup.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },

  {
    files: ['*.config.{ts,js}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // e2e, the benchmarks and the markdown contract are verification tools, not
  // shipped code, so they
  // are not held to the same rules as src.
  {
    files: ['e2e/**/*.{ts,tsx}', 'scripts/**/*.ts', 'test/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  prettier,
);
