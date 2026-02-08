import { describe, it, expect, vi } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: Object.assign((s: string) => s, { bold: (s: string) => s }),
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    bold: (s: string) => s,
    dim: (s: string) => s,
  },
}));

import { formatSuppressions } from './suppressions.js';
import type { XrayReport, SuppressionInfo, FileInfo, PackageInfo } from '../types.js';

function makeSuppression(overrides: Partial<SuppressionInfo> = {}): SuppressionInfo {
  return {
    kind: 'eslint-disable-next-line',
    line: 1,
    ...overrides,
  };
}

function makeFile(path: string, suppressions: SuppressionInfo[] = []): FileInfo {
  return {
    path,
    lineCount: 100,
    declarations: [],
    imports: [],
    suppressions,
  };
}

function makePackage(name: string, files: FileInfo[]): PackageInfo {
  return { name, path: `/root/${name}/src`, files };
}

function makeReport(packages: PackageInfo[]): XrayReport {
  return {
    generatedAt: new Date().toISOString(),
    packages,
    summary: {
      totalFiles: packages.reduce((sum, p) => sum + p.files.length, 0),
      totalClasses: 0,
      totalFunctions: 0,
      totalInterfaces: 0,
      totalTypes: 0,
      totalSuppressions: packages.reduce(
        (sum, p) => sum + p.files.reduce((fSum, f) => fSum + f.suppressions.length, 0),
        0
      ),
      byPackage: {},
    },
  };
}

describe('formatSuppressions', () => {
  it('should show "No suppressions found" for zero suppressions', () => {
    const report = makeReport([makePackage('test-pkg', [makeFile('/root/test-pkg/src/index.ts')])]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('SUPPRESSION AUDIT');
    expect(result).toContain('No suppressions found');
  });

  it('should count suppressions by kind correctly', () => {
    const report = makeReport([
      makePackage('pkg-a', [
        makeFile('/root/pkg-a/src/a.ts', [
          makeSuppression({ kind: 'eslint-disable-next-line' }),
          makeSuppression({ kind: 'eslint-disable-next-line' }),
          makeSuppression({ kind: 'ts-expect-error' }),
        ]),
      ]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('3 suppressions across 1 package');
    expect(result).toContain('By kind:');
    expect(result).toContain('eslint-disable-next-line');
    expect(result).toContain('ts-expect-error');
  });

  it('should count rules correctly and label missing rules', () => {
    const report = makeReport([
      makePackage('pkg-a', [
        makeFile('/root/pkg-a/src/a.ts', [
          makeSuppression({ rule: 'no-console' }),
          makeSuppression({ rule: 'no-console' }),
          makeSuppression({ rule: undefined }),
        ]),
      ]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('By rule');
    expect(result).toContain('no-console');
    expect(result).toContain('(no rule specified)');
  });

  it('should group by justification and warn on missing', () => {
    const report = makeReport([
      makePackage('pkg-a', [
        makeFile('/root/pkg-a/src/a.ts', [
          makeSuppression({ justification: 'pre-existing' }),
          makeSuppression({ justification: 'pre-existing' }),
          makeSuppression({ justification: undefined }),
          makeSuppression({ justification: '' }),
        ]),
      ]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('By justification:');
    expect(result).toContain('pre-existing');
    expect(result).toContain('No justification');
  });

  it('should show package breakdown with correct counts', () => {
    const report = makeReport([
      makePackage('bot-client', [
        makeFile('/root/bot-client/src/a.ts', [makeSuppression(), makeSuppression()]),
      ]),
      makePackage('api-gateway', [makeFile('/root/api-gateway/src/b.ts', [makeSuppression()])]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('By package:');
    expect(result).toContain('bot-client');
    expect(result).toContain('api-gateway');
    // bot-client should come first (2 > 1)
    const botIdx = result.indexOf('bot-client');
    const apiIdx = result.indexOf('api-gateway');
    expect(botIdx).toBeLessThan(apiIdx);
  });

  it('should sort files by suppression count descending', () => {
    const report = makeReport([
      makePackage('pkg-a', [
        makeFile('/root/pkg-a/src/few.ts', [makeSuppression()]),
        makeFile('/root/pkg-a/src/many.ts', [
          makeSuppression(),
          makeSuppression(),
          makeSuppression(),
        ]),
      ]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('Files with most suppressions');
    const manyIdx = result.indexOf('many.ts');
    const fewIdx = result.indexOf('few.ts');
    expect(manyIdx).toBeLessThan(fewIdx);
  });

  it('should handle mixed suppressions across multiple packages', () => {
    const report = makeReport([
      makePackage('svc-a', [
        makeFile('/root/svc-a/src/x.ts', [
          makeSuppression({
            kind: 'eslint-disable',
            rule: 'max-lines',
            justification: 'pre-existing',
          }),
          makeSuppression({ kind: 'ts-expect-error', justification: 'type mismatch in test' }),
        ]),
      ]),
      makePackage('svc-b', [
        makeFile('/root/svc-b/src/y.ts', [
          makeSuppression({ kind: 'eslint-disable-next-line', rule: 'max-lines' }),
        ]),
      ]),
    ]);
    const result = formatSuppressions(report, '/root');

    expect(result).toContain('3 suppressions across 2 packages');
    expect(result).toContain('max-lines');
    expect(result).toContain('svc-a');
    expect(result).toContain('svc-b');
  });
});
