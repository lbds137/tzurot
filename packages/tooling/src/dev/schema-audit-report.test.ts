/**
 * Tests for markdown report rendering.
 *
 * The report is render-only (writes to stdout). Tests verify it doesn't
 * crash and emits expected section markers; snapshot-style comparison
 * would over-fit, so we sample a few stable substrings instead.
 */

import { describe, it, expect, vi } from 'vitest';
import { printMarkdownReport } from './schema-audit-report.js';
import type { AuditFinding } from './schema-audit-findings.js';

describe('printMarkdownReport', () => {
  function captureStdout(fn: () => void): string {
    const lines: string[] = [];
    const original = console.log;
    console.log = vi.fn((...args: unknown[]) => {
      lines.push(args.map(a => String(a)).join(' '));
    });
    try {
      fn();
    } finally {
      console.log = original;
    }
    return lines.join('\n');
  }

  it('emits the expected header + stats when there are no findings', () => {
    const output = captureStdout(() => {
      printMarkdownReport({
        fields: [],
        optionalFields: [],
        readClassifications: [],
        writeClassifications: [],
        findings: [],
        sourceFileCount: 0,
        suppressedCount: 0,
      });
    });
    expect(output).toContain('# Schema Audit Report');
    expect(output).toContain('**Findings**: 0');
    expect(output).toContain('No findings under the implemented recipes.');
  });

  it('groups findings by severity and emits each block with fix-shape', () => {
    const findings: AuditFinding[] = [
      {
        severity: 'HIGH',
        recipe: 'bimodal-writes',
        model: 'User',
        field: 'someField',
        evidence: 'split into 3 omit + 2 value',
        fixShape: 'audit and tighten',
      },
      {
        severity: 'MEDIUM',
        recipe: 'always-passed-no-default',
        model: 'LlmConfig',
        field: 'description',
        evidence: 'all sites pass a value',
        fixShape: 'tighten to NOT NULL',
      },
    ];
    const output = captureStdout(() => {
      printMarkdownReport({
        fields: [],
        optionalFields: [],
        readClassifications: [],
        writeClassifications: [],
        findings,
        sourceFileCount: 100,
        suppressedCount: 0,
      });
    });
    expect(output).toContain('## HIGH');
    expect(output).toContain('## MEDIUM');
    expect(output).toContain('`User.someField`');
    expect(output).toContain('`LlmConfig.description`');
    expect(output).toContain('split into 3 omit + 2 value');
    expect(output).toContain('audit and tighten');
  });

  it('surfaces suppressed count in the header when non-zero', () => {
    const output = captureStdout(() => {
      printMarkdownReport({
        fields: [],
        optionalFields: [],
        readClassifications: [],
        writeClassifications: [],
        findings: [],
        sourceFileCount: 0,
        suppressedCount: 3,
      });
    });
    expect(output).toContain('**Suppressed**: 3');
  });
});
