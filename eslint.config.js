const js = require('@eslint/js');
const eslintPluginJest = require('eslint-plugin-jest');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
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
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'varsIgnorePattern': '^_' }],
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
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.nodeBuiltin
      }
    },
    rules: {
      ...eslintPluginJest.configs.recommended.rules,
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      // Relax some rules for test files
      'no-undef': 'off'
    }
  },
  {
    ignores: ['node_modules/**', 'coverage/**']
  },
  prettier
];