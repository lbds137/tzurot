const fs = require('fs');
const path = require('path');

// Static scopes for root-level concerns (not workspace packages)
const staticScopes = [
  'ci', // CI/CD configuration (.github/)
  'deps', // Dependency updates
  'docs', // General documentation
  'hooks', // Git hooks (.husky/)
  'repo', // General repo maintenance
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
