// NOTE: Keep scopes in sync with packages/ and services/ directories
// TODO: Consider generating dynamically from pnpm-workspace.yaml
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce specific scopes for this project
    'scope-enum': [
      2,
      'always',
      [
        // Services
        'api-gateway',
        'ai-worker',
        'bot-client',
        // Packages
        'common-types',
        'embeddings',
        'tooling',
        // Other
        'scripts',
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
