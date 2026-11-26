import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      'apps/nextjs/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `const { revision: _r, ...rest } = state` drops fields on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // The core engine must not touch browser globals at module scope; this keeps it visible in review.
      'no-restricted-globals': ['error', 'event'],
    },
  },
  {
    files: [
      'packages/react/**/*.{ts,tsx}',
      'packages/*/src/react/**/*.{ts,tsx}',
      'apps/**/*.{ts,tsx}',
      'tests/**/*.tsx',
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
