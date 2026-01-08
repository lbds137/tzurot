module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce specific scopes for this project
    'scope-enum': [
      2,
      'always',
      [
        'api-gateway',
        'ai-worker',
        'bot-client',
        'common-types',
        'hooks',
        'docs',
        'deps',
        'tests',
        'ci',
      ],
    ],
    // Allow empty scope (for cross-cutting changes)
    'scope-empty': [0],
    // Allow long body lines (for changelogs, co-author lines, etc.)
    'body-max-line-length': [0],
    // Allow long footer lines (for issue references, etc.)
    'footer-max-line-length': [0],
  },
};
