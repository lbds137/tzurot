/**
 * Service Integration Test Audit
 *
 * Wraps the existing audit-service-integration.ts script logic
 * for integration with the ops CLI.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';

/** Number of lines to check for backward compatibility comments at file level */
const BACKWARD_COMPAT_COMMENT_SEARCH_LINES = 10;

export interface BaselineFile {
  knownGaps: string[];
  exempt: string[];
  lastUpdated: string;
  version: number;
}

export interface ServiceAuditResult {
  allServices: string[];
  auditableServices: string[];
  testedServices: string[];
  untestedServices: string[];
  coverage: number;
  newGaps: string[];
  fixedGaps: string[];
  baseline: BaselineFile;
}

export interface AuditServicesOptions {
  update?: boolean;
  strict?: boolean;
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
function findServiceFiles(projectRoot: string): string[] {
  const services: string[] = [];

  const serviceDirs = [
    join(projectRoot, 'services/ai-worker/src'),
    join(projectRoot, 'services/api-gateway/src'),
    join(projectRoot, 'services/bot-client/src'),
    join(projectRoot, 'packages/common-types/src'),
  ];

  for (const dir of serviceDirs) {
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
function findTestedServices(projectRoot: string, services: string[]): string[] {
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
 * Load baseline file
 */
function loadBaseline(projectRoot: string): BaselineFile {
  const baselinePath = join(projectRoot, 'service-integration-baseline.json');

  if (!existsSync(baselinePath)) {
    return {
      knownGaps: [],
      exempt: [],
      lastUpdated: new Date().toISOString(),
      version: 1,
    };
  }

  const content = readFileSync(baselinePath, 'utf-8');
  return JSON.parse(content) as BaselineFile;
}

/**
 * Save baseline file
 */
function saveBaseline(projectRoot: string, baseline: BaselineFile): void {
  const baselinePath = join(projectRoot, 'service-integration-baseline.json');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * Collect audit data without printing
 */
export function collectServiceAuditData(projectRoot: string): ServiceAuditResult {
  const allServices = findServiceFiles(projectRoot);
  const baseline = loadBaseline(projectRoot);

  const auditableServices = allServices.filter(s => !baseline.exempt.includes(s));
  const testedServices = findTestedServices(projectRoot, auditableServices);
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
function printReport(result: ServiceAuditResult): void {
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
 * Print gap analysis
 */
function printGapAnalysis(result: ServiceAuditResult): void {
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
    console.log('   Or run: pnpm ops test:audit-services --update\n');
  }
}

/**
 * Main audit function
 */
export function auditServices(options: AuditServicesOptions = {}): boolean {
  const { update = false, strict = false } = options;
  const projectRoot = process.cwd();

  console.log('🔍 Auditing service integration test coverage...\n');

  const result = collectServiceAuditData(projectRoot);
  printReport(result);

  if (update) {
    console.log('📝 Updating baseline file...\n');
    const updatedBaseline: BaselineFile = {
      ...result.baseline,
      knownGaps: result.untestedServices,
      lastUpdated: new Date().toISOString(),
      version: result.baseline.version + 1,
    };
    saveBaseline(projectRoot, updatedBaseline);
    console.log(`✅ Baseline updated: service-integration-baseline.json\n`);
    return true;
  }

  printGapAnalysis(result);

  // Determine pass/fail (caller handles exit codes for flexibility)
  if (strict && result.untestedServices.length > 0) {
    console.log('❌ STRICT MODE: All services must have component tests\n');
    return false;
  }

  if (!strict && result.newGaps.length > 0) {
    console.log('❌ RATCHET FAILED: New services added without component tests\n');
    return false;
  }

  console.log('✅ Service integration test audit passed\n');
  return true;
}
