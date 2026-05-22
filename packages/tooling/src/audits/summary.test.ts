/**
 * Tests for the shared audit-summary helper.
 */

import { describe, it, expect, vi } from 'vitest';
import { emitSummary, parseSummary, type AuditSummary } from './summary.js';

describe('emitSummary', () => {
  it('writes one JSON object per call to stdout', () => {
    const captured: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    try {
      emitSummary({
        tool: 'lint:complexity-report',
        status: 'ok',
        findings: 0,
        baseline: 0,
      });
    } finally {
      consoleSpy.mockRestore();
    }
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]) as AuditSummary;
    expect(parsed.tool).toBe('lint:complexity-report');
    expect(parsed.status).toBe('ok');
  });

  it('round-trips through parseSummary', () => {
    const captured: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    try {
      emitSummary({
        tool: 'db:check-safety',
        status: 'fail',
        findings: 3,
        baseline: 0,
        meta: { toolVersion: '1.0.0', generatedAt: '2026-05-22T17:00:00Z' },
      });
    } finally {
      consoleSpy.mockRestore();
    }
    const parsed = parseSummary(captured[0]);
    expect(parsed.tool).toBe('db:check-safety');
    expect(parsed.findings).toBe(3);
    expect(parsed.meta?.toolVersion).toBe('1.0.0');
  });
});

describe('parseSummary', () => {
  it('parses a valid summary line', () => {
    const line = JSON.stringify({
      tool: 't',
      status: 'ok',
      findings: 0,
      baseline: 0,
    });
    const result = parseSummary(line);
    expect(result.tool).toBe('t');
  });

  it('rejects non-object input', () => {
    expect(() => parseSummary('"a string"')).toThrow(/expected object, got string/);
    expect(() => parseSummary('42')).toThrow(/expected object, got number/);
    expect(() => parseSummary('null')).toThrow(/expected object, got null/);
  });

  it('rejects array input (typeof [] === object, so explicit check needed)', () => {
    // Without the Array.isArray() guard, an array input would slip past
    // the object check and produce a misleading downstream error about
    // a missing `tool` field.
    expect(() => parseSummary('[]')).toThrow(/expected object, got array/);
    expect(() => parseSummary('[{"tool": "x"}]')).toThrow(/expected object, got array/);
  });

  it('rejects missing tool', () => {
    const line = JSON.stringify({ status: 'ok', findings: 0, baseline: 0 });
    expect(() => parseSummary(line)).toThrow(/`tool` must be a string/);
  });

  it('rejects invalid status', () => {
    const line = JSON.stringify({ tool: 't', status: 'maybe', findings: 0, baseline: 0 });
    expect(() => parseSummary(line)).toThrow(/`status` must be ok\|warn\|fail/);
  });

  it('rejects non-numeric findings', () => {
    const line = JSON.stringify({ tool: 't', status: 'ok', findings: '0', baseline: 0 });
    expect(() => parseSummary(line)).toThrow(/`findings` must be a number/);
  });

  it('rejects non-numeric baseline', () => {
    const line = JSON.stringify({ tool: 't', status: 'ok', findings: 0, baseline: '0' });
    expect(() => parseSummary(line)).toThrow(/`baseline` must be a number/);
  });

  it('rejects negative findings', () => {
    // Both fields are observability counts — `-1` is nonsense from any
    // producer. Fails loud rather than silently propagating to the aggregator.
    const line = JSON.stringify({ tool: 't', status: 'ok', findings: -1, baseline: 0 });
    expect(() => parseSummary(line)).toThrow(/`findings` must be >= 0/);
  });

  it('rejects negative baseline', () => {
    const line = JSON.stringify({ tool: 't', status: 'ok', findings: 0, baseline: -5 });
    expect(() => parseSummary(line)).toThrow(/`baseline` must be >= 0/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseSummary('{not valid json')).toThrow();
  });
});
