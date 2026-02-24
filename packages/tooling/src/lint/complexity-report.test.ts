import { describe, it, expect } from 'vitest';

import {
  parseValueFromMessage,
  categorizeFindings,
  formatFinding,
  extractFindings,
  buildJSONOutput,
  type Finding,
} from './complexity-report.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    file: '/home/user/project/services/bot-client/src/SomeService.ts',
    rule: 'max-lines',
    message: 'File has too many lines (350). Maximum allowed is 400.',
    line: 1,
    currentValue: 350,
    threshold: 320,
    limit: 400,
    percentOfLimit: 87.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseValueFromMessage
// ---------------------------------------------------------------------------

describe('parseValueFromMessage', () => {
  it('extracts value from parenthesized format (max-lines)', () => {
    expect(parseValueFromMessage('File has too many lines (450). Maximum allowed is 400.')).toBe(
      450
    );
  });

  it('extracts value from parenthesized format (max-statements)', () => {
    expect(
      parseValueFromMessage('Function has too many statements (42). Maximum allowed is 40.')
    ).toBe(42);
  });

  it('extracts value from "of N" format (complexity)', () => {
    expect(parseValueFromMessage('Function has a complexity of 17.')).toBe(17);
  });

  it('extracts value from max-lines-per-function message', () => {
    expect(parseValueFromMessage('Function has too many lines (95). Maximum allowed is 80.')).toBe(
      95
    );
  });

  it('extracts value from max-depth message', () => {
    expect(parseValueFromMessage('Blocks are nested too deeply (5). Maximum allowed is 3.')).toBe(
      5
    );
  });

  it('returns 0 when no numeric value matches', () => {
    expect(parseValueFromMessage('Some unrelated message without numbers')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(parseValueFromMessage('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// categorizeFindings
// ---------------------------------------------------------------------------

describe('categorizeFindings', () => {
  it('groups findings by rule', () => {
    const findings: Finding[] = [
      makeFinding({ rule: 'max-lines', percentOfLimit: 90 }),
      makeFinding({ rule: 'complexity', percentOfLimit: 85 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 95 }),
      makeFinding({ rule: 'complexity', percentOfLimit: 110 }),
    ];

    const byRule = categorizeFindings(findings);

    expect(byRule.size).toBe(2);
    expect(byRule.get('max-lines')).toHaveLength(2);
    expect(byRule.get('complexity')).toHaveLength(2);
  });

  it('sorts each group by percentOfLimit descending', () => {
    const findings: Finding[] = [
      makeFinding({ rule: 'max-lines', percentOfLimit: 80 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 120 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 95 }),
    ];

    const byRule = categorizeFindings(findings);
    const maxLines = byRule.get('max-lines')!;

    expect(maxLines[0].percentOfLimit).toBe(120);
    expect(maxLines[1].percentOfLimit).toBe(95);
    expect(maxLines[2].percentOfLimit).toBe(80);
  });

  it('returns empty map for empty input', () => {
    const byRule = categorizeFindings([]);
    expect(byRule.size).toBe(0);
  });

  it('handles single finding', () => {
    const findings: Finding[] = [makeFinding({ rule: 'max-depth', percentOfLimit: 75 })];

    const byRule = categorizeFindings(findings);

    expect(byRule.size).toBe(1);
    expect(byRule.get('max-depth')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// formatFinding
// ---------------------------------------------------------------------------

describe('formatFinding', () => {
  const rootDir = '/home/user/project';

  it('contains relative path and line number', () => {
    const finding = makeFinding({
      file: '/home/user/project/services/bot-client/src/Foo.ts',
      line: 42,
    });

    const output = formatFinding(finding, rootDir);

    expect(output).toContain('services/bot-client/src/Foo.ts:42');
  });

  it('contains progress bar characters', () => {
    const finding = makeFinding({ percentOfLimit: 70 });

    const output = formatFinding(finding, rootDir);

    expect(output).toContain('█');
    expect(output).toContain('░');
  });

  it('contains percentage and current/limit values', () => {
    const finding = makeFinding({
      currentValue: 350,
      limit: 400,
      percentOfLimit: 87.5,
    });

    const output = formatFinding(finding, rootDir);

    expect(output).toContain('88%');
    expect(output).toContain('350/400');
  });

  it('clamps progress bar at 10 filled blocks for values over 100%', () => {
    const finding = makeFinding({ percentOfLimit: 150 });

    const output = formatFinding(finding, rootDir);

    // 10 filled blocks, 0 empty blocks
    expect(output).toContain('██████████');
    expect(output).not.toContain('░');
  });

  it('shows mostly empty bar for low percentages', () => {
    const finding = makeFinding({ percentOfLimit: 10 });

    const output = formatFinding(finding, rootDir);

    // 1 filled block, 9 empty blocks
    expect(output).toContain('█░░░░░░░░░');
  });
});

// ---------------------------------------------------------------------------
// extractFindings
// ---------------------------------------------------------------------------

describe('extractFindings', () => {
  it('extracts findings from ESLint results with matching rules', () => {
    const results = [
      {
        filePath: '/project/services/bot-client/src/Big.ts',
        messages: [
          {
            ruleId: 'max-lines',
            severity: 1,
            message: 'File has too many lines (450). Maximum allowed is 400.',
            line: 1,
            column: 1,
          },
        ],
        errorCount: 0,
        warningCount: 1,
      },
    ];

    const findings = extractFindings(results);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: '/project/services/bot-client/src/Big.ts',
      rule: 'max-lines',
      currentValue: 450,
      threshold: 320,
      limit: 400,
    });
  });

  it('ignores messages with non-matching ruleIds', () => {
    const results = [
      {
        filePath: '/project/src/foo.ts',
        messages: [
          {
            ruleId: 'no-unused-vars',
            severity: 1,
            message: "'x' is defined but never used.",
            line: 5,
            column: 7,
          },
          {
            ruleId: 'semi',
            severity: 2,
            message: 'Missing semicolon.',
            line: 10,
            column: 20,
          },
        ],
        errorCount: 1,
        warningCount: 1,
      },
    ];

    const findings = extractFindings(results);

    expect(findings).toHaveLength(0);
  });

  it('returns empty array for empty results', () => {
    expect(extractFindings([])).toEqual([]);
  });

  it('returns empty array when results have no messages', () => {
    const results = [
      {
        filePath: '/project/src/clean.ts',
        messages: [],
        errorCount: 0,
        warningCount: 0,
      },
    ];

    expect(extractFindings(results)).toEqual([]);
  });

  it('calculates percentOfLimit correctly', () => {
    const results = [
      {
        filePath: '/project/src/complex.ts',
        messages: [
          {
            ruleId: 'complexity',
            severity: 1,
            message: 'Function has a complexity of 17.',
            line: 10,
            column: 1,
          },
        ],
        errorCount: 0,
        warningCount: 1,
      },
    ];

    const findings = extractFindings(results);

    // complexity limit is 20, so 17/20 = 85%
    expect(findings[0].percentOfLimit).toBe(85);
    expect(findings[0].currentValue).toBe(17);
    expect(findings[0].limit).toBe(20);
    expect(findings[0].threshold).toBe(16);
  });

  it('extracts multiple findings from multiple files', () => {
    const results = [
      {
        filePath: '/project/src/a.ts',
        messages: [
          {
            ruleId: 'max-lines',
            severity: 1,
            message: 'File has too many lines (420). Maximum allowed is 400.',
            line: 1,
            column: 1,
          },
        ],
        errorCount: 0,
        warningCount: 1,
      },
      {
        filePath: '/project/src/b.ts',
        messages: [
          {
            ruleId: 'max-statements',
            severity: 1,
            message: 'Function has too many statements (45). Maximum allowed is 40.',
            line: 15,
            column: 1,
          },
          {
            ruleId: 'max-depth',
            severity: 1,
            message: 'Blocks are nested too deeply (4). Maximum allowed is 3.',
            line: 30,
            column: 5,
          },
        ],
        errorCount: 0,
        warningCount: 2,
      },
    ];

    const findings = extractFindings(results);

    expect(findings).toHaveLength(3);
    expect(findings.map(f => f.rule)).toEqual(['max-lines', 'max-statements', 'max-depth']);
  });

  it('mixes matching and non-matching rules correctly', () => {
    const results = [
      {
        filePath: '/project/src/mixed.ts',
        messages: [
          {
            ruleId: 'no-console',
            severity: 1,
            message: 'Unexpected console statement.',
            line: 1,
            column: 1,
          },
          {
            ruleId: 'complexity',
            severity: 1,
            message: 'Function has a complexity of 18.',
            line: 5,
            column: 1,
          },
          {
            ruleId: 'eqeqeq',
            severity: 2,
            message: "Expected '===' and instead saw '=='.",
            line: 12,
            column: 3,
          },
        ],
        errorCount: 1,
        warningCount: 2,
      },
    ];

    const findings = extractFindings(results);

    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('complexity');
    expect(findings[0].currentValue).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// buildJSONOutput
// ---------------------------------------------------------------------------

describe('buildJSONOutput', () => {
  it('has correct thresholds structure', () => {
    const findings: Finding[] = [];
    const byRule = new Map<
      'max-lines' | 'max-lines-per-function' | 'complexity' | 'max-statements' | 'max-depth',
      Finding[]
    >();

    const output = buildJSONOutput(findings, byRule);

    expect(output.thresholds.thresholdPercent).toBe(80);
    expect(output.thresholds.rules['max-lines']).toEqual({ threshold: 320, limit: 400 });
    expect(output.thresholds.rules['max-lines-per-function']).toEqual({
      threshold: 80,
      limit: 100,
    });
    expect(output.thresholds.rules.complexity).toEqual({ threshold: 16, limit: 20 });
    expect(output.thresholds.rules['max-statements']).toEqual({ threshold: 40, limit: 50 });
    expect(output.thresholds.rules['max-depth']).toEqual({ threshold: 3, limit: 4 });
  });

  it('counts atOrOverLimit and approaching correctly', () => {
    const findings: Finding[] = [
      makeFinding({ rule: 'max-lines', percentOfLimit: 110 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 100 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 90 }),
      makeFinding({ rule: 'max-lines', percentOfLimit: 75 }),
    ];

    const byRule = categorizeFindings(findings);
    const output = buildJSONOutput(findings, byRule);

    // 110% and 100% are at/over limit
    expect(output.summary.byRule['max-lines'].atOrOverLimit).toBe(2);
    // 90% is approaching (>= 80 and < 100)
    expect(output.summary.byRule['max-lines'].approaching).toBe(1);
    // 75% is neither
    expect(output.summary.byRule['max-lines'].count).toBe(4);
  });

  it('sets hasFailures true when percentOfLimit >= 100', () => {
    const findings: Finding[] = [makeFinding({ percentOfLimit: 100 })];

    const byRule = categorizeFindings(findings);
    const output = buildJSONOutput(findings, byRule);

    expect(output.summary.hasFailures).toBe(true);
  });

  it('sets hasFailures false when all under 100%', () => {
    const findings: Finding[] = [
      makeFinding({ percentOfLimit: 90 }),
      makeFinding({ percentOfLimit: 80 }),
    ];

    const byRule = categorizeFindings(findings);
    const output = buildJSONOutput(findings, byRule);

    expect(output.summary.hasFailures).toBe(false);
  });

  it('reports totalFindings correctly', () => {
    const findings: Finding[] = [
      makeFinding({ rule: 'max-lines', percentOfLimit: 85 }),
      makeFinding({ rule: 'complexity', percentOfLimit: 95 }),
      makeFinding({ rule: 'max-depth', percentOfLimit: 80 }),
    ];

    const byRule = categorizeFindings(findings);
    const output = buildJSONOutput(findings, byRule);

    expect(output.summary.totalFindings).toBe(3);
  });

  it('includes all findings in the output', () => {
    const findings: Finding[] = [
      makeFinding({ rule: 'max-lines', currentValue: 450 }),
      makeFinding({ rule: 'complexity', currentValue: 18 }),
    ];

    const byRule = categorizeFindings(findings);
    const output = buildJSONOutput(findings, byRule);

    expect(output.findings).toEqual(findings);
  });

  it('handles empty findings', () => {
    const output = buildJSONOutput([], new Map());

    expect(output.summary.totalFindings).toBe(0);
    expect(output.summary.hasFailures).toBe(false);
    expect(output.summary.byRule).toEqual({});
    expect(output.findings).toEqual([]);
  });
});
