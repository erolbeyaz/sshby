import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'sshby-images/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Gizli veri taşıyan kodda sessiz `any` istemiyoruz.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    // env.ts logger kurulmadan önce çalışıyor; orada console kaçınılmaz.
    files: ['apps/api/src/env.ts'],
    rules: { 'no-console': 'off' },
  },
);
