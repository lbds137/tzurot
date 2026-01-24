/**
 * Contract Coverage Audit
 *
 * Wraps the existing audit-contract-coverage.ts script logic
 * for integration with the ops CLI.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface BaselineFile {
  knownGaps: string[];
  lastUpdated: string;
  version: number;
}

export interface ContractAuditResult {
  allSchemas: string[];
  testedSchemas: string[];
  untestedSchemas: string[];
  coverage: number;
  newGaps: string[];
  fixedGaps: string[];
  baseline: BaselineFile;
}

export interface AuditContractsOptions {
  update?: boolean;
  strict?: boolean;
}

/**
 * Find all Zod schema exports in API schema files
 */
function findApiSchemas(projectRoot: string): string[] {
  const schemas: string[] = [];
  const schemasDir = join(projectRoot, 'packages/common-types/src/schemas/api');

  if (!existsSync(schemasDir)) {
    console.error(`Schemas directory not found: ${schemasDir}`);
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

  const contractTestFiles = readdirSync(contractTestsDir).filter(f =>
    f.endsWith('.contract.test.ts')
  );

  for (const file of contractTestFiles) {
    const content = readFileSync(join(contractTestsDir, file), 'utf-8');

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

    // Also check for inline schema tests (schemas defined in test fixtures)
    const inlineMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
    for (const match of inlineMatches) {
      // If schema name contains common API schema patterns
      if (
        match[1].includes('Request') ||
        match[1].includes('Response') ||
        match[1].includes('Schema')
      ) {
        // Try to find the source file
        const possibleFiles = ['api-types', 'schemas'];
        for (const f of possibleFiles) {
          tested.push(`${f}:${match[1]}`);
        }
      }
    }
  }

  // Also check integration tests for schema usage
  const integrationTestsDir = join(projectRoot, 'tests/integration');
  if (existsSync(integrationTestsDir)) {
    const integrationFiles = readdirSync(integrationTestsDir).filter(f => f.endsWith('.test.ts'));

    for (const file of integrationFiles) {
      const content = readFileSync(join(integrationTestsDir, file), 'utf-8');

      // Find schemas used in integration tests
      const schemaUsageMatches = content.matchAll(/(\w+Schema)\.safeParse/g);
      for (const match of schemaUsageMatches) {
        tested.push(`integration:${match[1]}`);
      }
    }
  }

  // Deduplicate
  return [...new Set(tested)].sort();
}

/**
 * Load baseline file or create empty one
 */
function loadBaseline(projectRoot: string): BaselineFile {
  const baselinePath = join(projectRoot, 'contract-coverage-baseline.json');

  if (!existsSync(baselinePath)) {
    return {
      knownGaps: [],
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
  const baselinePath = join(projectRoot, 'contract-coverage-baseline.json');
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

/**
 * Collect audit data without printing
 */
export function collectContractAuditData(projectRoot: string): ContractAuditResult {
  const allSchemas = findApiSchemas(projectRoot);
  const testedSchemas = findTestedSchemas(projectRoot);
  const baseline = loadBaseline(projectRoot);

  // Determine which schemas are untested
  const testedSchemaNames = new Set(testedSchemas.map(s => s.split(':')[1]));
  const untestedSchemas = allSchemas.filter(s => !testedSchemaNames.has(s.split(':')[1]));

  // Calculate coverage
  const coverage =
    allSchemas.length > 0
      ? ((allSchemas.length - untestedSchemas.length) / allSchemas.length) * 100
      : 100;

  const newGaps = untestedSchemas.filter(s => !baseline.knownGaps.includes(s));
  const fixedGaps = baseline.knownGaps.filter(s => !untestedSchemas.includes(s));

  return {
    allSchemas,
    testedSchemas,
    untestedSchemas,
    coverage,
    newGaps,
    fixedGaps,
    baseline,
  };
}

/**
 * Print the coverage report
 */
function printReport(result: ContractAuditResult): void {
  console.log(`📊 API Schema Coverage Report`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total schemas:    ${result.allSchemas.length}`);
  console.log(`Tested schemas:   ${result.allSchemas.length - result.untestedSchemas.length}`);
  console.log(`Untested schemas: ${result.untestedSchemas.length}`);
  console.log(`Coverage:         ${result.coverage.toFixed(1)}%\n`);

  if (result.untestedSchemas.length > 0) {
    console.log('📋 Untested schemas:');
    for (const schema of result.untestedSchemas) {
      console.log(`   - ${schema}`);
    }
    console.log();
  }
}

/**
 * Print gap analysis
 */
function printGapAnalysis(result: ContractAuditResult): void {
  if (result.fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (removed from baseline):');
    for (const gap of result.fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (result.newGaps.length > 0) {
    console.log('❌ NEW GAPS (not in baseline):');
    for (const gap of result.newGaps) {
      console.log(`   ❌ ${gap}`);
    }
    console.log();
    console.log('💡 To fix: Add contract tests for these schemas');
    console.log('   Or run: pnpm ops test:audit-contracts --update\n');
  }
}

/**
 * Main audit function
 */
export function auditContracts(options: AuditContractsOptions = {}): boolean {
  const { update = false, strict = false } = options;
  const projectRoot = process.cwd();

  console.log('🔍 Auditing API contract test coverage...\n');

  const result = collectContractAuditData(projectRoot);
  printReport(result);

  if (update) {
    console.log('📝 Updating baseline file...\n');
    const updatedBaseline: BaselineFile = {
      knownGaps: result.untestedSchemas,
      lastUpdated: new Date().toISOString(),
      version: result.baseline.version + 1,
    };
    saveBaseline(projectRoot, updatedBaseline);
    console.log(`✅ Baseline updated: contract-coverage-baseline.json\n`);
    return true;
  }

  printGapAnalysis(result);

  // Determine pass/fail (caller handles exit codes for flexibility)
  if (strict && result.untestedSchemas.length > 0) {
    console.log('❌ STRICT MODE: All schemas must have contract tests\n');
    return false;
  }

  if (!strict && result.newGaps.length > 0) {
    console.log('❌ RATCHET FAILED: New APIs added without contract tests\n');
    return false;
  }

  console.log('✅ Contract coverage audit passed\n');
  return true;
}
