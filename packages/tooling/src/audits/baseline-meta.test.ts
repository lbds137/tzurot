/**
 * Tests for the baseline metadata helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  type BaselineMeta,
} from './baseline-meta.js';

describe('buildBaselineMeta', () => {
  it('returns a populated meta block', () => {
    const meta = buildBaselineMeta('1.0.0', 'abc123def456');
    expect(meta.toolVersion).toBe('1.0.0');
    expect(meta.configHash).toBe('abc123def456');
    expect(meta.nodeVersion).toBe(process.version);
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // generatedFromSha is either a real SHA (40 hex chars) or 'unknown'
    // (when git is unavailable / tree isn't a repo).
    expect(meta.generatedFromSha).toMatch(/^([a-f0-9]{40}|unknown)$/);
  });

  it('generatedAt is ISO-8601 and represents now', () => {
    const before = Date.now();
    const meta = buildBaselineMeta('1.0.0', 'hash');
    const after = Date.now();
    const captured = new Date(meta.generatedAt).getTime();
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(after);
  });
});

describe('checkMetaDrift', () => {
  const validMeta: BaselineMeta = {
    toolVersion: '1.0.0',
    configHash: 'abc123',
    nodeVersion: 'v25.3.0',
    generatedFromSha: 'deadbeef',
    generatedAt: '2026-05-22T00:00:00Z',
  };

  it('returns aligned when configHash matches', () => {
    const result = checkMetaDrift(validMeta, 'abc123');
    expect(result.aligned).toBe(true);
  });

  it('returns drift when configHash differs', () => {
    const result = checkMetaDrift(validMeta, 'xyz789');
    expect(result.aligned).toBe(false);
    expect(result.detail).toContain('configHash drift');
    expect(result.detail).toContain('abc123');
    expect(result.detail).toContain('xyz789');
  });

  it('treats missing stored meta as drift (migration path)', () => {
    // Pre-Layer-3 baselines without meta blocks fail the gate, forcing
    // the operator to capture metadata via `*:update-baseline`.
    const result = checkMetaDrift(undefined, 'abc123');
    expect(result.aligned).toBe(false);
    expect(result.detail).toContain('no meta block');
  });
});

describe('hashConfigSlice', () => {
  it('produces a stable 12-char hex hash for the same input', async () => {
    const input = { threshold: 0.8, version: 1 };
    const hash1 = await hashConfigSlice(input);
    const hash2 = await hashConfigSlice(input);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{12}$/);
  });

  it('produces different hashes for different inputs', async () => {
    const hash1 = await hashConfigSlice({ threshold: 0.8 });
    const hash2 = await hashConfigSlice({ threshold: 0.7 });
    expect(hash1).not.toBe(hash2);
  });

  it('is sensitive to key order (JSON.stringify is order-dependent)', async () => {
    // Documenting the contract: hashConfigSlice does NOT canonicalize
    // key order. Callers should construct config slices with stable
    // key order (object literals in source files have stable order
    // in modern JS engines, so this is usually fine).
    const a = await hashConfigSlice({ a: 1, b: 2 });
    const b = await hashConfigSlice({ b: 2, a: 1 });
    expect(a).not.toBe(b);
  });

  it('handles primitive inputs', async () => {
    expect(await hashConfigSlice('hello')).toMatch(/^[a-f0-9]{12}$/);
    expect(await hashConfigSlice(42)).toMatch(/^[a-f0-9]{12}$/);
    expect(await hashConfigSlice(null)).toMatch(/^[a-f0-9]{12}$/);
  });
});
