import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type HookProbeEntry } from './check-hook-probes-registry.js';
import {
  checkHookProbes,
  findRegistryProblems,
  hasRegistryProblems,
  listHookScripts,
  listHuskyHooks,
  listProbeScripts,
  runProbe,
} from './check-hook-probes.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

const entry = (over: Partial<HookProbeEntry> = {}): HookProbeEntry => ({
  hook: '.claude/hooks/a.sh',
  probe: '.claude/hooks/a.probe.sh',
  ...over,
});

const noProblems = {
  unregisteredHooks: [],
  missingHooks: [],
  missingProbes: [],
  orphanProbes: [],
  duplicateHooks: [],
  duplicateProbes: [],
  unjustified: [],
};

describe('listHookScripts', () => {
  it('keeps hook scripts and drops harnesses', () => {
    expect(listHookScripts(['a.sh', 'a.probe.sh', 'b.sh'])).toEqual([
      '.claude/hooks/a.sh',
      '.claude/hooks/b.sh',
    ]);
  });

  it('drops non-script entries such as the lib directory and docs', () => {
    expect(listHookScripts(['lib', 'notes.md', 'fixture.json', 'a.sh'])).toEqual([
      '.claude/hooks/a.sh',
    ]);
  });

  // A hook need not be bash — the registry-parity check must not silently skip
  // one written in another language.
  it('catches non-bash hook scripts', () => {
    expect(listHookScripts(['a.py', 'b.mjs', 'c.ts'])).toEqual([
      '.claude/hooks/a.py',
      '.claude/hooks/b.mjs',
      '.claude/hooks/c.ts',
    ]);
  });

  // The first .ts hook will carry a colocated test by this repo's own rule;
  // the companion must not read as an unregistered hook of its own.
  it('drops a colocated test beside a hook script', () => {
    expect(
      listHookScripts(['a.ts', 'a.test.ts', 'b.js', 'b.test.js', 'c.sh', 'c.test.sh'])
    ).toEqual(['.claude/hooks/a.ts', '.claude/hooks/b.js', '.claude/hooks/c.sh']);
  });

  // A hook named husky-style — no extension, exec bit set — must not be
  // invisible to the registry check just because it skipped the extension.
  it('catches an extensionless executable hook', () => {
    expect(listHookScripts(['pre-flight'], new Set(['pre-flight']))).toEqual([
      '.claude/hooks/pre-flight',
    ]);
  });

  it('ignores an extensionless file that is not executable', () => {
    expect(listHookScripts(['NOTES'], new Set())).toEqual([]);
  });

  it('does not treat a dotted non-script name as an extensionless hook', () => {
    expect(listHookScripts(['config.json'], new Set(['config.json']))).toEqual([]);
  });
});

describe('listProbeScripts', () => {
  it('keeps only harnesses', () => {
    expect(listProbeScripts(['a.sh', 'a.probe.sh', 'lib'])).toEqual(['.claude/hooks/a.probe.sh']);
  });
});

describe('listHuskyHooks', () => {
  it('keeps files named after a git hook', () => {
    expect(listHuskyHooks(['pre-commit', 'commit-msg'])).toEqual([
      '.husky/commit-msg',
      '.husky/pre-commit',
    ]);
  });

  // git invokes hooks by exact filename, so anything else in .husky/ is not a
  // hook — a stray README must not read as an unregistered one.
  it('drops files that are not git hook names', () => {
    expect(listHuskyHooks(['README.md', '.gitignore', '_', 'pre-push'])).toEqual([
      '.husky/pre-push',
    ]);
  });

  it('catches a git hook nobody has registered yet', () => {
    expect(listHuskyHooks(['post-checkout'])).toEqual(['.husky/post-checkout']);
  });
});

describe('findRegistryProblems', () => {
  const paths = new Set(['.claude/hooks/a.sh', '.claude/hooks/a.probe.sh']);

  it('reports nothing when registry and disk agree', () => {
    const problems = findRegistryProblems(
      [entry()],
      ['.claude/hooks/a.sh'],
      ['.claude/hooks/a.probe.sh'],
      paths
    );
    expect(problems).toEqual(noProblems);
    expect(hasRegistryProblems(problems)).toBe(false);
  });

  it('flags a hook on disk with no registry row', () => {
    const problems = findRegistryProblems(
      [entry()],
      ['.claude/hooks/a.sh', '.claude/hooks/new.sh'],
      ['.claude/hooks/a.probe.sh'],
      paths
    );
    expect(problems.unregisteredHooks).toEqual(['.claude/hooks/new.sh']);
    expect(hasRegistryProblems(problems)).toBe(true);
  });

  it('flags a registry row whose hook file is gone', () => {
    const problems = findRegistryProblems(
      [entry({ hook: '.claude/hooks/deleted.sh', probe: null, unprobedReason: 'why' })],
      [],
      [],
      new Set()
    );
    expect(problems.missingHooks).toEqual(['.claude/hooks/deleted.sh']);
  });

  it('flags a row naming a probe file that does not exist', () => {
    const problems = findRegistryProblems(
      [entry({ probe: '.claude/hooks/absent.probe.sh' })],
      ['.claude/hooks/a.sh'],
      [],
      new Set(['.claude/hooks/a.sh'])
    );
    expect(problems.missingProbes).toEqual(['.claude/hooks/absent.probe.sh']);
  });

  // An empty probe path is invisible without an explicit length check, because
  // join(root, '') normalizes to root — which exists. This case is what the
  // guard's own comment cites, so keep the two together.
  it('flags an empty-string probe path as missing', () => {
    const problems = findRegistryProblems(
      [entry({ probe: '' })],
      ['.claude/hooks/a.sh'],
      [],
      new Set(['.claude/hooks/a.sh', ''])
    );
    expect(problems.missingProbes).toEqual(['']);
    expect(hasRegistryProblems(problems)).toBe(true);
  });

  it('flags an empty-string hook path as missing', () => {
    const problems = findRegistryProblems(
      [entry({ hook: '', probe: null, unprobedReason: 'why' })],
      [],
      [],
      new Set([''])
    );
    expect(problems.missingHooks).toEqual(['']);
    expect(hasRegistryProblems(problems)).toBe(true);
  });

  it('flags a probe on disk that no row references', () => {
    const problems = findRegistryProblems(
      [entry({ probe: null, unprobedReason: 'why' })],
      ['.claude/hooks/a.sh'],
      ['.claude/hooks/a.probe.sh'],
      new Set(['.claude/hooks/a.sh'])
    );
    expect(problems.orphanProbes).toEqual(['.claude/hooks/a.probe.sh']);
  });

  // The mirror of the duplicate-probe case. Lives in the runtime guard, not
  // only in the registry data test, so the gate is self-validating alone.
  it('flags a hook path appearing in two rows', () => {
    const problems = findRegistryProblems(
      [entry(), entry({ probe: '.claude/hooks/b.probe.sh' })],
      ['.claude/hooks/a.sh'],
      [],
      new Set(['.claude/hooks/a.sh', '.claude/hooks/a.probe.sh', '.claude/hooks/b.probe.sh'])
    );
    expect(problems.duplicateHooks).toEqual(['.claude/hooks/a.sh']);
    expect(hasRegistryProblems(problems)).toBe(true);
  });

  // Two hooks sharing one probe: the path exists and is referenced, so every
  // other check reads healthy while the second hook is entirely unverified.
  it('flags a probe referenced by two hook rows', () => {
    const problems = findRegistryProblems(
      [entry(), entry({ hook: '.claude/hooks/b.sh' })],
      ['.claude/hooks/a.sh', '.claude/hooks/b.sh'],
      ['.claude/hooks/a.probe.sh'],
      new Set(['.claude/hooks/a.sh', '.claude/hooks/b.sh', '.claude/hooks/a.probe.sh'])
    );
    expect(problems.duplicateProbes).toEqual(['.claude/hooks/a.probe.sh']);
    expect(problems.orphanProbes, 'orphanProbes cannot see this').toEqual([]);
    expect(hasRegistryProblems(problems)).toBe(true);
  });

  it('reports a duplicated probe once, however many rows share it', () => {
    const problems = findRegistryProblems(
      [entry(), entry({ hook: '.claude/hooks/b.sh' }), entry({ hook: '.claude/hooks/c.sh' })],
      [],
      [],
      new Set(['.claude/hooks/a.probe.sh'])
    );
    expect(problems.duplicateProbes).toEqual(['.claude/hooks/a.probe.sh']);
  });

  it('flags an unprobed row with no reason, and accepts one with a reason', () => {
    expect(
      findRegistryProblems([entry({ probe: null })], ['.claude/hooks/a.sh'], [], paths).unjustified
    ).toEqual(['.claude/hooks/a.sh']);

    expect(
      findRegistryProblems(
        [entry({ probe: null, unprobedReason: 'unregistered, never executes' })],
        ['.claude/hooks/a.sh'],
        [],
        paths
      ).unjustified
    ).toEqual([]);
  });

  it('treats a whitespace-only reason as absent', () => {
    const problems = findRegistryProblems(
      [entry({ probe: null, unprobedReason: '   ' })],
      ['.claude/hooks/a.sh'],
      [],
      paths
    );
    expect(problems.unjustified).toEqual(['.claude/hooks/a.sh']);
  });
});

describe('runProbe', () => {
  it('returns null when the probe exits 0', () => {
    expect(runProbe('/dev/null', REPO_ROOT)).toBeNull();
  });

  it('returns captured output when the probe exits non-zero', () => {
    const output = runProbe('/nonexistent-probe-path.sh', REPO_ROOT);
    expect(output).not.toBeNull();
    expect(output).toMatch(/nonexistent-probe-path/);
  });

  // The whole point of the timeout is that a kill reports as a kill rather than
  // as a bare unattributed failure, so the message shape is the assertion — and
  // it must name the SIGNAL, since a cancelled job delivers the same one.
  it('names the timeout when a probe is killed for hanging', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hook-probes-hang-'));
    try {
      const hanging = join(dir, 'hangs.sh');
      // `sleep 2`, not something longer: the timeout signals bash, which does
      // not forward it to a foreground sleep, so the child outlives the test by
      // whatever this says. Long enough to still be running at the timeout,
      // short enough to reap itself rather than idle in CI.
      //
      // 500ms rather than a tighter bound: this asserts a TIMEOUT fires, so the
      // margin only has to exceed bash startup + signal registration. A loaded
      // runner is the realistic risk to that margin, and a flaky gate is worse
      // than 500ms of test time.
      writeFileSync(hanging, '#!/bin/bash\nsleep 2\n');
      const output = runProbe(hanging, REPO_ROOT, 500);
      expect(output).toMatch(/SIGTERM — usually the 500ms probe ceiling/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('checkHookProbes (over a fixture tree)', () => {
  const fixtures: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    while (fixtures.length > 0) rmSync(fixtures.pop() as string, { recursive: true, force: true });
  });

  /** A throwaway repo root with `.claude/hooks` + `.husky` populated. */
  const fixtureRoot = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'hook-probes-'));
    fixtures.push(root);
    mkdirSync(join(root, '.claude/hooks'), { recursive: true });
    mkdirSync(join(root, '.husky/_'), { recursive: true });
    for (const [rel, body] of Object.entries(files)) writeFileSync(join(root, rel), body);
    return root;
  };

  const PASSING = '#!/bin/bash\nexit 0\n';

  it('passes and reports the counts when registry and probes are healthy', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = fixtureRoot({
      '.claude/hooks/a.sh': PASSING,
      '.claude/hooks/a.probe.sh': PASSING,
      '.husky/pre-commit': PASSING,
    });

    checkHookProbes({
      rootDir: root,
      entries: [
        { hook: '.claude/hooks/a.sh', probe: '.claude/hooks/a.probe.sh' },
        { hook: '.husky/pre-commit', probe: null, unprobedReason: 'covered elsewhere' },
      ],
    });

    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls[0][0]).toMatch(/1 hook probe\(s\) passed; 1 hook\(s\)/);
  });

  it('fails on a registry problem without running any probe', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = fixtureRoot({
      '.claude/hooks/a.sh': PASSING,
      '.claude/hooks/unregistered.sh': PASSING,
    });

    checkHookProbes({
      rootDir: root,
      entries: [{ hook: '.claude/hooks/a.sh', probe: null, unprobedReason: 'why' }],
    });

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(/unregistered\.sh/);
  });

  // A husky hook added with no registry row must be reported the same way a
  // .claude/hooks one is — this is the half that was one-directional before.
  it('fails on an unregistered husky hook', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = fixtureRoot({ '.husky/pre-push': PASSING });

    checkHookProbes({ rootDir: root, entries: [] });

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(/\.husky\/pre-push/);
  });

  it("does not treat husky's _ internals directory as a hook", () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = fixtureRoot({ '.husky/_/husky.sh': PASSING });

    checkHookProbes({ rootDir: root, entries: [] });

    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  // Covers the real statSync(...).mode wiring feeding listHookScripts'
  // extensionless arm — the unit test above injects the executable set, so
  // only a real chmod'd fixture proves the two halves are connected.
  it('flags an extensionless executable hook, and ignores it unset', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const root = fixtureRoot({ '.claude/hooks/pre-flight': PASSING });
    const hookPath = join(root, '.claude/hooks/pre-flight');

    chmodSync(hookPath, 0o755);
    checkHookProbes({ rootDir: root, entries: [] });
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toMatch(/pre-flight/);

    process.exitCode = undefined;
    chmodSync(hookPath, 0o644);
    checkHookProbes({ rootDir: root, entries: [] });
    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalled();
  });

  it('fails and surfaces the failing probe output', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = fixtureRoot({
      '.claude/hooks/a.sh': PASSING,
      '.claude/hooks/a.probe.sh': '#!/bin/bash\necho "case 3 FAILED"\nexit 1\n',
    });

    checkHookProbes({
      rootDir: root,
      entries: [{ hook: '.claude/hooks/a.sh', probe: '.claude/hooks/a.probe.sh' }],
    });

    expect(process.exitCode).toBe(1);
    const output = error.mock.calls.flat().join('\n');
    expect(output).toMatch(/1 of 1 hook probe\(s\) FAILED/);
    expect(output).toMatch(/case 3 FAILED/);
  });
});
