import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateMutationGate, runMutationGate } from './mutation-gate.js';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ appendFileSync: vi.fn() }));

const mockExec = vi.mocked(execFileSync);
const mockAppend = vi.mocked(appendFileSync);

describe('evaluateMutationGate', () => {
  it('skips when only untracked surfaces changed', () => {
    const decision = evaluateMutationGate(
      ['services/bot-client/src/index.ts', 'docs/commands.md', '.claude/skills/foo/SKILL.md'],
      ['@tzurot/bot-client', '@tzurot/e2e']
    );
    expect(decision.run).toBe(false);
    expect(decision.reasons).toEqual([]);
  });

  it('runs when a tracked package is in the affected set', () => {
    const decision = evaluateMutationGate(
      ['packages/identity/src/personality/PersonalityLoader.ts'],
      ['@tzurot/identity', '@tzurot/e2e']
    );
    expect(decision.run).toBe(true);
    expect(decision.reasons.join(' ')).toContain('@tzurot/identity');
  });

  it('runs when a workspace dep marks tracked packages affected without direct file changes', () => {
    // common-types change: turbo's closure lists the tracked dependents even
    // though no changed FILE lives under a tracked package's tree.
    const decision = evaluateMutationGate(
      ['packages/common-types/src/constants/discord.ts'],
      ['@tzurot/common-types', '@tzurot/identity', '@tzurot/clients', '@tzurot/bot-client']
    );
    expect(decision.run).toBe(true);
  });

  it.each([
    'pnpm-lock.yaml',
    'package.json',
    'turbo.json',
    'vitest.workspace.ts',
    '.npmrc',
    '.github/workflows/ci.yml',
    '.github/baselines/mutation-baseline.json',
    'packages/tooling/src/test/mutation-check.ts',
    'packages/tooling/src/commands/test.ts',
    'tsconfig.base.json',
  ])('runs on global trigger %s even with no affected packages', file => {
    const decision = evaluateMutationGate([file], []);
    expect(decision.run).toBe(true);
    expect(decision.reasons.join(' ')).toContain(file);
  });

  it('does NOT treat a package-level tsconfig as the root-tsconfig trigger', () => {
    const decision = evaluateMutationGate(['packages/identity/tsconfig.json'], []);
    expect(decision.run).toBe(false);
  });

  it('does NOT treat a package-level package.json as the root trigger', () => {
    const decision = evaluateMutationGate(
      ['services/bot-client/package.json'],
      ['@tzurot/bot-client']
    );
    expect(decision.run).toBe(false);
  });
});

describe('runMutationGate', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_OUTPUT', '/tmp/gh-output');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mockExec.mockReset();
    mockAppend.mockReset();
  });

  function stubGitAndTurbo(changed: string, turboJson: string): void {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === 'git') {
        return changed;
      }
      return turboJson;
    });
  }

  it('threads the base ref into BOTH the git diff and the turbo filter (seam args)', () => {
    // Rule 7 (02-code-standards): the mocked seam must have its arguments
    // asserted — a base-threading bug would otherwise pass every test,
    // since the mock ignores what it's called with.
    stubGitAndTurbo('docs/commands.md\n', JSON.stringify({ packages: { items: [] } }));

    runMutationGate({ base: 'origin/main' });

    expect(mockExec).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'origin/main...HEAD'],
      expect.anything()
    );
    expect(mockExec).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'turbo', 'ls', '--filter', '...[origin/main]', '--output=json'],
      expect.anything()
    );
  });

  it('writes run=false to GITHUB_OUTPUT on a clean skip', () => {
    stubGitAndTurbo(
      'services/bot-client/src/index.ts\n',
      JSON.stringify({ packages: { items: [{ name: '@tzurot/bot-client' }] } })
    );

    runMutationGate({ base: 'origin/develop' });

    expect(mockAppend).toHaveBeenCalledWith('/tmp/gh-output', 'run=false\n');
  });

  it('writes run=true when a tracked package is affected', () => {
    stubGitAndTurbo(
      'packages/clients/src/http.ts\n',
      JSON.stringify({ packages: { items: [{ name: '@tzurot/clients' }] } })
    );

    runMutationGate({});

    expect(mockAppend).toHaveBeenCalledWith('/tmp/gh-output', 'run=true\n');
  });

  it('tolerates leading noise before the turbo JSON document', () => {
    stubGitAndTurbo(
      'docs/commands.md\n',
      'some wrapper banner\n' + JSON.stringify({ packages: { items: [] } })
    );

    runMutationGate({});

    expect(mockAppend).toHaveBeenCalledWith('/tmp/gh-output', 'run=false\n');
  });

  it('fails OPEN (run=true) when git or turbo throws', () => {
    mockExec.mockImplementation(() => {
      throw new Error('no merge base');
    });

    runMutationGate({});

    expect(mockAppend).toHaveBeenCalledWith('/tmp/gh-output', 'run=true\n');
  });

  it('fails OPEN when turbo output has no JSON', () => {
    stubGitAndTurbo('docs/commands.md\n', 'not json at all');

    runMutationGate({});

    expect(mockAppend).toHaveBeenCalledWith('/tmp/gh-output', 'run=true\n');
  });

  it('skips the GITHUB_OUTPUT write when the env var is absent', () => {
    vi.stubEnv('GITHUB_OUTPUT', '');
    stubGitAndTurbo('docs/commands.md\n', JSON.stringify({ packages: { items: [] } }));

    runMutationGate({});

    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('does not throw when the GITHUB_OUTPUT write itself fails (total fail-open)', () => {
    // A throwing step skips all downstream steps via GitHub's implicit
    // success() gating — fail-CLOSED. Absent output reads as "run", so the
    // write failure must be swallowed, not propagated.
    stubGitAndTurbo('docs/commands.md\n', JSON.stringify({ packages: { items: [] } }));
    mockAppend.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => runMutationGate({})).not.toThrow();
    expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
      expect.stringContaining('could not write GITHUB_OUTPUT')
    );
  });
});
