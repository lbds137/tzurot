#!/usr/bin/env npx tsx
/**
 * Service Integration Test Audit Script
 *
 * Audits service files for integration/component test coverage using a ratchet system:
 * - Finds all *Service.ts files in services/ and packages/
 * - Checks which services have corresponding component tests (.component.test.ts)
 * - Compares against a baseline file to detect NEW gaps
 * - Fails CI if NEW services are added without component tests
 *
 * Usage:
 *   npx tsx scripts/testing/audit-service-integration.ts [--update-baseline] [--strict]
 *
 * Options:
 *   --update-baseline  Update the baseline file with current coverage
 *   --strict           Fail if ANY gap exists (not just new ones)
 *
 * The ratchet system allows existing gaps while blocking new ones.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

// Constants
const BASELINE_PATH = join(projectRoot, 'service-integration-baseline.json');

/** Number of lines to check for backward compatibility comments at file level */
const BACKWARD_COMPAT_COMMENT_SEARCH_LINES = 10;

// Directories to search for service files
const SERVICE_DIRS = [
  join(projectRoot, 'services/ai-worker/src'),
  join(projectRoot, 'services/api-gateway/src'),
  join(projectRoot, 'services/bot-client/src'),
  join(projectRoot, 'packages/common-types/src'),
];

// Zod schema for baseline file validation
const BaselineFileSchema = z.object({
  knownGaps: z.array(z.string()),
  exempt: z.array(z.string()),
  lastUpdated: z.string(),
  version: z.number(),
});

type BaselineFile = z.infer<typeof BaselineFileSchema>;

interface AuditResult {
  allServices: string[];
  auditableServices: string[];
  testedServices: string[];
  untestedServices: string[];
  coverage: number;
  newGaps: string[];
  fixedGaps: string[];
  baseline: BaselineFile;
}

/**
 * Recursively find all files matching a pattern
 */
function findFiles(dir: string, pattern: RegExp, results: string[] = []): string[] {
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
 * Check if a service file is a re-export/barrel file (shouldn't need tests)
 *
 * A file is considered a re-export if:
 * 1. All non-comment lines are export statements, OR
 * 2. The file header (first N lines) contains "backward compatibility" comment
 *
 * Note: Empty files or comment-only files return false (not re-exports)
 */
function isReExportFile(filePath: string): boolean {
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
 * Find all service files
 */
function findServiceFiles(): string[] {
  const services: string[] = [];

  for (const dir of SERVICE_DIRS) {
    // Find *Service.ts files (excluding tests)
    const files = findFiles(dir, /Service\.ts$/);
    for (const file of files) {
      // Skip test files
      if (file.endsWith('.test.ts') || file.endsWith('.component.test.ts')) continue;

      // Skip re-export files
      if (isReExportFile(file)) continue;

      // Get relative path for cleaner output
      const relativePath = relative(projectRoot, file);
      services.push(relativePath);
    }
  }

  return services.sort();
}

/**
 * Find services that have component tests
 */
function findTestedServices(services: string[]): string[] {
  const tested: string[] = [];

  for (const service of services) {
    const fullPath = join(projectRoot, service);
    const dir = dirname(fullPath);
    const baseName = basename(service, '.ts');

    // Check for component test file
    const componentTestPath = join(dir, `${baseName}.component.test.ts`);

    if (existsSync(componentTestPath)) {
      tested.push(service);
    }
  }

  return tested.sort();
}

/**
 * Load baseline file with Zod validation
 * @throws {z.ZodError} if baseline file exists but has invalid structure
 */
function loadBaseline(): BaselineFile {
  if (!existsSync(BASELINE_PATH)) {
    return {
      knownGaps: [],
      exempt: [],
      lastUpdated: new Date().toISOString(),
      version: 1,
    };
  }

  const content = readFileSync(BASELINE_PATH, 'utf-8');
  const parsed: unknown = JSON.parse(content);
  return BaselineFileSchema.parse(parsed);
}

/**
 * Save baseline file
 */
function saveBaseline(baseline: BaselineFile): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * Collect audit data without printing
 */
function collectAuditData(): AuditResult {
  const allServices = findServiceFiles();
  const baseline = loadBaseline();

  const auditableServices = allServices.filter(s => !baseline.exempt.includes(s));
  const testedServices = findTestedServices(auditableServices);
  const untestedServices = auditableServices.filter(s => !testedServices.includes(s));

  const coverage =
    auditableServices.length > 0
      ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
      : 100;

  const newGaps = untestedServices.filter(s => !baseline.knownGaps.includes(s));
  const fixedGaps = baseline.knownGaps.filter(s => !untestedServices.includes(s));

  return {
    allServices,
    auditableServices,
    testedServices,
    untestedServices,
    coverage,
    newGaps,
    fixedGaps,
    baseline,
  };
}

/**
 * Print the coverage report
 */
function printReport(result: AuditResult): void {
  console.log(`📊 Service Integration Test Coverage Report`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total services:     ${result.allServices.length}`);
  console.log(`Exempt services:    ${result.baseline.exempt.length}`);
  console.log(`Auditable services: ${result.auditableServices.length}`);
  console.log(`With component test: ${result.testedServices.length}`);
  console.log(`Missing tests:      ${result.untestedServices.length}`);
  console.log(`Coverage:           ${result.coverage.toFixed(1)}%\n`);

  if (result.testedServices.length > 0) {
    console.log('✅ Services with component tests:');
    for (const service of result.testedServices) {
      console.log(`   ✓ ${service}`);
    }
    console.log();
  }

  if (result.untestedServices.length > 0) {
    console.log('📋 Services missing component tests:');
    for (const service of result.untestedServices) {
      console.log(`   - ${service}`);
    }
    console.log();
  }

  if (result.baseline.exempt.length > 0) {
    console.log('⏭️  Exempt services (no component test required):');
    for (const service of result.baseline.exempt) {
      console.log(`   ~ ${service}`);
    }
    console.log();
  }
}

/**
 * Print gap analysis (new gaps and fixed gaps)
 */
function printGapAnalysis(result: AuditResult): void {
  if (result.fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (now have component tests):');
    for (const gap of result.fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (result.newGaps.length > 0) {
    console.log('❌ NEW GAPS (services added without component tests):');
    for (const gap of result.newGaps) {
      console.log(`   ❌ ${gap}`);
    }
    console.log();
    console.log('💡 To fix: Add a .component.test.ts file for these services');
    console.log('   Or add to "exempt" in baseline if no component test needed');
    console.log('   Or run with --update-baseline to accept current state\n');
  }
}

/**
 * Main audit function
 */
function auditServiceIntegration(updateBaseline: boolean, strictMode: boolean): boolean {
  console.log('🔍 Auditing service integration test coverage...\n');

  const result = collectAuditData();
  printReport(result);

  if (updateBaseline) {
    console.log('📝 Updating baseline file...\n');
    const updatedBaseline: BaselineFile = {
      ...result.baseline,
      knownGaps: result.untestedServices,
      lastUpdated: new Date().toISOString(),
      version: result.baseline.version + 1,
    };
    saveBaseline(updatedBaseline);
    console.log(`✅ Baseline updated: ${BASELINE_PATH}\n`);
    return true;
  }

  printGapAnalysis(result);

  // Determine pass/fail
  if (strictMode && result.untestedServices.length > 0) {
    console.log('❌ STRICT MODE: All services must have component tests\n');
    return false;
  }

  if (!strictMode && result.newGaps.length > 0) {
    console.log('❌ RATCHET FAILED: New services added without component tests\n');
    return false;
  }

  console.log('✅ Service integration test audit passed\n');
  return true;
}

// Only run if executed directly (not imported as module)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const args = process.argv.slice(2);
  const updateBaselineFlag = args.includes('--update-baseline');
  const strictModeFlag = args.includes('--strict');

  const success = auditServiceIntegration(updateBaselineFlag, strictModeFlag);
  process.exit(success ? 0 : 1);
}

// Export for testing
export {
  findFiles,
  isReExportFile,
  findServiceFiles,
  findTestedServices,
  loadBaseline,
  saveBaseline,
  collectAuditData,
  auditServiceIntegration,
  BaselineFileSchema,
  BACKWARD_COMPAT_COMMENT_SEARCH_LINES,
  type BaselineFile,
  type AuditResult,
};
