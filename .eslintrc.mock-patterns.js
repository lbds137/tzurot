/**
 * ESLint rules for enforcing consistent mock patterns
 * This prevents mixing old and new mock approaches
 */

module.exports = {
  rules: {
    // Warn when using old mock patterns
    'no-restricted-syntax': [
      'warn',
      {
        selector: 'CallExpression[callee.object.name="jest"][callee.property.name="doMock"]',
        message:
          'jest.doMock is deprecated. Use the consolidated mock system with createMigrationHelper() instead.',
      },
      {
        selector:
          'CallExpression[callee.property.name="createMockMessage"][callee.object.name="helpers"]',
        message:
          'helpers.createMockMessage is deprecated. Use migrationHelper.bridge.createCompatibleMockMessage() instead.',
      },
      {
        selector: 'CallExpression[callee.name="require"][arguments.0.value=/mockFactories/]',
        message:
          'mockFactories is deprecated. Use the consolidated mock system in tests/__mocks__/ instead.',
      },
      {
        selector: 'CallExpression[callee.name="require"][arguments.0.value=/discordMocks/]',
        message:
          'discordMocks is deprecated. Use the consolidated mock system in tests/__mocks__/ instead.',
      },
      {
        selector: 'CallExpression[callee.name="require"][arguments.0.value=/apiMocks/]',
        message:
          'apiMocks is deprecated. Use the consolidated mock system in tests/__mocks__/ instead.',
      },
    ],

    // Error on mixing mock patterns in the same file
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/mockFactories', '**/discordMocks', '**/apiMocks'],
            message:
              'Use the consolidated mock system in tests/__mocks__/ instead of legacy mocks.',
          },
        ],
      },
    ],
  },
};
