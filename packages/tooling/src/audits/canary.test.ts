/**
 * Audit Canary Tests
 *
 * Per Layer 1 of `docs/proposals/backlog/periodic-audit-enforcement.md`:
 * every audit tool has a deliberate-violation fixture that the tool MUST
 * detect. These tests run on every PR (regular CI, NOT cron) and validate
 * the tools work before any enforcement layer is built on top of them.
 *
 * If a canary test fails:
 * - The tool is broken (silently misconfigured, threshold drift, wrong path)
 * - OR the canary fixture was modified
 *
 * In both cases, do NOT "fix" by lowering the canary's severity or removing
 * the fixture. Investigate the tool. The canaries are the floor.
 */

import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { analyzeMigrationSafety } from '../db/check-migration-safety.js';
import { runComplexityReport } from '../lint/complexity-report.js';
import { parseSummary } from './summary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = resolve(__dirname, '../../test-fixtures/audit-canaries');
const REPO_ROOT = resolve(__dirname, '../../../..');

describe('audit-canary: db:check-safety', () => {
  it('detects the DROP-without-recreate protected-index violation', () => {
    const result = analyzeMigrationSafety(`${FIXTURES_ROOT}/db-check-safety`);

    expect(result.totalFiles).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(
      result.violations[0].violations.some(v => v.includes('idx_memories_embedding')),
      `expected a violation mentioning idx_memories_embedding, got: ${result.violations[0].violations.join('; ')}`
    ).toBe(true);
  });
});

describe('audit-canary: lint:complexity-report', () => {
  it('flags the deliberately-complex canary file', async () => {
    // `noFail: true` ensures the tool returns normally on failure instead
    // of calling process.exit — so we only need to stub stdout to capture
    // the summary line.
    const captured: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });

    try {
      await runComplexityReport({
        summary: true,
        targetDirs: [`${FIXTURES_ROOT}/lint-complexity`],
        rootDir: REPO_ROOT,
        respectIgnores: false,
        configPath: `${FIXTURES_ROOT}/lint-complexity/eslint.config.mjs`,
        noFail: true,
      });
    } finally {
      consoleSpy.mockRestore();
    }

    expect(captured.length, `expected at least one stdout line, got 0`).toBeGreaterThan(0);
    const summary = parseSummary(captured[captured.length - 1]);
    expect(summary.tool).toBe('lint:complexity-report');
    // Canary has cyclomatic complexity = 25, well over the ESLint limit of 20.
    // Status must be `fail` (over hard limit), not just `warn`.
    expect(summary.status).toBe('fail');
    expect(summary.findings).toBeGreaterThan(0);
  }, 30000); // ESLint startup overhead
});
