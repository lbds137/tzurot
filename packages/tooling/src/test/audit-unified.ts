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
import {
  includesServices,
  includesContracts,
  printServiceSection,
  printContractSection,
  printRatchetSummary,
} from './audit-reporting.js';

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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Scans colocated tests, inline tests, and e2e tests across multiple directories with regex extraction
function findTestedSchemas(projectRoot: string): string[] {
  const tested: string[] = [];

  // Scan colocated tests in schemas/api/ (e.g., persona.test.ts next to persona.ts)
  const schemasApiDir = join(projectRoot, 'packages/common-types/src/schemas/api');
  if (existsSync(schemasApiDir)) {
    const colocatedTestFiles = readdirSync(schemasApiDir).filter(f => f.endsWith('.test.ts'));

    for (const file of colocatedTestFiles) {
      const content = readFile(join(schemasApiDir, file));

      // Find schema imports (now relative: from './persona.js')
      const importMatches = content.matchAll(/from ['"]\.\/([\w-]+)(?:\.js)?['"]/g);
      for (const match of importMatches) {
        const schemaFile = match[1];

        // Find which schemas from this file are actually used
        const schemaUsageMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
        for (const usageMatch of schemaUsageMatches) {
          tested.push(`${schemaFile}:${usageMatch[1]}`);
        }
      }

      // Also check for .parse() usage (some tests use .parse instead of .safeParse)
      const parseMatches = content.matchAll(/(\w+Schema)\.parse\(/g);
      for (const match of parseMatches) {
        const importMatches2 = content.matchAll(/from ['"]\.\/([\w-]+)(?:\.js)?['"]/g);
        for (const importMatch of importMatches2) {
          tested.push(`${importMatch[1]}:${match[1]}`);
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
