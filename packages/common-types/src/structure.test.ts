/**
 * Project Structure Enforcement Test
 *
 * Ensures every source file has a corresponding test file.
 * This prevents untested code from being merged.
 *
 * Exclusions:
 * - index.ts (barrel exports)
 * - *.d.ts (type definitions)
 * - types.ts, types/*.ts (type-only files)
 * - constants.ts, constants/*.ts (constant-only files)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Files/patterns to exclude (don't require tests)
const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.d\.ts$/,
  /\/index\.ts$/,
  /\/types\.ts$/,
  /\/types\//,
  /\/constants\.ts$/,
  /\/constants\//,
  /\/generated\//,
  /\/node_modules\//,
  /\/dist\//,
  // Config/setup files
  /vitest\.config\.ts$/,
  /setupTests\.ts$/,
  /testSetup\.ts$/,
  // Job handlers (thin wrappers, tested via integration)
  /\/jobs\/handlers\//,
  // CLI scripts
  /\/scripts\//,
  // Legacy code
  /\/tzurot-legacy\//,
  // Type-only files (pure type definitions)
  /Types\.ts$/,
  // Test infrastructure (mocks, fixtures, setup, test utilities)
  /\/test\//,
  /\/mocks\//,
  /\/fixtures\//,
  /test-utils\.ts$/,
  // Infrastructure singletons (Redis, Queue - tested via integration)
  /\/redis\.ts$/,
  /\/queue\.ts$/,
  // Pure interface files
  /^I[A-Z].*\.ts$/, // IMessageProcessor.ts, IReferenceStrategy.ts
  /\/I[A-Z][^/]*\.ts$/,
  // Utils that are helpers for other tested files
  /\/utils\/.*Helpers\.ts$/,
  /\/utils\/.*Config\.ts$/,
  /\/utils\/.*Formatter\.ts$/,
  // Zod schemas (pure validation, tested via type system)
  /\/schemas\//,
  // Factory files (test data creation helpers)
  /\/factories\//,
  // Route handlers (tested via integration tests)
  /\/routes\//,
  // Service singletons and caches
  /Service\.ts$/,
  /Cache\.ts$/,
  // Workers (background processes, tested via integration)
  /Worker\.ts$/,
  /worker\.ts$/,
  // Command utilities (Discord infrastructure)
  /\/commands\/.*\/utils\.ts$/,
  /deployCommands\.ts$/,
  /defineCommand\.ts$/,
  /subcommandContextRouter\.ts$/,
  /mixedModeSubcommandRouter\.ts$/,
  // Browse utilities (UI helpers)
  /\/browse\//,
  // API clients (thin wrappers around fetch)
  /apiClient\.ts$/,
  /Client\.ts$/,
  // Prisma singleton
  /\/prisma\.ts$/,
  // Context files (builder/container patterns)
  /Context\.ts$/,
  // Cross-turn detection (tested via ConversationalRAGService)
  /crossTurnDetection\.ts$/,
  // Sync validation (tested via integration)
  /syncValidation\.ts$/,
  // Langchain converter (tested via integration)
  /langchainConverter\.ts$/,
  // Channel fetcher utilities (tested via MessageContextBuilder)
  /\/channelFetcher\//,
  // Participant utils (tested via integration)
  /participantUtils\.ts$/,
  // Async handler (simple express wrapper)
  /asyncHandler\.ts$/,
  // Temp storage (infrastructure, tested via integration)
  /tempAttachmentStorage\.ts$/,
  // Base classes (tested via concrete implementations)
  /Base[A-Z].*\.ts$/,
  // Job utils (tested via integration in conversationUtils.test.ts)
  /\/jobs\/utils\//,
  // Browse helpers (UI helpers tested via command tests)
  /browseHelpers\.ts$/,
];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath));
}

function findSourceFiles(dirs: string[]): string[] {
  const results: string[] = [];

  for (const dir of dirs) {
    const fullPath = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(fullPath)) continue;

    try {
      // Use spawnSync with array args to prevent command injection
      const result = spawnSync('find', [fullPath, '-name', '*.ts', '-type', 'f'], {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      if (result.status !== 0 || result.stdout === null) {
        continue;
      }

      const files = result.stdout.trim().split('\n').filter(Boolean);
      for (const file of files) {
        const relativePath = path.relative(PROJECT_ROOT, file);
        if (!shouldExclude(relativePath)) {
          results.push(relativePath);
        }
      }
    } catch {
      // Directory might not exist or find might fail
    }
  }

  return results;
}

describe('Project Structure', () => {
  it('ensures every source file has a corresponding test file', () => {
    const dirs = [
      'services/ai-worker/src',
      'services/api-gateway/src',
      'services/bot-client/src',
      'packages/common-types/src',
      'packages/embeddings/src',
    ];

    const sourceFiles = findSourceFiles(dirs);
    const missingTests: string[] = [];

    for (const file of sourceFiles) {
      const ext = path.extname(file);
      const dir = path.dirname(file);
      const name = path.basename(file, ext);

      // Expected test file: foo.ts -> foo.test.ts (co-located)
      const expectedTestFile = path.join(PROJECT_ROOT, dir, `${name}.test${ext}`);

      if (!fs.existsSync(expectedTestFile)) {
        missingTests.push(file);
      }
    }

    if (missingTests.length > 0) {
      const errorMessage = [
        `The following ${missingTests.length} source files are missing test files:`,
        '',
        ...missingTests.slice(0, 50).map(f => `  - ${f}`),
        missingTests.length > 50 ? `  ... and ${missingTests.length - 50} more` : '',
        '',
        'To fix: Create a corresponding .test.ts file for each source file.',
        'To exclude: Add the pattern to EXCLUDE_PATTERNS in structure.test.ts',
      ].join('\n');

      expect.fail(errorMessage);
    }
  });
});
