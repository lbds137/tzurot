/**
 * Tests for the test-tier distribution report.
 */

import { describe, it, expect } from 'vitest';
import { buildTierReport, packageOf, formatTierReport, runTierReport } from './tier-report.js';
import { parseSummary } from '../audits/summary.js';

describe('packageOf', () => {
  it('collapses services/<pkg> to the package name', () => {
    expect(packageOf('services/bot-client/src/foo.test.ts')).toBe('bot-client');
  });

  it('collapses packages/<pkg> to the package name', () => {
    expect(packageOf('packages/common-types/src/foo.schema.test.ts')).toBe('common-types');
  });

  it('keeps the two-segment label for tests/e2e', () => {
    expect(packageOf('tests/e2e/database.e2e.test.ts')).toBe('tests/e2e');
    expect(packageOf('tests/e2e/contracts/BullMQJobConsumer.e2e.test.ts')).toBe('tests/e2e');
  });

  it('falls back to the first segment otherwise', () => {
    expect(packageOf('scripts/foo.test.ts')).toBe('scripts');
  });
});

describe('buildTierReport', () => {
  const paths = [
    'services/bot-client/src/a.test.ts',
    'services/bot-client/src/b.test.ts',
    'services/bot-client/src/c.int.test.ts',
    'services/ai-worker/src/d.int.test.ts',
    'packages/common-types/src/e.schema.test.ts',
    'tests/e2e/database.e2e.test.ts',
    'tests/e2e/contracts/BullMQJobConsumer.e2e.test.ts',
    'README.md', // ignored — not a test file
    'services/bot-client/src/f.ts', // ignored — not a test file
  ];

  it('totals only classified test files', () => {
    expect(buildTierReport(paths).total).toBe(7);
  });

  it('counts file-kinds correctly', () => {
    const { byKind } = buildTierReport(paths);
    expect(byKind.unit).toBe(2);
    expect(byKind.component).toBe(2); // the two .int.test.ts
    expect(byKind.schema).toBe(1);
    expect(byKind.integration).toBe(1); // non-contract .e2e
    expect(byKind.contract).toBe(1); // contracts/ .e2e
  });

  it('rolls schema and unit into the unit tier; surfaces e2e tier as 0', () => {
    const { byTier } = buildTierReport(paths);
    expect(byTier.unit).toBe(3); // 2 unit + 1 schema
    expect(byTier.component).toBe(2);
    expect(byTier.integration).toBe(1);
    expect(byTier.contract).toBe(1);
    expect(byTier.e2e).toBe(0); // we have no true black-box e2e
  });

  it('groups counts per package', () => {
    const { byPackage } = buildTierReport(paths);
    expect(byPackage.get('bot-client')).toMatchObject({ unit: 2, component: 1 });
    expect(byPackage.get('ai-worker')).toMatchObject({ component: 1 });
    expect(byPackage.get('tests/e2e')).toMatchObject({ integration: 1, contract: 1 });
  });
});

describe('formatTierReport', () => {
  it('renders the table, tier rollup, and legend', () => {
    const out = formatTierReport(buildTierReport(['services/bot-client/src/a.test.ts']));
    expect(out).toContain('package');
    expect(out).toContain('bot-client');
    expect(out).toContain('TOTAL');
    expect(out).toContain('By canonical tier');
    expect(out).toContain('Legend');
    expect(out).toContain('Report-only');
  });
});

describe('runTierReport', () => {
  it('emits a valid informational summary line in --summary mode', async () => {
    const lines: string[] = [];
    const spy = (msg?: unknown): void => {
      lines.push(String(msg));
    };
    const original = console.log;
    console.log = spy;
    try {
      await runTierReport({
        summary: true,
        paths: ['services/bot-client/src/a.test.ts', 'services/bot-client/src/b.int.test.ts'],
      });
    } finally {
      console.log = original;
    }
    const summary = parseSummary(lines[0]);
    expect(summary.tool).toBe('test:tiers');
    expect(summary.status).toBe('ok');
    expect(summary.findings).toBe(2);
  });
});
