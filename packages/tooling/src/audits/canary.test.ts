/**
 * Audit Canary Tests
 *
 * Per Layer 1 of `docs/reference/audit-enforcement.md`:
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
import { checkAuditToolDocsFromRegistry } from './check-audit-tool-docs.js';
import { findContentRefs } from './check-claude-content-refs.js';
import { loadManifest, summarize } from '../dev/commandsAudit.js';
import { runChecks } from '../dev/commandsAuditChecks.js';
import type { AuditToolEntry } from './audit-tool-registry.js';
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
        // The `--rule` CLI overrides inside runEslint force the complexity
        // rule to apply to every file in `targetDirs` regardless of the
        // resolved config — that's what scans the fixture despite it being
        // under `**/test-fixtures/**` in the root config's ignores. The
        // local `configPath` exists to supply parserOptions compatible with
        // .js files (the root config uses typed-rules which can't parse
        // files outside any tsconfig project).
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

describe('audit-canary: guard:audit-tool-docs', () => {
  it('detects a registered tool with a missing WHY.md (canary registry)', () => {
    // Canary: a synthetic registry pointing at the audit-tool-docs fixture
    // directory, where one entry's WHY.md exists (the "valid" tool) and
    // another's is deliberately missing. The guard must flag the missing
    // one — otherwise it would silently pass on a stale registry in
    // production too.
    const canaryRegistry: AuditToolEntry[] = [
      {
        command: 'canary-tool-valid',
        whyPath: 'packages/tooling/test-fixtures/audit-canaries/audit-tool-docs/valid-tool.WHY.md',
        description: 'Canary fixture: substantial WHY.md should pass',
      },
      {
        command: 'canary-tool-missing',
        whyPath:
          'packages/tooling/test-fixtures/audit-canaries/audit-tool-docs/this-file-does-not-exist.WHY.md',
        description: 'Canary fixture: missing WHY.md must be detected',
      },
    ];

    const result = checkAuditToolDocsFromRegistry(REPO_ROOT, canaryRegistry);
    expect(result.totalTools).toBe(2);
    expect(
      result.missing,
      `expected exactly one missing entry, got: ${JSON.stringify(result.missing)}`
    ).toHaveLength(1);
    expect(result.missing[0].command).toBe('canary-tool-missing');
    expect(result.stubs).toEqual([]);
  });

  it('detects a registered tool with a stub WHY.md (canary registry)', () => {
    const canaryRegistry: AuditToolEntry[] = [
      {
        command: 'canary-tool-stub',
        whyPath: 'packages/tooling/test-fixtures/audit-canaries/audit-tool-docs/stub-tool.WHY.md',
        description: 'Canary fixture: stub WHY.md must be detected',
      },
    ];

    const result = checkAuditToolDocsFromRegistry(REPO_ROOT, canaryRegistry);
    expect(
      result.stubs,
      `expected one stub entry, got: ${JSON.stringify(result.stubs)}`
    ).toHaveLength(1);
    expect(result.stubs[0].command).toBe('canary-tool-stub');
    expect(result.missing).toEqual([]);
  });
});

describe('audit-canary: guard:claude-content-refs', () => {
  it('detects a deliberately-dangling pnpm ops command reference', () => {
    // The fixture references `pnpm ops nonexistent:canary-target` which
    // is intentionally not in the validCommands set. If the audit tool
    // ever stops detecting this, the canary fails and the silent-
    // misconfiguration failure mode is caught.
    const validCommands = new Set(['db:status']); // explicitly excludes the canary target
    const result = findContentRefs(
      REPO_ROOT,
      validCommands,
      // Scope the scan to the canary fixture so production rule/skill
      // content doesn't contaminate the test.
      [`${FIXTURES_ROOT.replace(`${REPO_ROOT}/`, '')}/claude-content-refs/rules`]
    );
    expect(result.totalFiles).toBe(1);
    expect(
      result.danglingRefs,
      `expected exactly one dangling ref, got: ${JSON.stringify(result.danglingRefs)}`
    ).toHaveLength(1);
    expect(result.danglingRefs[0].command).toBe('nonexistent:canary-target');
  });
});

describe('audit-canary: commands:audit', () => {
  it('detects the deliberately-broken command manifest (bad category + empty desc + missing handler)', () => {
    // The fixture has a command with a category ('Bogus') not in
    // helpCategories, an empty subcommand description, and componentPrefixes
    // without a button/select handler. The tool must report status:fail.
    const manifest = loadManifest({
      manifestPath: `${FIXTURES_ROOT}/commands-audit/command-manifest.json`,
    });
    const findings = runChecks(manifest);
    const { status, findings: count } = summarize(findings);

    expect(status).toBe('fail');
    expect(count).toBeGreaterThan(0);
    // The signature error checks must all fire.
    expect(findings.some(f => f.rule === 'category-coverage')).toBe(true);
    expect(findings.some(f => f.rule === 'description-presence' && f.severity === 'error')).toBe(
      true
    );
    expect(findings.some(f => f.rule === 'component-handler-completeness')).toBe(true);
  });
});

describe('audit-canary: lines:check', () => {
  it('detects the deliberately over-budget always-loaded surfaces', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runLinesCheck, getLinesConfigFingerprint } = await import('./lines-check.js');
    const { buildBaselineMeta, hashConfigSlice } = await import('./baseline-meta.js');

    // The fixture is a static fake repo root with over-budget surfaces
    // (rules 40 lines, CURRENT.md 20 lines) — the DO-NOT-FIX artifact. The
    // baseline is built at test time so its configHash tracks the CURRENT
    // fingerprint — a hardcoded hash would turn every legitimate fingerprint
    // change into a canary failure about drift instead of budget detection.
    const tmp = await mkdtemp(join(tmpdir(), 'lines-canary-'));
    const baselinePath = join(tmp, 'baseline.json');
    await writeFile(
      baselinePath,
      JSON.stringify({
        surfaces: {
          rules: { lines: 10, graceMargin: 5 },
          current: { lines: 5, graceMargin: 2 },
        },
        meta: buildBaselineMeta('lines-check/canary', hashConfigSlice(getLinesConfigFingerprint())),
      })
    );

    const captured: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const status = runLinesCheck({
        rootDir: `${FIXTURES_ROOT}/lines-check`,
        baseline: baselinePath,
        summary: true,
        noFail: true,
      });

      expect(status).toBe('fail');
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.tool).toBe('lines:check');
      expect(summary.status).toBe('fail');
      expect(summary.findings).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('audit-canary: mutation:check', () => {
  it('detects the deliberately below-floor mutation report', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runMutationCheck, getMutationConfigFingerprint } =
      await import('../test/mutation-check.js');
    const { buildBaselineMeta, hashConfigSlice } = await import('./baseline-meta.js');

    // The fixture report is the static DO-NOT-FIX artifact (score 50%). The
    // baseline is built at test time so its configHash tracks the CURRENT
    // fingerprint — a hardcoded hash would turn every legitimate fingerprint
    // change into a canary failure about drift instead of score detection.
    const tmp = await mkdtemp(join(tmpdir(), 'mutation-canary-'));
    const baselinePath = join(tmp, 'baseline.json');
    await writeFile(
      baselinePath,
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-01-01T00:00:00.000Z',
        packages: { 'config-resolver': { score: 95, graceMargin: 1 } },
        meta: buildBaselineMeta(
          'mutation-check/canary',
          hashConfigSlice(getMutationConfigFingerprint())
        ),
      })
    );

    const captured: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => String(a)).join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const status = runMutationCheck({
        rootDir: `${FIXTURES_ROOT}/mutation-check`,
        baseline: baselinePath,
        summary: true,
        noFail: true,
      });

      expect(status).toBe('fail');
      const summary = parseSummary(captured[captured.length - 1]);
      expect(summary.tool).toBe('mutation:check');
      expect(summary.status).toBe('fail');
      expect(summary.findings).toBeGreaterThan(0);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
