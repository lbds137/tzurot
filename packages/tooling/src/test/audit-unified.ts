/**
 * Unified Test Coverage Audit
 *
 * Combines service and contract audits into a single tool with unified baseline.
 * Replaces separate audit-services.ts and audit-contracts.ts tools.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { collectContractAuditData, type ContractAuditResult } from './audit-contracts.js';
import { collectServiceAuditData, type ServiceAuditResult } from './audit-services.js';

export interface UnifiedBaseline {
  version: number;
  lastUpdated: string;
  services: {
    knownGaps: string[];
    exempt: string[];
  };
  contracts: {
    knownGaps: string[];
  };
  notes: {
    serviceExemptionCriteria: string;
    contractExemptionCriteria: string;
  };
}

export interface UnifiedAuditResult {
  services: ServiceAuditResult;
  contracts: ContractAuditResult;
  baseline: UnifiedBaseline;
  servicesPass: boolean;
  contractsPass: boolean;
}

export interface AuditUnifiedOptions {
  update?: boolean;
  strict?: boolean;
  category?: 'services' | 'contracts';
  verbose?: boolean;
}

const UNIFIED_BASELINE_PATH = 'test-coverage-baseline.json';
const LEGACY_SERVICE_BASELINE_PATH = 'service-integration-baseline.json';
const LEGACY_CONTRACT_BASELINE_PATH = 'contract-coverage-baseline.json';

/**
 * Check if a category should be included in the audit
 */
function includesServices(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'services';
}

function includesContracts(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'contracts';
}

/**
 * Create default empty baseline
 */
function createEmptyBaseline(): UnifiedBaseline {
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    services: {
      knownGaps: [],
      exempt: [],
    },
    contracts: {
      knownGaps: [],
    },
    notes: {
      serviceExemptionCriteria: 'Services without direct Prisma calls are exempt',
      contractExemptionCriteria: 'None - all API schemas need contract tests',
    },
  };
}

/**
 * Migrate from legacy baselines to unified format
 */
export function migrateFromLegacyBaselines(projectRoot: string): UnifiedBaseline {
  const baseline = createEmptyBaseline();

  // Load legacy service baseline
  const legacyServicePath = join(projectRoot, LEGACY_SERVICE_BASELINE_PATH);
  if (existsSync(legacyServicePath)) {
    const legacyService = JSON.parse(readFileSync(legacyServicePath, 'utf-8')) as {
      knownGaps?: string[];
      exempt?: string[];
      notes?: { exemptionCriteria?: string };
    };
    baseline.services.knownGaps = legacyService.knownGaps ?? [];
    baseline.services.exempt = legacyService.exempt ?? [];
    if (legacyService.notes?.exemptionCriteria) {
      baseline.notes.serviceExemptionCriteria = legacyService.notes.exemptionCriteria;
    }
  }

  // Load legacy contract baseline
  const legacyContractPath = join(projectRoot, LEGACY_CONTRACT_BASELINE_PATH);
  if (existsSync(legacyContractPath)) {
    const legacyContract = JSON.parse(readFileSync(legacyContractPath, 'utf-8')) as {
      knownGaps?: string[];
    };
    baseline.contracts.knownGaps = legacyContract.knownGaps ?? [];
  }

  return baseline;
}

/**
 * Load unified baseline, migrating from legacy if needed
 */
export function loadUnifiedBaseline(projectRoot: string): UnifiedBaseline {
  const unifiedPath = join(projectRoot, UNIFIED_BASELINE_PATH);

  if (existsSync(unifiedPath)) {
    const content = readFileSync(unifiedPath, 'utf-8');
    return JSON.parse(content) as UnifiedBaseline;
  }

  // Migrate from legacy baselines
  return migrateFromLegacyBaselines(projectRoot);
}

/**
 * Save unified baseline
 */
export function saveUnifiedBaseline(projectRoot: string, baseline: UnifiedBaseline): void {
  const unifiedPath = join(projectRoot, UNIFIED_BASELINE_PATH);
  writeFileSync(unifiedPath, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * Collect unified audit data from both service and contract audits
 */
export function collectUnifiedAuditData(
  projectRoot: string,
  baseline: UnifiedBaseline
): UnifiedAuditResult {
  // Get service audit data - this uses its own baseline loading
  const services = collectServiceAuditData(projectRoot);

  // Get contract audit data - this uses its own baseline loading
  const contracts = collectContractAuditData(projectRoot);

  // Override the new/fixed gaps based on unified baseline
  const serviceNewGaps = services.untestedServices.filter(
    s => !baseline.services.knownGaps.includes(s)
  );
  const serviceFixedGaps = baseline.services.knownGaps.filter(
    s => !services.untestedServices.includes(s)
  );

  const contractNewGaps = contracts.untestedSchemas.filter(
    s => !baseline.contracts.knownGaps.includes(s)
  );
  const contractFixedGaps = baseline.contracts.knownGaps.filter(
    s => !contracts.untestedSchemas.includes(s)
  );

  // Update results with unified baseline gap info
  services.newGaps = serviceNewGaps;
  services.fixedGaps = serviceFixedGaps;
  contracts.newGaps = contractNewGaps;
  contracts.fixedGaps = contractFixedGaps;

  return {
    services,
    contracts,
    baseline,
    servicesPass: serviceNewGaps.length === 0,
    contractsPass: contractNewGaps.length === 0,
  };
}

/**
 * Print service audit section
 */
function printServiceSection(result: ServiceAuditResult, verbose: boolean): void {
  console.log('📦 SERVICE TESTS (DB interaction testing)');
  console.log('─'.repeat(60));
  console.log(`Total services:     ${result.allServices.length}`);
  console.log(`Exempt:             ${result.baseline.exempt.length} (no direct Prisma calls)`);
  console.log(`Auditable:          ${result.auditableServices.length}`);
  console.log(`Covered:            ${result.testedServices.length} (via .int.test.ts)`);
  console.log(`Gaps:               ${result.untestedServices.length}`);
  console.log();

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
    console.log('   Or add to "exempt" in baseline if no test needed');
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

/**
 * Create updated baseline for save
 */
function createUpdatedBaseline(
  baseline: UnifiedBaseline,
  result: UnifiedAuditResult,
  category?: 'services' | 'contracts'
): UnifiedBaseline {
  return {
    ...baseline,
    version: baseline.version + 1,
    lastUpdated: new Date().toISOString(),
    services: {
      ...baseline.services,
      knownGaps: includesServices(category)
        ? result.services.untestedServices
        : baseline.services.knownGaps,
    },
    contracts: {
      ...baseline.contracts,
      knownGaps: includesContracts(category)
        ? result.contracts.untestedSchemas
        : baseline.contracts.knownGaps,
    },
  };
}

/**
 * Determine if audit passes based on mode and category
 */
function checkAuditResult(
  result: UnifiedAuditResult,
  strict: boolean,
  category?: 'services' | 'contracts'
): { pass: boolean; message?: string } {
  // Strict mode: all gaps must be closed
  if (strict) {
    const servicesEmpty =
      !includesServices(category) || result.services.untestedServices.length === 0;
    const contractsEmpty =
      !includesContracts(category) || result.contracts.untestedSchemas.length === 0;

    if (!servicesEmpty || !contractsEmpty) {
      return { pass: false, message: '\n❌ STRICT MODE: All gaps must be closed\n' };
    }
  }

  // Ratchet mode: no new gaps
  const servicesPass = !includesServices(category) || result.servicesPass;
  const contractsPass = !includesContracts(category) || result.contractsPass;

  if (!servicesPass || !contractsPass) {
    return { pass: false, message: '\n❌ RATCHET FAILED: New untested code detected\n' };
  }

  return { pass: true };
}

/**
 * Print audit sections based on category filter
 */
function printAuditSections(
  result: UnifiedAuditResult,
  category: 'services' | 'contracts' | undefined,
  verbose: boolean
): void {
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
  printAuditSections(result, category, verbose);

  // Handle update mode
  if (update) {
    console.log('📝 Updating baseline file...\n');
    const updatedBaseline = createUpdatedBaseline(baseline, result, category);
    saveUnifiedBaseline(projectRoot, updatedBaseline);
    console.log(`✅ Baseline updated: ${UNIFIED_BASELINE_PATH}\n`);
    return true;
  }

  // Print summary and check result
  printRatchetSummary(result, category);
  console.log('═'.repeat(60));

  const auditResult = checkAuditResult(result, strict, category);
  if (!auditResult.pass) {
    console.log(auditResult.message);
    return false;
  }

  console.log();
  return true;
}
