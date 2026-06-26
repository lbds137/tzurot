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

  it('does NOT include schema (a schema test is a plain unit test, not a tier)', () => {
    expect(CANONICAL_TEST_TIERS).not.toContain('schema');
  });
});

describe('TEST_FILE_KINDS', () => {
  it('is the four mechanically-distinguishable kinds (schema kind dropped)', () => {
    expect([...TEST_FILE_KINDS]).toEqual(['unit', 'component', 'integration', 'contract']);
  });
});

describe('TIER_FOR_KIND', () => {
  it('maps every file-kind to a canonical tier', () => {
    for (const kind of TEST_FILE_KINDS) {
      expect(CANONICAL_TEST_TIERS).toContain(TIER_FOR_KIND[kind]);
    }
  });

  it('maps the unit kind to the unit tier', () => {
    expect(TIER_FOR_KIND.unit).toBe('unit');
  });

  it('maps each renamed suffix kind to its same-named tier', () => {
    expect(TIER_FOR_KIND.component).toBe('component');
    expect(TIER_FOR_KIND.integration).toBe('integration');
    expect(TIER_FOR_KIND.contract).toBe('contract');
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

  it('classifies a .schema-suffixed file as unit (schema kind dropped)', () => {
    expect(classifyTestFile('packages/common-types/src/types/persona.schema.test.ts')).toBe('unit');
  });

  it('classifies a .component.test.ts as component', () => {
    expect(classifyTestFile('services/ai-worker/src/jobs/AIJobProcessor.component.test.ts')).toBe(
      'component'
    );
  });

  it('classifies a .integration.test.ts as integration', () => {
    expect(classifyTestFile('tests/e2e/example-flow.integration.test.ts')).toBe('integration');
  });

  it('classifies a .contract.test.ts as contract (suffix carries the tier, not location)', () => {
    expect(classifyTestFile('tests/e2e/contracts/BullMQJobConsumer.contract.test.ts')).toBe(
      'contract'
    );
  });

  it('returns null for non-test files', () => {
    expect(classifyTestFile('services/bot-client/src/foo.ts')).toBeNull();
    expect(classifyTestFile('README.md')).toBeNull();
    expect(classifyTestFile('services/bot-client/src/foo.d.ts')).toBeNull();
  });

  it('normalizes Windows separators before the suffix check', () => {
    expect(classifyTestFile('tests\\e2e\\contracts\\BullMQJobProducer.contract.test.ts')).toBe(
      'contract'
    );
  });
});
