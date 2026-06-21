/**
 * Tests for the shared test-tier taxonomy kernel.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_TEST_TIERS,
  TEST_FILE_KINDS,
  TIER_FOR_KIND,
  TEST_FILE_KIND_INFO,
  classifyTestFile,
} from './test-tiers.js';

describe('CANONICAL_TEST_TIERS', () => {
  it('is the five-tier Clemson model in isolation→integration order', () => {
    expect([...CANONICAL_TEST_TIERS]).toEqual([
      'unit',
      'component',
      'integration',
      'contract',
      'e2e',
    ]);
  });

  it('does NOT include schema (schema is a unit-tier variant, not a tier)', () => {
    expect(CANONICAL_TEST_TIERS).not.toContain('schema');
  });
});

describe('TIER_FOR_KIND', () => {
  it('maps every file-kind to a canonical tier', () => {
    for (const kind of TEST_FILE_KINDS) {
      expect(CANONICAL_TEST_TIERS).toContain(TIER_FOR_KIND[kind]);
    }
  });

  it('rolls schema and unit kinds both up to the unit tier', () => {
    expect(TIER_FOR_KIND.schema).toBe('unit');
    expect(TIER_FOR_KIND.unit).toBe('unit');
  });

  it('maps the int-suffix component kind to the component tier', () => {
    expect(TIER_FOR_KIND.component).toBe('component');
  });

  it('maps the non-contract e2e-suffix kind to the integration tier', () => {
    expect(TIER_FOR_KIND.integration).toBe('integration');
  });

  it('keeps every kind documented with a mechanical match rule', () => {
    for (const kind of TEST_FILE_KINDS) {
      expect(TEST_FILE_KIND_INFO[kind].matches).toBeTruthy();
      expect(TEST_FILE_KIND_INFO[kind].tier).toBe(TIER_FOR_KIND[kind]);
    }
  });
});

describe('classifyTestFile', () => {
  it('classifies a bare unit test', () => {
    expect(classifyTestFile('services/bot-client/src/foo.test.ts')).toBe('unit');
  });

  it('classifies a schema test by its .schema suffix', () => {
    expect(classifyTestFile('packages/common-types/src/types/persona.schema.test.ts')).toBe(
      'schema'
    );
  });

  it('classifies an .int.test.ts as component (not the suffix-literal "int")', () => {
    expect(classifyTestFile('services/ai-worker/src/jobs/AIJobProcessor.int.test.ts')).toBe(
      'component'
    );
  });

  it('classifies a non-contract e2e test as integration', () => {
    expect(classifyTestFile('tests/e2e/database.e2e.test.ts')).toBe('integration');
  });

  it('classifies an e2e test under tests/e2e/contracts/ as contract', () => {
    expect(classifyTestFile('tests/e2e/contracts/BullMQJobConsumer.e2e.test.ts')).toBe('contract');
  });

  it('returns null for non-test files', () => {
    expect(classifyTestFile('services/bot-client/src/foo.ts')).toBeNull();
    expect(classifyTestFile('README.md')).toBeNull();
    expect(classifyTestFile('services/bot-client/src/foo.d.ts')).toBeNull();
  });

  it('normalizes Windows separators before the location check', () => {
    expect(classifyTestFile('tests\\e2e\\contracts\\BullMQJobProducer.e2e.test.ts')).toBe(
      'contract'
    );
  });

  it('treats schema-suffixed files as schema even when not in common-types', () => {
    // Colocation rule allows schema tests anywhere; classification is by suffix,
    // not location.
    expect(classifyTestFile('services/api-gateway/src/schemas/api/persona.schema.test.ts')).toBe(
      'schema'
    );
  });
});
