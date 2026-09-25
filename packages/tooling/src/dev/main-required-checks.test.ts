/**
 * Tests for the guard's second invariant: every status check `main`'s
 * ruleset requires must be a job `main` can actually produce — the exact
 * leg, matrix jobs included.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'node:child_process';
import {
  contextJobId,
  evaluateRequiredChecks,
  readMainWorkflowContexts,
  collectRequiredChecks,
  MAIN_CI_WORKFLOW_REF,
  GIT_SHOW_TIMEOUT_MS,
  GIT_FETCH_TIMEOUT_MS,
  type RulesetRequiredChecks,
} from './main-required-checks.js';
import { parseWorkflowContexts } from './workflow-job-contexts.js';

const LIVE_MAIN_CONTEXTS = [
  'lint',
  'build',
  'unit-tests (ai-worker)',
  'unit-tests (api-gateway)',
  'unit-tests (bot-client)',
  'unit-tests (packages)',
  'unit-tests (tooling)',
  'unit-tests (website)',
  'component-integration-tests',
  'docker-build-smoke-ok',
  'voice-engine-tests',
  'mutation-tests',
];
const LIVE_DEVELOP_CONTEXTS = [...LIVE_MAIN_CONTEXTS, 'fixup-check', 'hook-posix-parse'];

describe('contextJobId', () => {
  it('strips the matrix cell suffix', () => {
    expect(contextJobId('unit-tests (ai-worker)')).toBe('unit-tests');
  });

  it('returns a bare context unchanged', () => {
    expect(contextJobId('lint')).toBe('lint');
    expect(contextJobId('docker-build-smoke-ok')).toBe('docker-build-smoke-ok');
  });
});

describe('evaluateRequiredChecks', () => {
  it('G1 purpose canary: a main context with no matching job on main ci.yml fails, naming the context', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['lint', 'hook-posix-parse'],
      developContexts: [],
      mainWorkflow: new Map([['lint', ['lint']]]),
    });

    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0].severity).toBe('HIGH');
    expect(verdict.findings[0].message).toContain('`hook-posix-parse`');
    expect(verdict.findings[0].message).toContain('Remove');
    expect(verdict.findings[0].message).toContain('wait until the release');
    expect(verdict.findings[0].message).toContain('has no job');
  });

  it('matches a matrix context to its exact produced leg', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['unit-tests (ai-worker)'],
      developContexts: [],
      mainWorkflow: new Map([['unit-tests', ['unit-tests (ai-worker)']]]),
    });

    expect(verdict.findings).toEqual([]);
  });

  it('leg finding: a renamed leg the job no longer produces is its own HIGH, not a missing-job finding', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['unit-tests (renamed-leg)'],
      developContexts: [],
      mainWorkflow: new Map([['unit-tests', ['unit-tests (ai-worker)', 'unit-tests (tooling)']]]),
    });

    expect(verdict.findings).toHaveLength(1);
    const message = verdict.findings[0].message;
    expect(message).toContain('`unit-tests (renamed-leg)`');
    expect(message).toContain('produces only');
    expect(message).toContain('`unit-tests (ai-worker)`');
    expect(message).not.toContain('has no job');
  });

  it('a required leg of an exclude-bearing job is a leg finding listing only the bare id', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['j (a)'],
      developContexts: [],
      // Derived through the real expansion so this pins the exclude fallback end to end.
      mainWorkflow: parseWorkflowContexts(
        'jobs:\n  j:\n    strategy: { matrix: { os: [a, b], exclude: [{ os: b }] } }\n'
      ),
    });

    expect(verdict.findings).toHaveLength(1);
    const message = verdict.findings[0].message;
    expect(message).toContain('`j (a)`');
    expect(message).toContain('produces only: `j`');
    expect(message).not.toContain('has no job');
  });

  it('a bare context of a matrix job never reports — it always reads as a leg finding', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['unit-tests'],
      developContexts: [],
      mainWorkflow: new Map([['unit-tests', ['unit-tests (ai-worker)', 'unit-tests (tooling)']]]),
    });

    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0].message).toContain('produces only');
    expect(verdict.findings[0].message).not.toContain('has no job');
  });

  it('warns to re-add a develop-only context once its exact context reaches main', () => {
    const verdict = evaluateRequiredChecks({
      developContexts: ['lint', 'hook-posix-parse'],
      mainContexts: ['lint'],
      mainWorkflow: new Map([
        ['lint', ['lint']],
        ['hook-posix-parse', ['hook-posix-parse']],
      ]),
    });

    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('`hook-posix-parse`');
    expect(verdict.warnings[0]).toContain('re-add');
  });

  it('stays silent when the develop-only job has not reached main — the normal pre-release state', () => {
    const verdict = evaluateRequiredChecks({
      developContexts: ['lint', 'hook-posix-parse'],
      mainContexts: ['lint'],
      mainWorkflow: new Map([['lint', ['lint']]]),
    });

    expect(verdict.warnings).toEqual([]);
  });

  it('no false-positive warning: a develop-only LEG of an already-existing job stays silent', () => {
    const verdict = evaluateRequiredChecks({
      developContexts: ['unit-tests (new-leg)'],
      mainContexts: [],
      mainWorkflow: new Map([['unit-tests', ['unit-tests (ai-worker)']]]),
    });

    expect(verdict.warnings).toEqual([]);
  });

  it('an exact-match develop-only context still warns', () => {
    const verdict = evaluateRequiredChecks({
      developContexts: ['hook-posix-parse'],
      mainContexts: [],
      mainWorkflow: new Map([['hook-posix-parse', ['hook-posix-parse']]]),
    });

    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('`hook-posix-parse`');
  });

  it('fixup-check on develop only is silent even though its job exists — the exemption is about main, not job existence', () => {
    const verdict = evaluateRequiredChecks({
      developContexts: ['fixup-check'],
      mainContexts: [],
      mainWorkflow: new Map([['fixup-check', ['fixup-check']]]),
    });

    expect(verdict.warnings).toEqual([]);
    expect(verdict.findings).toEqual([]);
  });

  it('rule (B): fixup-check required on main is a HIGH finding, not a missing-job finding', () => {
    const verdict = evaluateRequiredChecks({
      mainContexts: ['fixup-check'],
      developContexts: [],
      mainWorkflow: new Map([['fixup-check', ['fixup-check']]]),
    });

    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0].severity).toBe('HIGH');
    expect(verdict.findings[0].message).toContain('must NOT require');
  });

  it('the live main/develop contexts pass against the checked-out ci.yml (pins the "renaming a job is a two-step change" README rule for all 12 shared jobs)', () => {
    const path = fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url));
    const mainWorkflow = parseWorkflowContexts(readFileSync(path, 'utf-8'));

    const mainOnly = evaluateRequiredChecks({
      mainContexts: LIVE_MAIN_CONTEXTS,
      developContexts: [],
      mainWorkflow,
    });
    expect(mainOnly.findings).toEqual([]);

    const withDevelop = evaluateRequiredChecks({
      mainContexts: LIVE_MAIN_CONTEXTS,
      developContexts: LIVE_DEVELOP_CONTEXTS,
      mainWorkflow,
    });
    expect(withDevelop.findings).toEqual([]);
    expect(withDevelop.warnings).toHaveLength(1);
    expect(withDevelop.warnings[0]).toContain('`hook-posix-parse`');
    expect(withDevelop.warnings.some(w => w.includes('fixup-check'))).toBe(false);
  });
});

describe('readMainWorkflowContexts', () => {
  it('throws before any git call when the budget is already exhausted', () => {
    const runGit = vi.fn(() => 'jobs:\n  lint: {}\n');
    // Throws ONCE, then answers normally: without the up-front check the first throw lands in
    // ensureRef's bare catch, the fetch fallback's clamp then sees a healthy budget, and the
    // read completes with runGit called — the coincidence this test pins.
    let consulted = 0;
    const budget = (): number => {
      if (consulted++ === 0) throw new Error('repo-settings budget exhausted');
      return GIT_SHOW_TIMEOUT_MS;
    };
    expect(() => readMainWorkflowContexts(budget, runGit)).toThrow('budget');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('with the ref present, calls rev-parse then show, the show timeout capped by budget', () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const runGit = vi.fn((args: string[], timeoutMs: number) => {
      calls.push({ args, timeoutMs });
      return args[0] === 'show' ? 'jobs:\n  lint: {}\n' : 'abc123\n';
    });

    const contexts = readMainWorkflowContexts(() => GIT_SHOW_TIMEOUT_MS, runGit);

    expect([...contexts.keys()]).toEqual(['lint']);
    expect(calls[0].args).toEqual(['rev-parse', '--verify', 'origin/main']);
    expect(calls[1].args).toEqual(['show', MAIN_CI_WORKFLOW_REF]);
    expect(calls[1].timeoutMs).toBe(Math.min(GIT_SHOW_TIMEOUT_MS, GIT_SHOW_TIMEOUT_MS));
  });

  it('clamps the show timeout to a smaller remaining budget', () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const runGit = vi.fn((args: string[], timeoutMs: number) => {
      calls.push({ args, timeoutMs });
      return args[0] === 'show' ? 'jobs:\n  lint: {}\n' : 'abc123\n';
    });

    readMainWorkflowContexts(() => 5_000, runGit);

    expect(calls[1].timeoutMs).toBe(5_000);
  });

  it('fetches when the ref is missing, before the show, with the fetch ceiling', () => {
    const calls: Array<{ args: string[]; timeoutMs: number }> = [];
    const runGit = vi.fn((args: string[], timeoutMs: number) => {
      calls.push({ args, timeoutMs });
      if (args[0] === 'rev-parse') throw new Error('unknown revision');
      return args[0] === 'show' ? 'jobs:\n  lint: {}\n' : '';
    });

    readMainWorkflowContexts(() => GIT_FETCH_TIMEOUT_MS, runGit);

    expect(calls.map(c => c.args)).toEqual([
      ['rev-parse', '--verify', 'origin/main'],
      ['fetch', 'origin', 'main', '--depth=1'],
      ['show', MAIN_CI_WORKFLOW_REF],
    ]);
    expect(calls[1].timeoutMs).toBe(Math.min(GIT_FETCH_TIMEOUT_MS, GIT_FETCH_TIMEOUT_MS));
  });

  it('uses execFileSync with array args and stdio when no runGit is injected', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const a = args as string[];
      if (a[0] === 'rev-parse') return 'abc123\n';
      if (a[0] === 'show') return 'jobs:\n  lint: {}\n';
      throw new Error(`unexpected git ${a.join(' ')}`);
    });

    const contexts = readMainWorkflowContexts(() => GIT_SHOW_TIMEOUT_MS);

    expect([...contexts.keys()]).toEqual(['lint']);
    const showCall = vi.mocked(execFileSync).mock.calls.find(c => (c[1] as string[])[0] === 'show');
    expect(showCall?.[0]).toBe('git');
    expect(showCall?.[1]).toEqual(['show', MAIN_CI_WORKFLOW_REF]);
    expect(showCall?.[2]).toMatchObject({
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_SHOW_TIMEOUT_MS,
    });
  });
});

describe('collectRequiredChecks', () => {
  it('degrades to unavailable when git cannot read origin/main, naming the git failure', () => {
    const runGit = vi.fn(() => {
      const error = new Error('Command failed') as Error & { stderr: string };
      error.stderr = "fatal: invalid object name 'origin/main'\n";
      throw error;
    });

    const surface = collectRequiredChecks([], () => GIT_SHOW_TIMEOUT_MS, runGit);

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('invalid object name');
  });

  it('degrades to unavailable when the budget is exhausted', () => {
    const budget = (): number => {
      throw new Error('repo-settings budget exhausted');
    };
    const runGit = vi.fn(() => 'jobs:\n  lint: {}\n');

    const surface = collectRequiredChecks([], budget, runGit);

    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('budget');
    expect(runGit).not.toHaveBeenCalled();
  });

  it('computes findings/warnings from the ruleset list once origin/main reads cleanly', () => {
    const runGit = vi.fn((args: string[]) =>
      args[0] === 'show' ? 'jobs:\n  lint: {}\n' : 'abc123\n'
    );
    const rulesets: RulesetRequiredChecks[] = [
      { branches: ['main'], requiredChecks: ['lint', 'hook-posix-parse'] },
    ];

    const surface = collectRequiredChecks(rulesets, () => GIT_SHOW_TIMEOUT_MS, runGit);

    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.findings).toHaveLength(1);
    expect(surface.findings[0].message).toContain('`hook-posix-parse`');
  });
});
