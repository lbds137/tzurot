/**
 * Tests for the baseline metadata helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The only shell-out in this module is the git merge-base read inside
// buildBaselineMeta. The mock branches on exact argv equality: only the
// expected command is served the fixture SHA; any unexpected argv throws
// (a real git failure), and production's catch degrades the read to
// 'unknown' — so a mutated call site cannot silently satisfy the wiring
// tests below.
const { argvExactExecFileSync } = vi.hoisted(() => ({
  argvExactExecFileSync: (_command: unknown, args?: readonly unknown[]) => {
    const argv = (args ?? []) as string[];
    const served = argv[0] === 'merge-base' && argv[1] === 'HEAD' && argv[2] === 'origin/develop';
    if (!served) {
      throw new Error(`unexpected execFileSync argv: ${argv.join(' ')}`);
    }
    return `${'a1b2c3d4'.repeat(5)}\n`;
  },
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(argvExactExecFileSync),
}));

import { execFileSync } from 'node:child_process';
import {
  buildBaselineMeta,
  checkMetaDrift,
  hashConfigSlice,
  BASELINE_SHA_TIMEOUT_MS,
  type BaselineMeta,
} from './baseline-meta.js';

const BASE_SHA = 'a1b2c3d4'.repeat(5);

describe('buildBaselineMeta', () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(argvExactExecFileSync);
  });

  it('returns a populated meta block', () => {
    const meta = buildBaselineMeta('1.0.0', 'abc123def456');
    expect(meta.toolVersion).toBe('1.0.0');
    expect(meta.configHash).toBe('abc123def456');
    expect(meta.nodeVersion).toBe(process.version);
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.generatedFromSha).toBe(BASE_SHA);
  });

  it('generatedAt is ISO-8601 and represents now', () => {
    const before = Date.now();
    const meta = buildBaselineMeta('1.0.0', 'hash');
    const after = Date.now();
    const captured = new Date(meta.generatedAt).getTime();
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(after);
  });

  it('records the merge-base when it returns a base', () => {
    const meta = buildBaselineMeta('1.0.0', 'hash');
    expect(meta.generatedFromSha).toBe(BASE_SHA);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      ['merge-base', 'HEAD', 'origin/develop'],
      expect.objectContaining({ timeout: BASELINE_SHA_TIMEOUT_MS })
    );
  });

  it("records 'unknown' when the git read rejects (git absence)", () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => {
      throw new Error('git merge-base failed');
    });

    const meta = buildBaselineMeta('1.0.0', 'hash');

    expect(meta.generatedFromSha).toBe('unknown');
  });

  it("records 'unknown' when the merge-base read returns an empty string", () => {
    vi.mocked(execFileSync).mockImplementationOnce(() => '');

    const meta = buildBaselineMeta('1.0.0', 'hash');

    expect(meta.generatedFromSha).toBe('unknown');
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
  it('produces a stable 12-char hex hash for the same input', () => {
    const input = { threshold: 0.8, version: 1 };
    const hash1 = hashConfigSlice(input);
    const hash2 = hashConfigSlice(input);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{12}$/);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashConfigSlice({ threshold: 0.8 });
    const hash2 = hashConfigSlice({ threshold: 0.7 });
    expect(hash1).not.toBe(hash2);
  });

  it('is sensitive to key order (JSON.stringify is order-dependent)', () => {
    // Documenting the contract: hashConfigSlice does NOT canonicalize
    // key order. Callers should construct config slices with stable
    // key order (object literals in source files have stable order
    // in modern JS engines, so this is usually fine).
    const a = hashConfigSlice({ a: 1, b: 2 });
    const b = hashConfigSlice({ b: 2, a: 1 });
    expect(a).not.toBe(b);
  });

  it('handles primitive inputs', () => {
    expect(hashConfigSlice('hello')).toMatch(/^[a-f0-9]{12}$/);
    expect(hashConfigSlice(42)).toMatch(/^[a-f0-9]{12}$/);
    expect(hashConfigSlice(null)).toMatch(/^[a-f0-9]{12}$/);
  });
});
