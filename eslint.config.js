import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Get the directory name of the current module (monorepo root)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // Base configurations
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      '**/*.test.ts',
      '**/*.spec.ts',
      'coverage/**',
      '.pnpm-store/**',
      '**/vitest.config.ts',
      'vitest.workspace.ts',
      'prisma.config.ts',
      'tzurot-legacy/**',
      'scripts/**',
      '**/scripts/**',
      'prisma/**',
      // Un-ignore generated Prisma files so ESLint can parse them for type resolution
      // (negation brings them back into scope for the parser)
      '!packages/common-types/src/generated/**',
    ],
  },

  // Disable linting rules for generated Prisma files (but allow parsing for type info)
  {
    files: ['packages/common-types/src/generated/**/*.ts'],
    rules: {
      // Disable all rules for auto-generated code
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },

  // Mock factory files - allow this aliasing for instance tracking pattern
  {
    files: ['**/test/mocks/**/*.ts'],
    rules: {
      // Mock factories intentionally alias 'this' to track instances for test assertions
      // Pattern: mockInstance = this; (in constructor)
      '@typescript-eslint/no-this-alias': 'off',
    },
  },

  // Configuration for TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
      parserOptions: {
        projectService: true, // Automatically discover all TypeScript projects (v8+)
        tsconfigRootDir: __dirname, // Use the resolved root directory
      },
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: true,
          allowNullableObject: true,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/restrict-template-expressions': 'error',
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/consistent-generic-constructors': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',

      // General code quality rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],

      // Async/Promise rules
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-return-await': 'error',

      // Pino logger error handling rules
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name="error"] > *.arguments:first-child:not(ObjectExpression)',
          message:
            'logger.error() must use pino format: logger.error({ err: error }, "message"). See packages/common-types/src/logger.ts for details.',
        },
        {
          selector:
            'CallExpression[callee.property.name="warn"] > *.arguments:first-child:not(ObjectExpression)',
          message:
            'logger.warn() with errors must use pino format: logger.warn({ err: error }, "message"). See packages/common-types/src/logger.ts for details.',
        },
      ],

      // ============================================================================
      // MODULE SIZE & COMPLEXITY RULES
      // These prevent files from becoming too large and complex to test
      // Previously in .eslintrc.module-size.js but never integrated!
      // ============================================================================

      // Enforce maximum file length - error at 500, to force splitting large files
      'max-lines': [
        'error',
        {
          max: 500,
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // Enforce maximum function length
      'max-lines-per-function': [
        'warn',
        {
          max: 100,
          skipBlankLines: true,
          skipComments: true,
          IIFEs: true,
        },
      ],

      // Enforce maximum cyclomatic complexity
      // Bumped from 15 to 20 per MCP council review: Discord bots and AI pipelines
      // are inherently branch-heavy due to command routing and data validation
      complexity: ['warn', { max: 20 }],

      // Enforce maximum depth of nested blocks
      'max-depth': ['warn', { max: 4 }],

      // Enforce maximum number of parameters
      'max-params': ['warn', { max: 5 }],

      // Enforce maximum number of statements in a function
      // Bumped from 30 to 50 per MCP council review: orchestrator functions in
      // microservices naturally have many sequential steps (validate, fetch, process, save)
      'max-statements': ['warn', { max: 50 }],

      // Enforce maximum nested callbacks
      'max-nested-callbacks': ['warn', { max: 3 }],
    },
  },

  // Tooling package overrides - must come AFTER main config to take precedence
  // CLI tools need console.log for user output and have async stubs
  {
    files: ['packages/tooling/**/*.ts'],
    rules: {
      'no-console': 'off', // CLI tools output to console
      '@typescript-eslint/require-await': 'off', // Placeholder functions may not await yet
      '@typescript-eslint/strict-boolean-expressions': 'off', // CLI arg parsing has nullable checks
      'max-depth': ['warn', { max: 5 }], // ESLint rules can be deeply nested
      curly: 'off', // Allow compact conditional returns in CLI
      'no-restricted-syntax': 'off', // console.error is fine in CLI tools (not pino logger)
    },
  }
);
