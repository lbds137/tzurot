import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CI_ONLY,
  LOCAL_ONLY,
  extractCiLintTokens,
  extractQualityTokens,
  findGateParityViolations,
  normalizeCommand,
} from './check-gate-parity.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('normalizeCommand', () => {
  it('strips pnpm/npx, run, and ops prefixes down to the gate token', () => {
    expect(normalizeCommand('pnpm lint')).toBe('lint');
    expect(normalizeCommand('pnpm run lint')).toBe('lint');
    expect(normalizeCommand('pnpm ops cpd:check')).toBe('cpd:check');
    expect(normalizeCommand('npx prisma generate')).toBe('prisma');
    expect(normalizeCommand('  pnpm ops guard:workflow-sync  ')).toBe('guard:workflow-sync');
  });

  it('drops flags — both --category variants normalize to one token', () => {
    expect(normalizeCommand('pnpm ops test:audit --category=contracts')).toBe('test:audit');
    expect(normalizeCommand('pnpm ops test:audit --category=services')).toBe('test:audit');
    expect(normalizeCommand('pnpm ops commands:audit --summary')).toBe('commands:audit');
  });

  it('returns null for non-command lines', () => {
    expect(normalizeCommand('echo "run pnpm ops codegen:routes then commit"')).toBeNull();
    expect(normalizeCommand('- name: Run linter')).toBeNull();
    expect(normalizeCommand('')).toBeNull();
  });
});

describe('extractCiLintTokens', () => {
  const yaml = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: Install dependencies',
    '        run: pnpm install --frozen-lockfile',
    '      - name: Run linter',
    '        run: pnpm run lint',
    '      - name: Multi-line with message noise',
    '        run: |',
    '          OUTPUT=$(NO_COLOR=1 pnpm ops xray --suppressions 2>&1)',
    '          echo "Fix via \\`pnpm ops codegen:routes\\` then commit."',
    '          pnpm ops cpd:check',
    '  test:',
    '    steps:',
    '      - name: Run tests',
    '        run: pnpm test:coverage',
  ].join('\n');

  it('extracts only the lint job, only line-initial commands, skipping setup tokens', () => {
    const tokens = extractCiLintTokens(yaml);
    expect(tokens).toEqual(new Set(['lint', 'xray', 'cpd:check']));
  });

  it('does not leak commands from other jobs', () => {
    expect(extractCiLintTokens(yaml).has('test:coverage')).toBe(false);
  });
});

describe('extractQualityTokens', () => {
  it('splits the && chain and normalizes each segment', () => {
    const pkg = JSON.stringify({
      scripts: { quality: 'pnpm lint && pnpm ops cpd:check && pnpm backlog:lint' },
    });
    expect(extractQualityTokens(pkg)).toEqual(new Set(['lint', 'cpd:check', 'backlog:lint']));
  });

  it('returns empty set when no quality script exists', () => {
    expect(extractQualityTokens('{"scripts":{}}')).toEqual(new Set());
  });
});

describe('findGateParityViolations', () => {
  it('flags asymmetric tokens not covered by allowlists', () => {
    const violations = findGateParityViolations(
      new Set(['lint', 'only-in-ci']),
      new Set(['lint', 'only-local'])
    );
    expect(violations.ciOnly).toEqual(['only-in-ci']);
    expect(violations.localOnly).toEqual(['only-local']);
  });

  it('honors the allowlists and flags stale allowlist entries', () => {
    const ciTokens = new Set(['lint', ...Object.keys(CI_ONLY)]);
    const qualityTokens = new Set(['lint', ...Object.keys(LOCAL_ONLY)]);
    const violations = findGateParityViolations(ciTokens, qualityTokens);
    expect(violations.ciOnly).toEqual([]);
    expect(violations.localOnly).toEqual([]);
    expect(violations.staleAllowlist).toEqual([]);

    const stale = findGateParityViolations(new Set(['lint']), new Set(['lint']));
    expect(stale.staleAllowlist).toEqual(
      [...Object.keys(CI_ONLY), ...Object.keys(LOCAL_ONLY)].sort()
    );
  });

  it('flags an allowlist entry as stale when its token reaches BOTH sides (parity achieved)', () => {
    const [ciOnlyToken] = Object.keys(CI_ONLY);
    // Token present on both sides → the asymmetry the entry describes is gone.
    const violations = findGateParityViolations(
      new Set(['lint', ciOnlyToken, ...Object.keys(CI_ONLY)]),
      new Set(['lint', ciOnlyToken, ...Object.keys(LOCAL_ONLY)])
    );
    expect(violations.staleAllowlist).toContain(ciOnlyToken);
    expect(violations.ciOnly).toEqual([]);
  });
});

describe('gate parity (against real repo)', () => {
  it('reports zero violations on the actual project state', () => {
    const ciYaml = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const packageJson = readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8');
    const violations = findGateParityViolations(
      extractCiLintTokens(ciYaml),
      extractQualityTokens(packageJson)
    );
    expect(
      violations,
      'Local quality chain and CI lint job drifted. Sync them or add a justified allowlist entry in check-gate-parity.ts.'
    ).toEqual({ ciOnly: [], localOnly: [], staleAllowlist: [] });
  });
});
