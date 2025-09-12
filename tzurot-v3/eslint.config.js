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
      '**/*.d.ts',
      '**/*.test.ts',
      '**/*.spec.ts',
      'coverage/**',
      '.pnpm-store/**'
    ]
  },
  
  // Configuration for TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022
      },
      parserOptions: {
        project: true, // Automatically find the nearest tsconfig.json
        tsconfigRootDir: __dirname, // Use the resolved root directory
      }
    },
    rules: {
      // TypeScript specific rules
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true
      }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/strict-boolean-expressions': ['error', {
        allowString: true,
        allowNumber: true,
        allowNullableObject: true
      }],
      
      // General code quality rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      
      // Async/Promise rules
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-return-await': 'error'
    }
  }
);