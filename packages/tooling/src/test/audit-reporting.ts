/**
 * Audit Reporting
 *
 * Formatted console output for the unified test coverage audit.
 * Extracted from audit-unified.ts to stay within max-lines limits.
 */

import type { ServiceAuditResult, ContractAuditResult } from './audit-utils.js';

interface UnifiedAuditResult {
  services: ServiceAuditResult;
  contracts: ContractAuditResult;
  servicesPass: boolean;
  contractsPass: boolean;
}

export function includesServices(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'services';
}

export function includesContracts(category?: 'services' | 'contracts'): boolean {
  return !category || category === 'contracts';
}

/**
 * Print service audit section
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Formats 5 conditional report sections (auto-exempt, covered, fixed, gaps, tips) with verbose toggling
export function printServiceSection(result: ServiceAuditResult, verbose: boolean): void {
  console.log('📦 SERVICE TESTS (DB interaction testing)');
  console.log('─'.repeat(60));
  console.log(`Total services:     ${result.allServices.length}`);
  console.log(`With Prisma:        ${result.servicesWithPrisma.length} (need .component.test.ts)`);
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
    console.log('💡 To fix: Add a .component.test.ts file for these services');
    console.log('   Or add @audit-ignore: database-testing comment to opt out');
    console.log('   Or run: pnpm ops test:audit --update\n');
  }
}

/**
 * Print contract audit section
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Formats 4 conditional report sections (tested, fixed, gaps, tips) with verbose toggling and truncation
export function printContractSection(result: ContractAuditResult, verbose: boolean): void {
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
export function printRatchetSummary(
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
