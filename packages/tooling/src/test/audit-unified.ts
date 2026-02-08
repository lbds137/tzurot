/**
 * Unified Test Coverage Audit
 *
 * Audits both service integration tests and contract tests.
 * Services are auto-detected for Prisma usage (no manual exempt list).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import {
  type UnifiedBaseline,
  type ServiceAuditResult,
  type ContractAuditResult,
  findFiles,
  isReExportFile,
  hasPrismaUsage,
  hasAuditIgnoreComment,
  createEmptyBaseline,
  getRelativePath,
  dirname,
  fileExists,
  readFile,
} from './audit-utils.js';

/* eslint-disable sonarjs/cognitive-complexity -- pre-existing */

// Re-export types for consumers
interface UnifiedAuditResult {
  services: ServiceAuditResult;
  contracts: ContractAuditResult;
  baseline: UnifiedBaseline;
  servicesPass: boolean;
  contractsPass: boolean;
}

interface AuditUnifiedOptions {
  update?: boolean;
  strict?: boolean;
  category?: 'services' | 'contracts';
  verbose?: boolean;
}

const UNIFIED_BASELINE_PATH = '.github/baselines/test-coverage-baseline.json';

// ============================================================================
// Service Audit Logic
// ============================================================================

/**
 * Find all service files in the project
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
    const files = findFiles(dir, /Service\.ts$/);
    for (const file of files) {
      // Skip test files
      if (file.endsWith('.test.ts') || file.endsWith('.int.test.ts')) continue;

      // Skip re-export files
      if (isReExportFile(file)) continue;

      const relativePath = getRelativePath(projectRoot, file);
      services.push(relativePath);
    }
  }

  return services.sort();
}

/**
 * Find services that have integration tests (*.int.test.ts)
 */
function findTestedServices(projectRoot: string, services: string[]): string[] {
  const tested: string[] = [];

  for (const service of services) {
    const fullPath = join(projectRoot, service);
    const dir = dirname(fullPath);
    const baseName = basename(service, '.ts');

    const intTestPath = join(dir, `${baseName}.int.test.ts`);

    if (fileExists(intTestPath)) {
      tested.push(service);
    }
  }

  return tested.sort();
}

/**
 * Collect service audit data with auto-detection of Prisma usage
 */
function collectServiceAuditData(
  projectRoot: string,
  baseline: UnifiedBaseline
): ServiceAuditResult {
  const allServices = findServiceFiles(projectRoot);

  // Auto-detect which services use Prisma (need integration tests)
  const servicesWithPrisma: string[] = [];
  const servicesWithoutPrisma: string[] = [];

  for (const service of allServices) {
    const fullPath = join(projectRoot, service);

    // Check for @audit-ignore comment (escape hatch)
    if (hasAuditIgnoreComment(fullPath)) {
      servicesWithoutPrisma.push(service);
      continue;
    }

    if (hasPrismaUsage(fullPath)) {
      servicesWithPrisma.push(service);
    } else {
      servicesWithoutPrisma.push(service);
    }
  }

  // Only services with Prisma need integration tests
  const testedServices = findTestedServices(projectRoot, servicesWithPrisma);
  const untestedServices = servicesWithPrisma.filter(s => !testedServices.includes(s));

  const coverage =
    servicesWithPrisma.length > 0
      ? ((servicesWithPrisma.length - untestedServices.length) / servicesWithPrisma.length) * 100
      : 100;

  const newGaps = untestedServices.filter(s => !baseline.services.knownGaps.includes(s));
  const fixedGaps = baseline.services.knownGaps.filter(s => !untestedServices.includes(s));

  return {
    allServices,
    servicesWithPrisma,
    servicesWithoutPrisma,
    testedServices,
    untestedServices,
    coverage,
    newGaps,
    fixedGaps,
  };
}

// ============================================================================
// Contract Audit Logic
// ============================================================================

/**
 * Find all Zod schema exports in API schema files
 */
function findApiSchemas(projectRoot: string): string[] {
  const schemas: string[] = [];
  const schemasDir = join(projectRoot, 'packages/common-types/src/schemas/api');

  if (!existsSync(schemasDir)) {
    return schemas;
  }

  const files = readdirSync(schemasDir).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts'
  );

  for (const file of files) {
    const content = readFileSync(join(schemasDir, file), 'utf-8');

    // Find exported Zod schemas (export const *Schema = z.*)
    const schemaMatches = content.matchAll(/export const (\w+Schema)\s*=/g);
    for (const match of schemaMatches) {
      schemas.push(`${basename(file, '.ts')}:${match[1]}`);
    }
  }

  return schemas.sort();
}

/**
 * Find schemas that have corresponding contract tests
 */
function findTestedSchemas(projectRoot: string): string[] {
  const tested: string[] = [];
  const contractTestsDir = join(projectRoot, 'packages/common-types/src/types');

  if (!existsSync(contractTestsDir)) {
    return tested;
  }

  const contractTestFiles = readdirSync(contractTestsDir).filter(f =>
    f.endsWith('.schema.test.ts')
  );

  for (const file of contractTestFiles) {
    const content = readFile(join(contractTestsDir, file));

    // Find schema imports from schemas/api
    const importMatches = content.matchAll(/from ['"].*schemas\/api\/(\w+)['"]/g);
    for (const match of importMatches) {
      const schemaFile = match[1];

      // Find which schemas from this file are actually used
      const schemaUsageMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
      for (const usageMatch of schemaUsageMatches) {
        tested.push(`${schemaFile}:${usageMatch[1]}`);
      }
    }

    // Also check for inline schema tests
    const inlineMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
    for (const match of inlineMatches) {
      if (
        match[1].includes('Request') ||
        match[1].includes('Response') ||
        match[1].includes('Schema')
      ) {
        const possibleFiles = ['api-types', 'schemas'];
        for (const f of possibleFiles) {
          tested.push(`${f}:${match[1]}`);
        }
      }
    }
  }

  // Also check e2e tests for schema usage
  const e2eTestsDir = join(projectRoot, 'tests/e2e');
  if (existsSync(e2eTestsDir)) {
    const e2eFiles = readdirSync(e2eTestsDir).filter(f => f.endsWith('.e2e.test.ts'));

    for (const file of e2eFiles) {
      const content = readFile(join(e2eTestsDir, file));

      const schemaUsageMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
      for (const match of schemaUsageMatches) {
        tested.push(`e2e:${match[1]}`);
      }
    }
  }

  return [...new Set(tested)].sort();
}

/**
 * Collect contract audit data
 */
function collectContractAuditData(
  projectRoot: string,
  baseline: UnifiedBaseline
): ContractAuditResult {
  const allSchemas = findApiSchemas(projectRoot);
  const testedSchemas = findTestedSchemas(projectRoot);

  const testedSchemaNames = new Set(testedSchemas.map(s => s.split(':')[1]));
  const untestedSchemas = allSchemas.filter(s => !testedSchemaNames.has(s.split(':')[1]));

  const coverage =
    allSchemas.length > 0
      ? ((allSchemas.length - untestedSchemas.length) / allSchemas.length) * 100
      : 100;

  const newGaps = untestedSchemas.filter(s => !baseline.contracts.knownGaps.includes(s));
  const fixedGaps = baseline.contracts.knownGaps.filter(s => !untestedSchemas.includes(s));

  return {
    allSchemas,
    testedSchemas,
    untestedSchemas,
    coverage,
    newGaps,
    fixedGaps,
  };
}

// ============================================================================
// Baseline Management
// ============================================================================

/**
 * Load unified baseline
 */
export function loadUnifiedBaseline(projectRoot: string): UnifiedBaseline {
  const unifiedPath = join(projectRoot, UNIFIED_BASELINE_PATH);

  if (existsSync(unifiedPath)) {
    const content = readFileSync(unifiedPath, 'utf-8');
    const baseline = JSON.parse(content) as UnifiedBaseline;

    // Ensure services section exists (migrate from old format)
    if (!baseline.services) {
      baseline.services = { knownGaps: [] };
    }

    return baseline;
  }

  return createEmptyBaseline();
}

/**
 * Save unified baseline
 */
export function saveUnifiedBaseline(projectRoot: string, baseline: UnifiedBaseline): void {
  const unifiedPath = join(projectRoot, UNIFIED_BASELINE_PATH);
  writeFileSync(unifiedPath, JSON.stringify(baseline, null, 2) + '\n');
}

// ============================================================================
// Reporting
// ============================================================================

function includesServices(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'services';
}

function includesContracts(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'contracts';
}

/**
 * Print service audit section
 */
function printServiceSection(result: ServiceAuditResult, verbose: boolean): void {
  console.log('📦 SERVICE TESTS (DB interaction testing)');
  console.log('─'.repeat(60));
  console.log(`Total services:     ${result.allServices.length}`);
  console.log(`With Prisma:        ${result.servicesWithPrisma.length} (need .int.test.ts)`);
  console.log(`Without Prisma:     ${result.servicesWithoutPrisma.length} (auto-exempt)`);
  console.log(`Covered:            ${result.testedServices.length}`);
  console.log(`Gaps:               ${result.untestedServices.length}`);
  console.log();

  if (verbose && result.servicesWithoutPrisma.length > 0) {
    console.log('⏭️  Auto-exempt (no Prisma usage detected):');
    for (const service of result.servicesWithoutPrisma.slice(0, 10)) {
      console.log(`   ~ ${service}`);
    }
    if (result.servicesWithoutPrisma.length > 10) {
      console.log(`   ... and ${result.servicesWithoutPrisma.length - 10} more`);
    }
    console.log();
  }

  if (verbose && result.testedServices.length > 0) {
    console.log('✅ Covered:');
    for (const service of result.testedServices) {
      console.log(`   ✓ ${service}`);
    }
    console.log();
  }

  if (result.fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (now have tests):');
    for (const gap of result.fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (result.untestedServices.length > 0) {
    console.log('📋 Known gaps (from baseline):');
    for (const gap of result.untestedServices) {
      const isNew = result.newGaps.includes(gap);
      const prefix = isNew ? '❌ NEW' : '-';
      console.log(`   ${prefix} ${gap}`);
    }
    console.log();
  }

  if (result.newGaps.length > 0) {
    console.log('💡 To fix: Add a .int.test.ts file for these services');
    console.log('   Or add @audit-ignore: database-testing comment to opt out');
    console.log('   Or run: pnpm ops test:audit --update\n');
  }
}

/**
 * Print contract audit section
 */
function printContractSection(result: ContractAuditResult, verbose: boolean): void {
  console.log('📜 CONTRACT TESTS (API schema validation)');
  console.log('─'.repeat(60));
  console.log(`Total schemas:      ${result.allSchemas.length}`);
  console.log(`Tested:             ${result.allSchemas.length - result.untestedSchemas.length}`);
  console.log(`Gaps:               ${result.untestedSchemas.length}`);
  console.log();

  if (verbose && result.testedSchemas.length > 0) {
    console.log('✅ Tested schemas:');
    for (const schema of result.testedSchemas.slice(0, 10)) {
      console.log(`   ✓ ${schema}`);
    }
    if (result.testedSchemas.length > 10) {
      console.log(`   ... and ${result.testedSchemas.length - 10} more`);
    }
    console.log();
  }

  if (result.fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (now have tests):');
    for (const gap of result.fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (result.untestedSchemas.length > 0) {
    console.log('📋 Known gaps (from baseline):');
    const displayCount = verbose
      ? result.untestedSchemas.length
      : Math.min(10, result.untestedSchemas.length);
    for (const gap of result.untestedSchemas.slice(0, displayCount)) {
      const isNew = result.newGaps.includes(gap);
      const prefix = isNew ? '❌ NEW' : '-';
      console.log(`   ${prefix} ${gap}`);
    }
    if (!verbose && result.untestedSchemas.length > 10) {
      console.log(
        `   ... and ${result.untestedSchemas.length - 10} more (use --verbose to see all)`
      );
    }
    console.log();
  }

  if (result.newGaps.length > 0) {
    console.log('💡 To fix: Add contract tests for these schemas');
    console.log('   Or run: pnpm ops test:audit --update\n');
  }
}

/**
 * Print ratchet summary
 */
function printRatchetSummary(
  result: UnifiedAuditResult,
  category?: 'services' | 'contracts'
): void {
  console.log('🎯 RATCHET SUMMARY');
  console.log('─'.repeat(60));

  if (includesServices(category)) {
    const servicesStatus = result.servicesPass ? '✅ PASS' : '❌ FAIL';
    const servicesDetail = result.servicesPass
      ? '(no new gaps)'
      : `(${result.services.newGaps.length} new gaps)`;
    console.log(`Service tests:  ${servicesStatus} ${servicesDetail}`);
  }

  if (includesContracts(category)) {
    const contractsStatus = result.contractsPass ? '✅ PASS' : '❌ FAIL';
    const contractsDetail = result.contractsPass
      ? '(no new gaps)'
      : `(${result.contracts.newGaps.length} new gaps)`;
    console.log(`Contract tests: ${contractsStatus} ${contractsDetail}`);
  }

  console.log();

  const servicesOk = includesServices(category) ? result.servicesPass : true;
  const contractsOk = includesContracts(category) ? result.contractsPass : true;

  if (servicesOk && contractsOk) {
    console.log('Overall:        ✅ ALL AUDITS PASSED');
  } else {
    console.log('Overall:        ❌ AUDIT FAILED');
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Collect unified audit data
 */
export function collectUnifiedAuditData(
  projectRoot: string,
  baseline: UnifiedBaseline
): UnifiedAuditResult {
  const services = collectServiceAuditData(projectRoot, baseline);
  const contracts = collectContractAuditData(projectRoot, baseline);

  return {
    services,
    contracts,
    baseline,
    servicesPass: services.newGaps.length === 0,
    contractsPass: contracts.newGaps.length === 0,
  };
}

/**
 * Main unified audit function
 */
export function auditUnified(options: AuditUnifiedOptions = {}): boolean {
  const { update = false, strict = false, category, verbose = false } = options;
  const projectRoot = process.cwd();

  console.log('═'.repeat(60));
  console.log('📊 Unified Test Coverage Audit');
  console.log('═'.repeat(60));
  console.log();

  const baseline = loadUnifiedBaseline(projectRoot);
  const result = collectUnifiedAuditData(projectRoot, baseline);

  // Print requested sections
  if (includesServices(category)) {
    printServiceSection(result.services, verbose);
    console.log('═'.repeat(60));
    console.log();
  }

  if (includesContracts(category)) {
    printContractSection(result.contracts, verbose);
    console.log('═'.repeat(60));
    console.log();
  }

  // Handle update mode
  if (update) {
    console.log('📝 Updating baseline file...\n');
    const updatedBaseline: UnifiedBaseline = {
      ...baseline,
      version: baseline.version + 1,
      lastUpdated: new Date().toISOString(),
      services: {
        // Include detected Prisma services for audit transparency
        detectedPrismaServices: includesServices(category)
          ? result.services.servicesWithPrisma
          : baseline.services.detectedPrismaServices,
        knownGaps: includesServices(category)
          ? result.services.untestedServices
          : baseline.services.knownGaps,
      },
      contracts: {
        knownGaps: includesContracts(category)
          ? result.contracts.untestedSchemas
          : baseline.contracts.knownGaps,
      },
    };
    saveUnifiedBaseline(projectRoot, updatedBaseline);
    console.log(`✅ Baseline updated: ${UNIFIED_BASELINE_PATH}\n`);
    return true;
  }

  // Print summary and check result
  printRatchetSummary(result, category);
  console.log('═'.repeat(60));

  // Strict mode: all gaps must be closed
  if (strict) {
    const servicesEmpty =
      !includesServices(category) || result.services.untestedServices.length === 0;
    const contractsEmpty =
      !includesContracts(category) || result.contracts.untestedSchemas.length === 0;

    if (!servicesEmpty || !contractsEmpty) {
      console.log('\n❌ STRICT MODE: All gaps must be closed\n');
      return false;
    }
  }

  // Ratchet mode: no new gaps
  const servicesPass = !includesServices(category) || result.servicesPass;
  const contractsPass = !includesContracts(category) || result.contractsPass;

  if (!servicesPass || !contractsPass) {
    console.log('\n❌ RATCHET FAILED: New untested code detected\n');
    return false;
  }

  console.log();
  return true;
}
