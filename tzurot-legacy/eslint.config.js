const js = require('@eslint/js');
const eslintPluginJest = require('eslint-plugin-jest');
const prettier = require('eslint-config-prettier');
const globals = require('globals');
const moduleSizeRules = require('./.eslintrc.module-size.js');
const antipatternRules = require('./.eslintrc.antipatterns.js');
const timerPatternRules = require('./.eslintrc.timer-patterns.js');

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
      'no-unused-vars': ['warn', { 
        'argsIgnorePattern': '^_', 
        'varsIgnorePattern': '^_',
        'caughtErrorsIgnorePattern': '^_'
      }],
      'no-console': 'off',
      'no-var': 'warn',
      'prefer-const': 'warn',
      ...moduleSizeRules.rules,
      ...antipatternRules.rules,
      ...timerPatternRules.rules
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
      'no-undef': 'off',
      // Override timer pattern rules for tests
      ...timerPatternRules.overrides[0].rules
    }
  },
  {
    files: ['tests/unit/domain/**/*.test.js', 'tests/unit/adapters/**/*.test.js', 'tests/__mocks__/**/*.js', 'tests/examples/**/*.test.js'],
    rules: {
      // Allow DDD tests and mock infrastructure to import from __mocks__ directory for consolidated mock system
      'jest/no-mocks-import': 'off'
    }
  },
  {
    // Temporarily reduce timer pattern severity for existing code until Phase 3 migration
    files: [
      'src/commands/**/*.js',
      'src/core/**/*.js', 
      'src/utils/**/*.js',
      'src/webhook/**/*.js',
      'src/webhookManager.js',
      'src/aiService.js',
      'src/messageTracker.js'
    ],
    rules: {
      // Override timer rules to warnings for existing code
      'no-restricted-syntax': [
        'warn',
        ...antipatternRules.rules['no-restricted-syntax'].slice(1), // Keep antipattern rules
        // Timer patterns as warnings only for existing code
        {
          selector: 'NewExpression[callee.name="Promise"] > ArrowFunctionExpression > CallExpression[callee.name="setTimeout"]',
          message: 'Avoid Promise-wrapped setTimeout. Use injectable delay functions for testability. See docs/core/TIMER_PATTERNS.md'
        },
        {
          selector: 'NewExpression[callee.name="Promise"] > FunctionExpression > CallExpression[callee.name="setTimeout"]',
          message: 'Avoid Promise-wrapped setTimeout. Use injectable delay functions for testability. See docs/core/TIMER_PATTERNS.md'
        },
        {
          selector: 'MethodDefinition[key.name="constructor"] CallExpression[callee.name="setTimeout"]:not([callee.object.type="MemberExpression"])',
          message: 'Timer in constructor. Accept timer functions via options for testability. See docs/core/TIMER_PATTERNS.md'
        },
        {
          selector: 'MethodDefinition[key.name="constructor"] CallExpression[callee.name="setInterval"]:not([callee.object.type="MemberExpression"])',
          message: 'Timer in constructor. Accept timer functions via options for testability. See docs/core/TIMER_PATTERNS.md'
        }
      ]
    }
  },
  {
    ignores: ['node_modules/**', 'coverage/**']
  },
  prettier
];