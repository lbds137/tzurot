import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type HookProbeEntry } from './check-hook-probes-registry.js';
import {
  findHookWiringProblems,
  findUnwiredHooks,
  reportHookWiringProblems,
} from './check-hook-wiring.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

describe('findUnwiredHooks', () => {
  it('returns nothing when the corpus contains the basename', () => {
    expect(findUnwiredHooks(['.claude/hooks/a.sh'], 'some text mentioning a.sh here')).toEqual([]);
  });

  it('reports the hook when the corpus does not contain it', () => {
    expect(findUnwiredHooks(['.claude/hooks/a.sh'], 'nothing relevant here')).toEqual([
      { hook: '.claude/hooks/a.sh' },
    ]);
  });
});

describe('findHookWiringProblems (over a fixture tree)', () => {
  const fixtures: string[] = [];

  afterEach(() => {
    while (fixtures.length > 0) rmSync(fixtures.pop() as string, { recursive: true, force: true });
  });

  /** A throwaway repo root with `.claude/hooks` populated. */
  const fixtureRoot = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'hook-wiring-'));
    fixtures.push(root);
    mkdirSync(join(root, '.claude/hooks'), { recursive: true });
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
    return root;
  };

  // The canary: a hook registered but referenced by nothing. The mutation is
  // strictly INSIDE the fixture — settings.json exists and is valid JSON, only
  // the reference to this one hook is missing.
  it('reports a registered hook that settings.json does not reference', () => {
    const root = fixtureRoot({
      '.claude/hooks/unwired-example.sh': '#!/bin/bash\nexit 0\n',
      '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [] } }),
    });
    const entries: HookProbeEntry[] = [
      { hook: '.claude/hooks/unwired-example.sh', probe: null, unprobedReason: 'fixture' },
    ];

    const problems = findHookWiringProblems({ rootDir: root, entries });

    expect(problems).toEqual([{ hook: '.claude/hooks/unwired-example.sh' }]);
  });

  it('reports nothing once settings.json references the hook', () => {
    const root = fixtureRoot({
      '.claude/hooks/unwired-example.sh': '#!/bin/bash\nexit 0\n',
      '.claude/settings.json': JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: '.claude/hooks/unwired-example.sh' }],
            },
          ],
        },
      }),
    });
    const entries: HookProbeEntry[] = [
      { hook: '.claude/hooks/unwired-example.sh', probe: null, unprobedReason: 'fixture' },
    ];

    const problems = findHookWiringProblems({ rootDir: root, entries });

    expect(problems).toEqual([]);
  });

  it('skips a .husky/ row — git invokes those by filename, nothing to wire', () => {
    const root = fixtureRoot({
      '.claude/settings.json': JSON.stringify({ hooks: {} }),
    });
    const entries: HookProbeEntry[] = [
      { hook: '.husky/pre-commit', probe: null, unprobedReason: 'n/a' },
    ];

    const problems = findHookWiringProblems({ rootDir: root, entries });

    expect(problems).toEqual([]);
  });

  // The real repo: every registered, non-husky hook must be wired somewhere.
  // If this goes red, it names a genuinely unwired hook — do not delete
  // anything else to make it pass.
  it('finds no unwired hooks in the real repo', () => {
    const problems = findHookWiringProblems({ rootDir: REPO_ROOT });
    expect(problems).toEqual([]);
  });
});

describe('reportHookWiringProblems', () => {
  it('prints a header line, then one line per hook naming it and its disposition', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    reportHookWiringProblems([{ hook: '.claude/hooks/x.sh' }, { hook: '.claude/hooks/y.sh' }]);

    expect(error).toHaveBeenCalledTimes(3);
    expect(error.mock.calls[0][0]).toMatch(/Hooks registered but referenced by nothing/);
    expect(error.mock.calls[1][0]).toMatch(/\.claude\/hooks\/x\.sh/);
    expect(error.mock.calls[1][0]).toMatch(/wire it or delete it/);
    expect(error.mock.calls[2][0]).toMatch(/\.claude\/hooks\/y\.sh/);
    expect(error.mock.calls[2][0]).toMatch(/wire it or delete it/);

    error.mockRestore();
  });
});
