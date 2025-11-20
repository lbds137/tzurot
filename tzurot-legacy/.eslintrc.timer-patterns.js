/**
 * ESLint configuration for detecting problematic timer patterns
 * This helps enforce testable timer code across the codebase
 */

module.exports = {
  rules: {
    // Detect problematic timer patterns (allow in return statements for injectable defaults)
    'no-restricted-syntax': [
      'warn', // Changed from error to warning
      {
        selector: 'NewExpression[callee.name="Promise"] > ArrowFunctionExpression > CallExpression[callee.name="setTimeout"]',
        message: 'Consider if this Promise-wrapped setTimeout should be injectable. Use injectable delay functions for testability. See docs/core/TIMER_PATTERNS.md'
      },
      {
        selector: 'NewExpression[callee.name="Promise"] > FunctionExpression > CallExpression[callee.name="setTimeout"]',
        message: 'Consider if this Promise-wrapped setTimeout should be injectable. Use injectable delay functions for testability. See docs/core/TIMER_PATTERNS.md'
      },
      {
        selector: 'MethodDefinition[key.name="constructor"] CallExpression[callee.name="setTimeout"]:not([callee.object.type="MemberExpression"])',
        message: 'Timer in constructor. Accept timer functions via options for testability. See docs/core/TIMER_PATTERNS.md'
      },
      {
        selector: 'MethodDefinition[key.name="constructor"] CallExpression[callee.name="setInterval"]:not([callee.object.type="MemberExpression"])',
        message: 'Timer in constructor. Accept timer functions via options for testability. See docs/core/TIMER_PATTERNS.md'
      }
    ],
    
    // Additional custom rules for timer patterns
    'no-restricted-globals': [
      'warn',
      {
        name: 'setTimeout',
        message: 'Consider using injectable timer functions instead of global setTimeout. See docs/core/TIMER_PATTERNS.md'
      },
      {
        name: 'setInterval',
        message: 'Consider using injectable timer functions instead of global setInterval. See docs/core/TIMER_PATTERNS.md'
      }
    ]
  },
  
  // Override rules for test files - they can use timers directly
  overrides: [
    {
      files: ['**/*.test.js', '**/*.spec.js', 'tests/**/*.js'],
      rules: {
        'no-restricted-syntax': 'off',
        'no-restricted-globals': 'off'
      }
    }
  ]
};