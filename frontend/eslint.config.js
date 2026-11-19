// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'src/api/generated',
    'docs',
    'stats.html',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Two programs: the app (tsconfig.json) and the tooling/e2e files (tsconfig.node.json).
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    extends: [jsxA11y.flatConfigs.strict],
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'no-console': 'error',
      // No `as` casts anywhere (API data is typed by the generated client; WS data by Zod).
      // `as const` is still allowed by this rule.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // React Router loaders signal redirects/HTTP errors by throwing a Response.
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'No inline styles: use CSS Modules and design tokens.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never render model or transcript output as raw HTML.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react-router-dom', message: 'Use react-router (v8).' },
            { name: 'axios', message: 'Use the typed client in src/api/client.ts.' },
          ],
          patterns: [
            {
              group: ['**/test/**', '@/test/*'],
              message: 'Production code must not import test code or mocks.',
            },
          ],
        },
      ],
    },
  },

  // Component size budget (~200 lines, ignoring blanks and comments).
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  // Tests and mocks may import test utilities.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  // The app entry is the single, env-guarded place that may load the mock worker.
  {
    files: ['src/main.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    files: ['*.config.{js,ts}', 'scripts/**/*.mjs', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
]);
