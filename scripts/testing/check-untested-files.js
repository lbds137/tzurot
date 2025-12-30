#!/usr/bin/env node
/**
 * Check for source files without corresponding test files
 *
 * Usage:
 *   node scripts/testing/check-untested-files.js [--strict]
 *
 * Options:
 *   --strict    Exit with error code 1 if untested files are found (for CI/hooks)
 *
 * This script identifies TypeScript source files that don't have corresponding
 * test files, focusing on files that are likely to contain business logic.
 */

import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

// Directories to check for untested files
const DIRS_TO_CHECK = [
  'services/bot-client/src/commands',
  'services/api-gateway/src/routes',
  'services/ai-worker/src/jobs',
  'services/ai-worker/src/services',
];

// Patterns to always exclude (these don't need tests)
const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
  /\/types\.ts$/,
  /\/types\/.*\.ts$/,
  /\/test\/.*\.ts$/,
  /\.mock\.ts$/,
  /test-utils\.ts$/, // Shared test utilities - not production code
];

// index.ts files under this line count are considered "re-export only" and excluded
const INDEX_FILE_MIN_LINES = 100;

// Minimum line count to consider a file "significant" enough to require tests
const MIN_LINES_FOR_TEST = 50;

// Files explicitly known to be untested (intentionally excluded)
const KNOWN_UNTESTED = new Set([
  // Routing/wiring only - all business logic handlers extracted to separate tested files
  'services/bot-client/src/commands/character/index.ts',
  // Types-only file - no executable code, just TypeScript interfaces
  'services/ai-worker/src/services/context/PromptContext.ts',
  // Types-only file - no executable code, just TypeScript interfaces for ConversationalRAGService
  'services/ai-worker/src/services/ConversationalRAGTypes.ts',
  // Types-only file - interfaces and Zod schema for PgvectorMemoryAdapter
  'services/ai-worker/src/services/PgvectorTypes.ts',
  // Helper functions tested indirectly via handler tests that use them
  'services/api-gateway/src/routes/user/personality/helpers.ts',
]);

function getAllTsFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function countLines(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return content.split('\n').length;
}

function shouldExclude(filePath) {
  const relativePath = relative(rootDir, filePath);
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath));
}

function hasTestFile(filePath) {
  const testPath = filePath.replace(/\.ts$/, '.test.ts');
  return existsSync(testPath);
}

function main() {
  const isStrict = process.argv.includes('--strict');
  const untestedFiles = [];

  console.log('🔍 Checking for untested source files...\n');

  for (const dirPath of DIRS_TO_CHECK) {
    const fullDirPath = join(rootDir, dirPath);
    const files = getAllTsFiles(fullDirPath);

    for (const file of files) {
      const relativePath = relative(rootDir, file);

      // Skip excluded patterns
      if (shouldExclude(file)) continue;

      // Skip if test file exists
      if (hasTestFile(file)) continue;

      // Skip known untested files
      if (KNOWN_UNTESTED.has(relativePath)) continue;

      // Check line count
      const lines = countLines(file);
      if (lines < MIN_LINES_FOR_TEST) continue;

      // index.ts files have a higher threshold (often just re-exports/routing)
      const isIndexFile = file.endsWith('/index.ts');
      if (isIndexFile && lines < INDEX_FILE_MIN_LINES) continue;

      untestedFiles.push({ path: relativePath, lines });
    }
  }

  // Sort by line count (largest first)
  untestedFiles.sort((a, b) => b.lines - a.lines);

  if (untestedFiles.length === 0) {
    console.log('✅ All significant source files have corresponding test files!\n');
    process.exit(0);
  }

  console.log(`⚠️  Found ${untestedFiles.length} source files without tests:\n`);
  console.log('   Lines  File');
  console.log('   -----  ----');

  for (const { path, lines } of untestedFiles) {
    console.log(`   ${lines.toString().padStart(5)}  ${path}`);
  }

  console.log('\n📝 To fix:');
  console.log('   1. Create a corresponding .test.ts file for each');
  console.log('   2. Or add to KNOWN_UNTESTED in this script if intentionally untested\n');

  if (isStrict) {
    console.log('❌ Failing due to --strict flag\n');
    process.exit(1);
  }
}

main();
