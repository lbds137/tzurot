import { describe, it, expect } from 'vitest';
import { parseTextSummary, summarizeReport } from './mutation-scoped-report.js';

describe('summarizeReport', () => {
  it('counts killed/survived/noCoverage/other, excludes Ignored, and locates both failure kinds', () => {
    const report = JSON.stringify({
      files: {
        'src/x.ts': {
          mutants: [
            { status: 'Killed', location: { start: { line: 1 } } },
            { status: 'Survived', location: { start: { line: 3 } } },
            { status: 'NoCoverage', location: { start: { line: 7 } } },
            { status: 'Timeout', location: { start: { line: 8 } } },
            { status: 'Ignored', location: { start: { line: 9 } } },
          ],
        },
      },
    });
    expect(summarizeReport(report, 'packages/identity')).toEqual({
      generated: 4,
      killed: 1,
      survived: 1,
      noCoverage: 1,
      other: 1,
      survivors: [{ file: 'packages/identity/src/x.ts', line: 3 }],
      uncovered: [{ file: 'packages/identity/src/x.ts', line: 7 }],
    });
  });

  it('omits line for a mutant with no location instead of faking 0', () => {
    const report = JSON.stringify({
      files: {
        'src/x.ts': {
          mutants: [{ status: 'Survived' }, { status: 'NoCoverage' }],
        },
      },
    });
    expect(summarizeReport(report, 'packages/identity')).toEqual({
      generated: 2,
      killed: 0,
      survived: 1,
      noCoverage: 1,
      other: 0,
      survivors: [{ file: 'packages/identity/src/x.ts' }],
      uncovered: [{ file: 'packages/identity/src/x.ts' }],
    });
  });

  it('summarizes a 0-mutant report (empty files map) to all zeros — the types-only-diff shape', () => {
    // Live-probed Stryker 10 shape: with --allowEmpty and 0 mutants it still
    // writes the scoped JSON report, with `files` empty. The JSON path — not
    // the rowless-text error path — is what a types-only diff takes.
    expect(summarizeReport('{"files":{}}', 'packages/config-resolver')).toEqual({
      generated: 0,
      killed: 0,
      survived: 0,
      noCoverage: 0,
      other: 0,
      survivors: [],
      uncovered: [],
    });
  });
});

describe('parseTextSummary', () => {
  it('returns null when the output has no All files row — a rowless run is a failure, not zero mutants', () => {
    expect(parseTextSummary('a log line\nanother line, no table anywhere')).toBeNull();
  });

  it('parses a real All files row into counts', () => {
    expect(
      parseTextSummary(
        'All files       |  83.33 |   83.33 |        5 |         0 |          1 |        0 |        0 |'
      )
    ).toEqual({
      generated: 6,
      killed: 5,
      survived: 1,
      noCoverage: 0,
      other: 0,
      survivors: [],
      uncovered: [],
    });
  });
});
