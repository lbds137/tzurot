/**
 * Tests for the legacy gateway-callsite counter.
 *
 * Uses a synthetic fixture directory at test time so we can assert exact
 * counts without depending on the actual bot-client source (which moves
 * as PRs land). The real CLI command operates against
 * `services/bot-client/src` directly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareWithBaseline,
  countLegacyCallsites,
  readBaseline,
  writeBaseline,
  type LegacyCallsiteBaseline,
} from './legacy-count.js';

let workspace: string;
let srcDir: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'legacy-count-test-'));
  srcDir = join(workspace, 'services/bot-client/src');
  mkdirSync(srcDir, { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function write(relPath: string, body: string): void {
  const full = join(srcDir, relPath);
  const dir = join(full, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, body, 'utf-8');
}

describe('countLegacyCallsites', () => {
  it('returns zero counts on an empty tree', () => {
    expect(countLegacyCallsites(workspace)).toEqual({
      adminFetch: 0,
      callGatewayApi: 0,
    });
  });

  it('counts adminFetch and callGatewayApi independently', () => {
    write(
      'commands/foo.ts',
      `
      import { adminFetch } from './x.js';
      import { callGatewayApi } from './y.js';
      await adminFetch('/a');
      await adminFetch('/b');
      await callGatewayApi('/c');
      `
    );
    // Each named token counts once per occurrence (imports + call sites both count;
    // this matches the "burn-down" intent — every reference must vanish).
    expect(countLegacyCallsites(workspace)).toEqual({
      adminFetch: 3,
      callGatewayApi: 2,
    });
  });

  it('excludes test files from the count', () => {
    write('utils/x.ts', 'adminFetch();');
    write('utils/x.test.ts', 'adminFetch(); adminFetch();');
    write('utils/x.spec.ts', 'callGatewayApi();');
    expect(countLegacyCallsites(workspace)).toEqual({
      adminFetch: 1,
      callGatewayApi: 0,
    });
  });

  it('walks nested directories', () => {
    write('a/b/c/deep.ts', 'await adminFetch();');
    expect(countLegacyCallsites(workspace).adminFetch).toBe(1);
  });

  it('does not match partial identifiers (word boundary)', () => {
    // `myAdminFetch` and `adminFetchHelper` should NOT match `adminFetch`.
    write('utils/lookalike.ts', 'const myAdminFetch = 1; const adminFetchHelper = 2;');
    expect(countLegacyCallsites(workspace).adminFetch).toBe(0);
  });

  it('ignores non-TypeScript files', () => {
    write('config/notes.md', 'adminFetch and callGatewayApi mentioned here');
    write('config/data.json', '{"adminFetch": 1}');
    expect(countLegacyCallsites(workspace)).toEqual({
      adminFetch: 0,
      callGatewayApi: 0,
    });
  });

  it('throws on a missing source directory (does not silently zero-count)', () => {
    // workspace exists but services/bot-client/src does not (beforeEach mkdirs
    // it; remove it for this test). The gate must surface this as an error
    // rather than reporting 0/0 — otherwise a partial checkout would let
    // every check pass against the baseline.
    rmSync(join(srcDir), { recursive: true, force: true });
    expect(() => countLegacyCallsites(workspace)).toThrow(/Expected source directory not found/);
  });
});

describe('compareWithBaseline', () => {
  const baseline: LegacyCallsiteBaseline = {
    version: 1,
    lastUpdated: '2026-05-26T00:00:00Z',
    adminFetch: 10,
    callGatewayApi: 50,
    notes: 'test baseline',
  };

  it('reports no regression when counts are level', () => {
    const result = compareWithBaseline({ adminFetch: 10, callGatewayApi: 50 }, baseline);
    expect(result.regression).toBe(false);
    expect(result.delta).toEqual({ adminFetch: 0, callGatewayApi: 0 });
  });

  it('reports no regression when counts decrease (burn-down)', () => {
    const result = compareWithBaseline({ adminFetch: 5, callGatewayApi: 40 }, baseline);
    expect(result.regression).toBe(false);
    expect(result.delta).toEqual({ adminFetch: -5, callGatewayApi: -10 });
  });

  it('reports regression when adminFetch increases', () => {
    const result = compareWithBaseline({ adminFetch: 11, callGatewayApi: 50 }, baseline);
    expect(result.regression).toBe(true);
    expect(result.delta.adminFetch).toBe(1);
  });

  it('reports regression when callGatewayApi increases', () => {
    const result = compareWithBaseline({ adminFetch: 10, callGatewayApi: 51 }, baseline);
    expect(result.regression).toBe(true);
    expect(result.delta.callGatewayApi).toBe(1);
  });

  it('reports regression when one decreases but other increases', () => {
    // Net-positive movement on one axis is still a regression — burn-down is
    // strictly monotonic per category, not by sum.
    const result = compareWithBaseline({ adminFetch: 0, callGatewayApi: 100 }, baseline);
    expect(result.regression).toBe(true);
  });
});

describe('writeBaseline + readBaseline round-trip', () => {
  it('persists and re-reads counts faithfully', () => {
    const path = join(workspace, 'legacy-baseline.json');
    const counts = { adminFetch: 42, callGatewayApi: 100 };
    writeBaseline(path, counts, 'round-trip test');
    const loaded = readBaseline(path);
    expect(loaded.adminFetch).toBe(42);
    expect(loaded.callGatewayApi).toBe(100);
    expect(loaded.version).toBe(1);
    expect(loaded.notes).toBe('round-trip test');
    expect(loaded.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('readBaseline malformed-input guard', () => {
  // Without numeric-type validation, the compareWithBaseline arithmetic
  // produces NaN, and `NaN > 0` is `false` — the gate would silently
  // pass on a real regression. These tests pin the loud-failure behavior.

  function writeMalformed(name: string, body: unknown): string {
    const path = join(workspace, name);
    writeFileSync(path, JSON.stringify(body), 'utf-8');
    return path;
  }

  it('throws when adminFetch is a string (hand-edit footgun)', () => {
    const path = writeMalformed('string-count.json', {
      version: 1,
      lastUpdated: '2026-01-01T00:00:00Z',
      adminFetch: '32',
      callGatewayApi: 207,
      notes: 'malformed',
    });
    expect(() => readBaseline(path)).toThrow(/Malformed baseline/);
  });

  it('throws when callGatewayApi is missing', () => {
    const path = writeMalformed('missing-count.json', {
      version: 1,
      lastUpdated: '2026-01-01T00:00:00Z',
      adminFetch: 32,
      notes: 'malformed',
    });
    expect(() => readBaseline(path)).toThrow(/Malformed baseline/);
  });

  it('throws when version does not match expected schema (loud-fail on format bump)', () => {
    const path = writeMalformed('wrong-version.json', {
      version: 2,
      lastUpdated: '2026-01-01T00:00:00Z',
      adminFetch: 32,
      callGatewayApi: 207,
      notes: 'future schema',
    });
    expect(() => readBaseline(path)).toThrow(/expected version 1/);
  });

  it('throws when adminFetch is NaN (partial write surrogate)', () => {
    // NaN survives JSON.parse as `null`, not as NaN — but we still test
    // the explicit Number.isFinite arm via Infinity, which JSON.parse
    // does NOT preserve (it stringifies to null too). So craft a body
    // that uses a non-number type that the parser will accept as the
    // wrong shape: explicit null masquerading as the count.
    const path = writeMalformed('null-count.json', {
      version: 1,
      lastUpdated: '2026-01-01T00:00:00Z',
      adminFetch: null,
      callGatewayApi: 207,
      notes: 'null counts',
    });
    expect(() => readBaseline(path)).toThrow(/Malformed baseline/);
  });
});
