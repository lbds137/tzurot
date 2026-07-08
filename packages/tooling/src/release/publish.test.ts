import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }));

const mockedExec = vi.mocked(execFileSync);
const mockedExists = vi.mocked(existsSync);

// Import AFTER the mocks so the module bindings capture the mocked versions.
import { isPrereleaseVersion, toTag, findPreviousReleaseTag, publishRelease } from './publish.js';

describe('isPrereleaseVersion', () => {
  it.each([
    ['3.0.0-beta.155', true],
    ['v3.0.0-beta.155', true],
    ['3.0.0-alpha.2', true],
    ['3.0.0-rc.1', true],
    ['v3.1.0-rc.10', true],
    ['3.0.0', false],
    ['v3.0.0', false],
    ['3.2.1', false],
  ])('%s → prerelease=%s', (version, expected) => {
    expect(isPrereleaseVersion(version)).toBe(expected);
  });
});

describe('toTag', () => {
  it('adds a v prefix only when missing', () => {
    expect(toTag('3.0.0-beta.1')).toBe('v3.0.0-beta.1');
    expect(toTag('v3.0.0-beta.1')).toBe('v3.0.0-beta.1');
  });
});

describe('findPreviousReleaseTag', () => {
  it('returns the most recent GitHub release tag excluding the current one', () => {
    // gh release list --json tagName --jq '.[].tagName' → newest first.
    mockedExec.mockReturnValue('v3.0.0-beta.155\nv3.0.0-beta.154\nv3.0.0-beta.153\n' as never);
    expect(findPreviousReleaseTag('v3.0.0-beta.155')).toBe('v3.0.0-beta.154');
  });

  it('returns null when the current tag is the only release', () => {
    mockedExec.mockReturnValue('v3.0.0-beta.155\n' as never);
    expect(findPreviousReleaseTag('v3.0.0-beta.155')).toBeNull();
  });
});

describe('publishRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExists.mockReturnValue(true);
  });

  /** Collect the (cmd, args) of every non-dry-run exec call. */
  function calls(): { cmd: string; args: string[] }[] {
    return mockedExec.mock.calls.map(c => ({ cmd: c[0] as string, args: c[1] as string[] }));
  }

  function stubTagAbsentThenReleaseList(releaseList: string): void {
    mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
      // ls-remote --exit-code (remoteTagExists) → throw (not on remote yet)
      if (args[0] === 'ls-remote') {
        throw new Error('not on remote');
      }
      // gh release view (releaseExists) → throw (release not created yet)
      if (args[0] === 'release' && args[1] === 'view') {
        throw new Error('release not found');
      }
      // rev-parse --verify (localTagExists) → throw (no local tag yet)
      if (args[0] === 'rev-parse') {
        throw new Error('unknown revision');
      }
      // gh release list → the newest-first tag list for findPreviousReleaseTag
      if (args[0] === 'release' && args[1] === 'list') {
        return releaseList as never;
      }
      return '' as never;
    }) as unknown as typeof execFileSync);
  }

  it('a beta release creates the release as --latest AND demotes the previous tag to prerelease', () => {
    stubTagAbsentThenReleaseList('v3.0.0-beta.155\nv3.0.0-beta.154\n');

    publishRelease('3.0.0-beta.155', { notesFile: '/tmp/notes.md' });

    const ghCreate = calls().find(c => c.cmd === 'gh' && c.args[1] === 'create');
    expect(ghCreate?.args).toContain('--latest');
    expect(ghCreate?.args).not.toContain('--prerelease');

    // The channel invariant: the immediately-previous beta gets demoted.
    const ghEdit = calls().find(c => c.cmd === 'gh' && c.args[1] === 'edit');
    expect(ghEdit?.args).toEqual(['release', 'edit', 'v3.0.0-beta.154', '--prerelease']);
  });

  it('a STABLE release creates as --latest and does NOT demote the previous tag', () => {
    stubTagAbsentThenReleaseList('v3.0.0\nv3.0.0-beta.155\n');

    publishRelease('3.0.0', { notesFile: '/tmp/notes.md' });

    const ghCreate = calls().find(c => c.cmd === 'gh' && c.args[1] === 'create');
    expect(ghCreate?.args).toContain('--latest');

    // The whole point of the gate: no demotion on a GA release.
    const ghEdit = calls().find(c => c.cmd === 'gh' && c.args[1] === 'edit');
    expect(ghEdit).toBeUndefined();
  });

  it('a prerelease whose PREVIOUS release is stable GA does NOT demote the stable one', () => {
    // Publishing 3.1.0-beta.1 right after shipping 3.0.0 GA: the previous
    // release is stable and must stay stable, even though the current version
    // is a prerelease. Guards the demote target's shape, not just the current.
    stubTagAbsentThenReleaseList('v3.1.0-beta.1\nv3.0.0\nv3.0.0-beta.155\n');

    publishRelease('3.1.0-beta.1', { notesFile: '/tmp/notes.md' });

    // Previous release (v3.0.0) is stable → no demote.
    const ghEdit = calls().find(c => c.cmd === 'gh' && c.args[1] === 'edit');
    expect(ghEdit).toBeUndefined();
  });

  it('reuses a tag already on the remote — no tag -a, no push', () => {
    mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'ls-remote') return '' as never; // already on remote
      if (args[0] === 'release' && args[1] === 'view') throw new Error('release not found');
      if (args[0] === 'release' && args[1] === 'list') {
        return 'v3.0.0-beta.155\nv3.0.0-beta.154\n' as never;
      }
      return '' as never;
    }) as unknown as typeof execFileSync);

    publishRelease('3.0.0-beta.155', { notesFile: '/tmp/notes.md' });

    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'tag')).toBe(false);
    // Pin the push-skip invariant directly (not just via shared-branch coupling).
    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'push')).toBe(false);
  });

  it('retry after the release exists (failed on demote) skips create and still demotes', () => {
    // A run that got past create but failed on the demote step must be
    // re-runnable — `gh release create` cannot be re-issued for an existing tag.
    mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'ls-remote') return '' as never; // tag on remote
      if (args[0] === 'release' && args[1] === 'view') return '' as never; // release EXISTS
      if (args[0] === 'release' && args[1] === 'list') {
        return 'v3.0.0-beta.155\nv3.0.0-beta.154\n' as never;
      }
      return '' as never;
    }) as unknown as typeof execFileSync);

    publishRelease('3.0.0-beta.155', { notesFile: '/tmp/notes.md' });

    // create is skipped (would hard-fail "already exists")...
    expect(calls().some(c => c.cmd === 'gh' && c.args[1] === 'create')).toBe(false);
    // ...but the demote still runs (it's the step that failed last time).
    const ghEdit = calls().find(c => c.cmd === 'gh' && c.args[1] === 'edit');
    expect(ghEdit?.args).toEqual(['release', 'edit', 'v3.0.0-beta.154', '--prerelease']);
  });

  it('retry after a failed push (local tag exists, remote missing) re-pushes WITHOUT re-tagging', () => {
    // The exact orphan-tag scenario the remote-gating fix exists for.
    mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'ls-remote') throw new Error('not on remote'); // remote missing
      if (args[0] === 'rev-parse') return '' as never; // local tag DOES exist (orphan)
      if (args[0] === 'release' && args[1] === 'view') throw new Error('release not found');
      if (args[0] === 'release' && args[1] === 'list') {
        return 'v3.0.0-beta.155\nv3.0.0-beta.154\n' as never;
      }
      return '' as never;
    }) as unknown as typeof execFileSync);

    publishRelease('3.0.0-beta.156', { notesFile: '/tmp/notes.md' });

    // Must NOT re-run `git tag -a` (would error "already exists")...
    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'tag' && c.args.includes('-a'))).toBe(
      false
    );
    // ...but MUST push the orphaned local tag.
    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'push')).toBe(true);
  });

  it('throws a helpful error when the notes file is missing', () => {
    mockedExists.mockReturnValue(false);
    expect(() => publishRelease('3.0.0-beta.155', { notesFile: '/tmp/nope.md' })).toThrow(
      /Release notes file not found/
    );
  });

  it('dry-run performs no tag/release/flip side effects', () => {
    mockedExec.mockImplementation(((_cmd: string, args: readonly string[]) => {
      if (args[0] === 'ls-remote') throw new Error('not on remote');
      if (args[0] === 'rev-parse') throw new Error('absent');
      if (args[0] === 'release' && args[1] === 'view') throw new Error('release not found');
      if (args[0] === 'release' && args[1] === 'list') {
        return 'v3.0.0-beta.155\nv3.0.0-beta.154\n' as never;
      }
      return '' as never;
    }) as unknown as typeof execFileSync);

    publishRelease('3.0.0-beta.155', { notesFile: '/tmp/notes.md', dryRun: true });

    // Read-only probes still run (rev-parse existence, `gh release list` to
    // resolve the demote target), but NO mutating command executes.
    expect(calls().some(c => c.cmd === 'gh' && c.args[1] === 'create')).toBe(false);
    expect(calls().some(c => c.cmd === 'gh' && c.args[1] === 'edit')).toBe(false);
    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'push')).toBe(false);
    expect(calls().some(c => c.cmd === 'git' && c.args[0] === 'tag')).toBe(false);
  });
});
