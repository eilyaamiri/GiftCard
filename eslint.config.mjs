import tseslint from 'typescript-eslint';

import { baseConfig, forbiddenProviderImportPatterns } from './packages/config/eslint/index.mjs';

export default tseslint.config(
  ...baseConfig,

  /* ------------------------------------------------------------------------
   * ARCHITECTURE BOUNDARY (AGENTS.md rules 5-7).
   *
   * apps/api/src/modules/**  must never reach a concrete provider.
   * Only the interface barrels are allowed.
   * ---------------------------------------------------------------------- */
  {
    files: ['apps/api/src/modules/**/*.ts', 'apps/worker/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: forbiddenProviderImportPatterns,
          paths: [
            {
              name: '@prisma/adapter-pg',
              message:
                'The database driver adapter is owned by @barat/database. Inject PrismaService instead.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------------
   * integrations/* may never depend on the application or the database.
   * They only know packages/contracts.
   * ---------------------------------------------------------------------- */
  {
    files: ['integrations/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@barat/database', '@barat/database/**', '**/apps/api/**', '**/apps/**'],
              message:
                'integrations/* must depend on packages/contracts only. The dependency direction ' +
                'is apps -> integrations -> contracts, never the reverse. See AGENTS.md section 2.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------------
   * packages/contracts is the root of the dependency graph: it depends on
   * nothing inside this repository.
   * ---------------------------------------------------------------------- */
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@barat/*', '**/apps/**', '**/integrations/**', '**/packages/**'],
              message:
                'packages/contracts must have zero internal dependencies. It is the shared ' +
                'vocabulary every other package points at.',
            },
          ],
        },
      ],
    },
  },

  /* ------------------------------------------------------------------------
   * Next.js apps run in the browser: allow DOM globals and JSX.
   * ---------------------------------------------------------------------- */
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },

  /* ------------------------------------------------------------------------
   * Prisma seed + database tooling scripts print to stdout on purpose.
   * ---------------------------------------------------------------------- */
  {
    files: ['packages/database/prisma/**/*.ts', 'packages/test-utils/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
