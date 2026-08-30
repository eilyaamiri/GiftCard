import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Paths that no linter should ever walk into. */
export const sharedIgnores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/out/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/playwright-report/**',
  '**/test-results/**',
  '_extract/**',
];

/**
 * Concrete provider implementations. Domain modules must go through the
 * interface barrel (`@barat/payments`, `@barat/fx`, ...) instead — see rules 5-7
 * in AGENTS.md.
 */
export const forbiddenProviderImportPatterns = [
  {
    group: [
      '**/integrations/*/src/providers/**',
      '**/integrations/*/providers/**',
      '@barat/fx/providers/**',
      '@barat/fx/src/providers/**',
      '@barat/payments/providers/**',
      '@barat/payments/src/providers/**',
      '@barat/suppliers/providers/**',
      '@barat/suppliers/src/providers/**',
      '@barat/notifications/providers/**',
      '@barat/notifications/src/providers/**',
    ],
    message:
      'Domain modules must not import a concrete provider. Import the interface barrel ' +
      '(@barat/fx, @barat/payments, @barat/suppliers, @barat/notifications) and resolve the ' +
      'implementation through dependency injection. See AGENTS.md rules 5-7.',
  },
  {
    group: ['zarinpal*', 'tillo*', 'reloadly*', 'runa*', 'giftbit*'],
    message:
      'Never import a payment or supplier SDK from the domain core. Wrap it in ' +
      'integrations/<domain>/src/providers and depend on the interface. See AGENTS.md rules 5-7.',
  },
];

/** Rules shared by every TypeScript package in the monorepo. */
export const sharedTypescriptRules = {
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
  '@typescript-eslint/no-non-null-assertion': 'error',
  'no-console': 'error',
  'no-debugger': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'prefer-const': 'error',
  'no-var': 'error',
  'object-shorthand': ['error', 'properties'],
};

/**
 * The base flat config every package extends.
 * Consumers spread it and then append their own overrides.
 */
export const baseConfig = tseslint.config(
  { ignores: sharedIgnores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: sharedTypescriptRules,
  },
  {
    // Config and tooling files are allowed to be loose.
    files: ['**/*.config.{js,mjs,cjs,ts,mts}', '**/*.setup.{ts,mts}', '**/scripts/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/tests/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);

export default baseConfig;
