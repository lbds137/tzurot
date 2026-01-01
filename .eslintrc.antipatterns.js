/**
 * ESLint rules to enforce best practices and prevent anti-patterns
 * These rules prevent the issues that have caused us hours of debugging
 */

module.exports = {
  rules: {
    // Prevent singleton exports that execute on import
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'Program > ExpressionStatement > AssignmentExpression[left.object.name="module"][left.property.name="exports"][right.type="NewExpression"]',
        message:
          'Do not export singleton instances directly. Export a factory function or class instead. See docs/improvements/TIMER_INJECTION_REFACTOR.md',
      },
      {
        selector:
          'Program > VariableDeclaration > VariableDeclarator[init.type="NewExpression"] ~ ExpressionStatement > AssignmentExpression[left.object.name="module"][left.property.name="exports"][right.type="Identifier"]',
        message:
          'Do not create and export singleton instances. This makes testing difficult. Export factories instead.',
      },
      {
        // Prevent process.env.NODE_ENV checks
        selector:
          'BinaryExpression[left.object.object.name="process"][left.object.property.name="env"][left.property.name="NODE_ENV"]',
        message:
          'Do not check process.env.NODE_ENV in source code. Use dependency injection instead.',
      },
      {
        // Prevent typeof checks for globals as a workaround
        selector:
          'BinaryExpression[left.operator="typeof"][left.argument.name=/^(setTimeout|setInterval|clearTimeout|clearInterval)$/][right.value="undefined"]',
        message:
          'Do not check if timer functions exist. Use dependency injection to provide timer functions.',
      },
      {
        // CRITICAL: Prevent deferReply in command handlers
        // The top-level interactionCreate handler in index.ts already defers all interactions.
        // Calling deferReply again in command handlers causes InteractionAlreadyReplied errors.
        // To disable this rule in index.ts, add: // eslint-disable-next-line no-restricted-syntax
        selector: 'CallExpression[callee.property.name="deferReply"]',
        message:
          'Do not call deferReply() in command handlers. The top-level interactionCreate handler already defers all interactions. Use editReply() instead. See services/bot-client/src/index.ts for the top-level deferral.',
      },
    ],

    // Custom rule to detect direct timer usage in constructors
    'no-restricted-properties': [
      'error',
      {
        object: 'global',
        property: 'setTimeout',
        message: 'Use injected timer service instead of global.setTimeout',
      },
      {
        object: 'global',
        property: 'setInterval',
        message: 'Use injected timer service instead of global.setInterval',
      },
      {
        object: 'window',
        property: 'setTimeout',
        message: 'Use injected timer service instead of window.setTimeout',
      },
      {
        object: 'window',
        property: 'setInterval',
        message: 'Use injected timer service instead of window.setInterval',
      },
    ],
  },
};
