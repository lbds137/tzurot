import js from '@eslint/js';
import eslintPluginJest from 'eslint-plugin-jest';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.commonjs
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-var': 'warn',
      'prefer-const': 'warn'
    }
  },
  {
    files: ['**/*.test.js', 'tests/**/*.js'],
    plugins: {
      jest: eslintPluginJest
    },
    rules: {
      ...eslintPluginJest.configs.recommended.rules,
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error'
    }
  },
  {
    ignores: ['node_modules/**', 'coverage/**']
  },
  prettier
];