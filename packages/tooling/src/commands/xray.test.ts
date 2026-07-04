import { describe, it, expect } from 'vitest';

import { evaluateSuppressionCheck } from './xray.js';
import type { FlatSuppression } from '../xray/formatters/suppressions.js';
import type { SuppressionKind } from '../xray/types.js';

function flat(filePath: string, line: number, kind: SuppressionKind): FlatSuppression {
  return { filePath, packageName: 'pkg', suppression: { kind, line } };
}

describe('evaluateSuppressionCheck', () => {
  const rootDir = '/repo';

  it('passes with the total-count trend line when nothing is unjustified', () => {
    const result = evaluateSuppressionCheck([], 12, rootDir);
    expect(result.failed).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.summary).toBe('✓ No unjustified lint suppressions (12 total, all justified)');
  });

  it('fails and formats each violation as <relative-path>:<line>  <kind>', () => {
    const result = evaluateSuppressionCheck(
      [
        flat('/repo/packages/a/src/x.ts', 5, 'eslint-disable-next-line'),
        flat('/repo/services/b/src/y.ts', 9, 'ts-expect-error'),
      ],
      20,
      rootDir
    );
    expect(result.failed).toBe(true);
    expect(result.violations).toEqual([
      'packages/a/src/x.ts:5  eslint-disable-next-line',
      'services/b/src/y.ts:9  ts-expect-error',
    ]);
    expect(result.summary).toContain('2 unjustified lint suppressions found');
  });

  it('uses the singular noun for exactly one violation', () => {
    const result = evaluateSuppressionCheck([flat('/repo/x.ts', 1, 'ts-nocheck')], 3, rootDir);
    expect(result.failed).toBe(true);
    expect(result.summary).toContain('1 unjustified lint suppression found');
    expect(result.summary).not.toContain('suppressions found');
  });
});
