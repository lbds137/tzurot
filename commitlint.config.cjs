const fs = require('fs');
const path = require('path');

// Static scopes for root-level concerns (not workspace packages)
const staticScopes = [
  'backlog', // Work tracking (backlog/*.md, BACKLOG.md, CURRENT.md)
  'ci', // CI/CD configuration (.github/)
  'deps', // Dependency updates
  'docs', // General documentation
  'hooks', // Claude Code hooks (.claude/hooks/)
  'husky', // Git workflow hooks (.husky/)
  'legal', // Published legal documents (docs/legal/ — the tzurot.org ToS + privacy policy)
  'prisma', // Database schema and migrations (prisma/)
  'repo', // General repo maintenance
  'rules', // Claude Code rules (.claude/rules/)
  'skills', // Claude Code skills (.claude/skills/)
];

// Helper to get directory names from a path
const getDirectories = source => {
  try {
    return fs
      .readdirSync(source, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch {
    return [];
  }
};

// Dynamically fetch package names from workspace directories
const packagesDir = path.resolve(__dirname, 'packages');
const servicesDir = path.resolve(__dirname, 'services');
const testsDir = path.resolve(__dirname, 'tests'); // tests/ is also a workspace package

const dynamicScopes = [
  ...getDirectories(packagesDir),
  ...getDirectories(servicesDir),
  // Add 'tests' if tests/ directory exists (it's @tzurot/e2e)
  ...(fs.existsSync(testsDir) ? ['tests'] : []),
];

// Combine and deduplicate
const allScopes = [...new Set([...staticScopes, ...dynamicScopes])].sort();

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // The default config-conventional set plus `debug` — temporary diagnostic
    // instrumentation added to production code paths to confirm a bug's runtime
    // behaviour, then removed in a cleanup PR. It is neither feat (not shipped),
    // fix (corrects nothing), nor chore (it's risky production-path code, not
    // housekeeping). A non-empty `git log --grep '^debug[:(]'` on a branch flags
    // scaffolding that still needs removing. See .claude/rules/05-tooling.md.
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'debug',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    // Dynamically generated from workspace packages + static root scopes
    'scope-enum': [2, 'always', allScopes],
    // Allow empty scope (for cross-cutting changes)
    'scope-empty': [0],
    // Allow long body lines (for changelogs, co-author lines, etc.)
    'body-max-line-length': [0],
    // Allow long footer lines (for issue references, etc.)
    'footer-max-line-length': [0],
  },
};
