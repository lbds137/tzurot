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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

interface BaselineFile {
  knownGaps: string[];
  exempt: string[]; // Services that don't need component tests (pure logic, re-exports)
  lastUpdated: string;
  version: number;
}

const BASELINE_PATH = join(projectRoot, 'service-integration-baseline.json');

// Directories to search for service files
const SERVICE_DIRS = [
  join(projectRoot, 'services/ai-worker/src'),
  join(projectRoot, 'services/api-gateway/src'),
  join(projectRoot, 'services/bot-client/src'),
  join(projectRoot, 'packages/common-types/src'),
];

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
  // (must appear in first 10 lines of file to indicate the whole file is a compat shim)
  const firstLines = content.split('\n').slice(0, 10).join('\n').toLowerCase();
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
 * Load baseline file or create default one
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
  return JSON.parse(content) as BaselineFile;
}

/**
 * Save baseline file
 */
function saveBaseline(baseline: BaselineFile): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * Main audit function
 */
function auditServiceIntegration(updateBaseline: boolean, strictMode: boolean): boolean {
  console.log('🔍 Auditing service integration test coverage...\n');

  // Find all services
  const allServices = findServiceFiles();
  const baseline = loadBaseline();

  // Filter out exempt services
  const auditableServices = allServices.filter(s => !baseline.exempt.includes(s));

  // Find tested services
  const testedServices = findTestedServices(auditableServices);

  // Determine which services are untested
  const untestedServices = auditableServices.filter(s => !testedServices.includes(s));

  // Calculate coverage
  const coverage =
    auditableServices.length > 0
      ? ((auditableServices.length - untestedServices.length) / auditableServices.length) * 100
      : 100;

  // Print results
  console.log(`📊 Service Integration Test Coverage Report`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total services:     ${allServices.length}`);
  console.log(`Exempt services:    ${baseline.exempt.length}`);
  console.log(`Auditable services: ${auditableServices.length}`);
  console.log(`With component test: ${testedServices.length}`);
  console.log(`Missing tests:      ${untestedServices.length}`);
  console.log(`Coverage:           ${coverage.toFixed(1)}%\n`);

  if (testedServices.length > 0) {
    console.log('✅ Services with component tests:');
    for (const service of testedServices) {
      console.log(`   ✓ ${service}`);
    }
    console.log();
  }

  if (untestedServices.length > 0) {
    console.log('📋 Services missing component tests:');
    for (const service of untestedServices) {
      console.log(`   - ${service}`);
    }
    console.log();
  }

  if (baseline.exempt.length > 0) {
    console.log('⏭️  Exempt services (no component test required):');
    for (const service of baseline.exempt) {
      console.log(`   ~ ${service}`);
    }
    console.log();
  }

  // Check for new gaps
  const newGaps = untestedServices.filter(s => !baseline.knownGaps.includes(s));
  const fixedGaps = baseline.knownGaps.filter(s => !untestedServices.includes(s));

  if (updateBaseline) {
    console.log('📝 Updating baseline file...\n');
    baseline.knownGaps = untestedServices;
    baseline.lastUpdated = new Date().toISOString();
    baseline.version += 1;
    saveBaseline(baseline);
    console.log(`✅ Baseline updated: ${BASELINE_PATH}\n`);
    return true;
  }

  // Report changes from baseline
  if (fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (now have component tests):');
    for (const gap of fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (newGaps.length > 0) {
    console.log('❌ NEW GAPS (services added without component tests):');
    for (const gap of newGaps) {
      console.log(`   ❌ ${gap}`);
    }
    console.log();
    console.log('💡 To fix: Add a .component.test.ts file for these services');
    console.log('   Or add to "exempt" in baseline if no component test needed');
    console.log('   Or run with --update-baseline to accept current state\n');
  }

  // Determine pass/fail
  if (strictMode) {
    if (untestedServices.length > 0) {
      console.log('❌ STRICT MODE: All services must have component tests\n');
      return false;
    }
  } else {
    if (newGaps.length > 0) {
      console.log('❌ RATCHET FAILED: New services added without component tests\n');
      return false;
    }
  }

  console.log('✅ Service integration test audit passed\n');
  return true;
}

// Parse arguments
const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const strictMode = args.includes('--strict');

// Run audit
const success = auditServiceIntegration(updateBaseline, strictMode);
process.exit(success ? 0 : 1);
