#!/usr/bin/env npx tsx
/**
 * Contract Coverage Audit Script
 *
 * Audits API endpoint contract test coverage using a ratchet system:
 * - Finds all API Zod schemas in packages/common-types/src/schemas/api/
 * - Checks which schemas have corresponding contract tests
 * - Compares against a baseline file to detect NEW gaps
 * - Fails CI if NEW APIs are added without contract tests
 *
 * Usage:
 *   npx tsx scripts/testing/audit-contract-coverage.ts [--update-baseline] [--strict]
 *
 * Options:
 *   --update-baseline  Update the baseline file with current coverage
 *   --strict           Fail if ANY gap exists (not just new ones)
 *
 * The ratchet system allows existing gaps while blocking new ones.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

interface ContractCoverage {
  schemas: string[];
  testedSchemas: string[];
  untestedSchemas: string[];
  coverage: number;
  timestamp: string;
}

interface BaselineFile {
  knownGaps: string[];
  lastUpdated: string;
  version: number;
}

const BASELINE_PATH = join(projectRoot, 'contract-coverage-baseline.json');
const SCHEMAS_DIR = join(projectRoot, 'packages/common-types/src/schemas/api');
const CONTRACT_TESTS_DIR = join(projectRoot, 'packages/common-types/src/types');

/**
 * Find all Zod schema exports in API schema files
 */
function findApiSchemas(): string[] {
  const schemas: string[] = [];

  if (!existsSync(SCHEMAS_DIR)) {
    console.error(`Schemas directory not found: ${SCHEMAS_DIR}`);
    return schemas;
  }

  const files = readdirSync(SCHEMAS_DIR).filter(
    f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts'
  );

  for (const file of files) {
    const content = readFileSync(join(SCHEMAS_DIR, file), 'utf-8');

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
function findTestedSchemas(): string[] {
  const tested: string[] = [];

  const contractTestFiles = readdirSync(CONTRACT_TESTS_DIR).filter(f =>
    f.endsWith('.contract.test.ts')
  );

  for (const file of contractTestFiles) {
    const content = readFileSync(join(CONTRACT_TESTS_DIR, file), 'utf-8');

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
function loadBaseline(): BaselineFile {
  if (!existsSync(BASELINE_PATH)) {
    return {
      knownGaps: [],
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
function auditContractCoverage(updateBaseline: boolean, strictMode: boolean): boolean {
  console.log('🔍 Auditing API contract test coverage...\n');

  // Find all schemas and tested schemas
  const allSchemas = findApiSchemas();
  const testedSchemas = findTestedSchemas();

  // Determine which schemas are untested
  const testedSchemaNames = new Set(testedSchemas.map(s => s.split(':')[1]));
  const untestedSchemas = allSchemas.filter(s => !testedSchemaNames.has(s.split(':')[1]));

  // Calculate coverage
  const coverage =
    allSchemas.length > 0
      ? ((allSchemas.length - untestedSchemas.length) / allSchemas.length) * 100
      : 100;

  // Print results
  console.log(`📊 API Schema Coverage Report`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total schemas:    ${allSchemas.length}`);
  console.log(`Tested schemas:   ${allSchemas.length - untestedSchemas.length}`);
  console.log(`Untested schemas: ${untestedSchemas.length}`);
  console.log(`Coverage:         ${coverage.toFixed(1)}%\n`);

  if (untestedSchemas.length > 0) {
    console.log('📋 Untested schemas:');
    for (const schema of untestedSchemas) {
      console.log(`   - ${schema}`);
    }
    console.log();
  }

  // Load baseline and check for new gaps
  const baseline = loadBaseline();
  const newGaps = untestedSchemas.filter(s => !baseline.knownGaps.includes(s));
  const fixedGaps = baseline.knownGaps.filter(s => !untestedSchemas.includes(s));

  if (updateBaseline) {
    console.log('📝 Updating baseline file...\n');
    baseline.knownGaps = untestedSchemas;
    baseline.lastUpdated = new Date().toISOString();
    baseline.version += 1;
    saveBaseline(baseline);
    console.log(`✅ Baseline updated: ${BASELINE_PATH}\n`);
    return true;
  }

  // Report changes from baseline
  if (fixedGaps.length > 0) {
    console.log('🎉 Fixed gaps (removed from baseline):');
    for (const gap of fixedGaps) {
      console.log(`   ✅ ${gap}`);
    }
    console.log();
  }

  if (newGaps.length > 0) {
    console.log('❌ NEW GAPS (not in baseline):');
    for (const gap of newGaps) {
      console.log(`   ❌ ${gap}`);
    }
    console.log();
    console.log('💡 To fix: Add contract tests for these schemas');
    console.log('   Or run with --update-baseline to accept current state\n');
  }

  // Determine pass/fail
  if (strictMode) {
    if (untestedSchemas.length > 0) {
      console.log('❌ STRICT MODE: All schemas must have contract tests\n');
      return false;
    }
  } else {
    if (newGaps.length > 0) {
      console.log('❌ RATCHET FAILED: New APIs added without contract tests\n');
      return false;
    }
  }

  console.log('✅ Contract coverage audit passed\n');
  return true;
}

// Parse arguments
const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const strictMode = args.includes('--strict');

// Run audit
const success = auditContractCoverage(updateBaseline, strictMode);
process.exit(success ? 0 : 1);
