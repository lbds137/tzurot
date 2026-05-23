/**
 * Shared utilities for test coverage audits
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface UnifiedBaseline {
  version: number;
  lastUpdated: string;
  services: {
    /** Services detected as using Prisma (for audit transparency) */
    detectedPrismaServices?: string[];
    knownGaps: string[];
  };
  contracts: {
    knownGaps: string[];
  };
  notes: {
    serviceExemptionCriteria: string;
    contractExemptionCriteria: string;
  };
  /**
   * Layer 3 baseline metadata. Optional for backward compat — pre-Layer-3
   * baselines didn't have this. The drift gate in `auditUnified` treats
   * a missing meta block as drift, forcing an explicit refresh via
   * `test:audit --update`.
   */
  meta?: import('../audits/baseline-meta.js').BaselineMeta;
}

export interface ServiceAuditResult {
  allServices: string[];
  servicesWithPrisma: string[];
  servicesWithoutPrisma: string[];
  testedServices: string[];
  untestedServices: string[];
  coverage: number;
  newGaps: string[];
  fixedGaps: string[];
}

export interface ContractAuditResult {
  allSchemas: string[];
  testedSchemas: string[];
  untestedSchemas: string[];
  coverage: number;
  newGaps: string[];
  fixedGaps: string[];
}

// ============================================================================
// File System Helpers
// ============================================================================

/**
 * Recursively find all files matching a pattern
 */
export function findFiles(dir: string, pattern: RegExp, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory() && entry !== 'node_modules' && entry !== 'dist') {
      findFiles(fullPath, pattern, results);
    } else if (stat.isFile() && pattern.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/**
 * Read file contents
 */
export function readFile(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/**
 * Get relative path from project root
 */
export function getRelativePath(projectRoot: string, filePath: string): string {
  return relative(projectRoot, filePath);
}

/**
 * Get directory and basename helpers
 */
export { dirname };

// ============================================================================
// Service Detection Helpers
// ============================================================================

/** Number of lines to check for backward compatibility comments */
const BACKWARD_COMPAT_COMMENT_SEARCH_LINES = 10;

/**
 * Check if a service file is a re-export/barrel file (shouldn't need tests)
 */
export function isReExportFile(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');

  // Check for common re-export patterns in non-comment lines
  const lines = content
    .split('\n')
    .filter(
      l =>
        l.trim() &&
        !l.trim().startsWith('//') &&
        !l.trim().startsWith('/*') &&
        !l.trim().startsWith('*')
    );

  // If the file is mostly export statements, it's a re-export
  const exportLines = lines.filter(l => l.trim().startsWith('export'));
  const hasOnlyExports = lines.length > 0 && exportLines.length === lines.length;

  // Also check for explicit backward compatibility comment at file level
  const firstLines = content
    .split('\n')
    .slice(0, BACKWARD_COMPAT_COMMENT_SEARCH_LINES)
    .join('\n')
    .toLowerCase();
  const hasBackwardCompatComment =
    firstLines.includes('backward compatibility') || firstLines.includes('backwards compatibility');

  return hasOnlyExports || hasBackwardCompatComment;
}

/**
 * Patterns that indicate Prisma usage in a file
 */
const PRISMA_PATTERNS = [
  /from\s+['"]@prisma\/client['"]/, // import from @prisma/client
  /from\s+['"]\..*prisma['"]/i, // import from local prisma
  /getPrismaClient\s*\(/, // getPrismaClient() call
  /new\s+PrismaClient\s*\(/, // new PrismaClient()
  /this\.prisma\./, // this.prisma.* usage
  /prisma\.\w+\.(findMany|findUnique|findFirst|create|update|delete|upsert|count|aggregate)/,
];

/**
 * Check if a service file uses Prisma (and thus needs integration tests)
 *
 * This replaces the manual "exempt" list - services are automatically
 * determined to need integration tests based on actual Prisma usage.
 */
export function hasPrismaUsage(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');

  // Remove comments to avoid false positives
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Block comments
    // eslint-disable-next-line regexp/no-super-linear-move -- Input is developer-authored TS source (trusted, bounded by file size); ReDoS not a real attack surface
    .replace(/\/\/.*$/gm, ''); // Line comments

  return PRISMA_PATTERNS.some(pattern => pattern.test(withoutComments));
}

/**
 * Check if a file has an @audit-ignore comment for opting out of audit
 */
export function hasAuditIgnoreComment(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const firstLines = content.split('\n').slice(0, 20).join('\n');
  return /@audit-ignore:\s*database-testing/i.test(firstLines);
}

// ============================================================================
// Baseline Helpers
// ============================================================================

/**
 * Re-export of TEST_AUDIT_IMPL_VERSION for callers that historically
 * imported it from this module. The constant itself lives in
 * `audit-version.ts` (fs-free) so the test suite can statically import
 * it without pulling in `node:fs` ahead of `vi.mock` hoisting.
 */
export { TEST_AUDIT_IMPL_VERSION } from './audit-version.js';
import { TEST_AUDIT_IMPL_VERSION } from './audit-version.js';

/**
 * Returns the measurement-affecting test-audit config. Hashed into the
 * baseline `meta.configHash` so a heuristic change invalidates the
 * baseline. Stable shape — bump `TEST_AUDIT_IMPL_VERSION` (in
 * `audit-version.ts`) when the detection logic changes.
 */
export function getTestAuditConfigFingerprint(): {
  implVersion: number;
} {
  return { implVersion: TEST_AUDIT_IMPL_VERSION };
}

/**
 * Create default empty baseline
 */
export function createEmptyBaseline(): UnifiedBaseline {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    services: {
      knownGaps: [],
    },
    contracts: {
      knownGaps: [],
    },
    notes: {
      serviceExemptionCriteria:
        'Services are auto-detected for Prisma usage. Only services with Prisma calls need integration tests.',
      contractExemptionCriteria: 'None - all API schemas need contract tests',
    },
  };
}
