/**
 * Tests for the open-advisory enumeration used by `security:advisories` and the
 * health report. `gh` (execFileSync) and the workspace package.json walk (fs)
 * are mocked so the mapping, direct/transitive classification, severity sort,
 * and degradation are all exercised without a live GitHub token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import {
  collectOpenAdvisories,
  recommendedAction,
  hasActionableStrictAdvisory,
  formatAdvisoriesReport,
  runAdvisoriesCommand,
  type Advisory,
} from './advisories.js';

/** Build an Advisory with sensible defaults for the pure-function tests. */
function advisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    package: 'example',
    ecosystem: 'npm',
    severity: 'medium',
    vulnerableRange: '>= 1.0.0, < 2.0.0',
    firstPatched: '2.0.0',
    ghsaId: 'GHSA-xxxx-xxxx-xxxx',
    isDirect: false,
    ...overrides,
  };
}

/** One alert as the `gh api --jq` projection emits it (before enrichment). Defaults to npm. */
function rawAlertLine(fields: {
  package: string;
  ecosystem?: string;
  severity: string;
  vulnerableRange: string;
  firstPatched: string | null;
  ghsaId: string;
}): string {
  return JSON.stringify({ ecosystem: 'npm', ...fields });
}

describe('recommendedAction', () => {
  it('flags a transitive fix-available advisory as needing a manual override', () => {
    const action = recommendedAction(advisory({ isDirect: false, firstPatched: '7.6.5' }));
    expect(action).toContain('Manual override');
    expect(action).toContain('>=7.6.5');
    expect(action).toContain("Dependabot can't PR");
  });

  it('defers a direct fix-available advisory to Dependabot', () => {
    const action = recommendedAction(advisory({ isDirect: true, firstPatched: '2.0.0' }));
    expect(action).toContain('Dependabot PR expected');
    expect(action).toContain('>=2.0.0');
  });

  it('marks a no-fix advisory as upstream-tracked regardless of scope', () => {
    expect(recommendedAction(advisory({ firstPatched: null, isDirect: true }))).toContain(
      'No fix published yet'
    );
    expect(recommendedAction(advisory({ firstPatched: null, isDirect: false }))).toContain(
      'No fix published yet'
    );
  });

  it('gives a non-npm advisory a generic action, NOT the npm pnpm.overrides text', () => {
    const action = recommendedAction(
      advisory({ ecosystem: 'pip', isDirect: false, firstPatched: '1.2.3' })
    );
    expect(action).toContain('pip manifest');
    expect(action).not.toContain('pnpm.overrides');
    expect(action).not.toContain("Dependabot can't PR");
  });
});

describe('hasActionableStrictAdvisory', () => {
  it('is true only for high/critical advisories that have a published fix', () => {
    expect(
      hasActionableStrictAdvisory([advisory({ severity: 'high', firstPatched: '2.0.0' })])
    ).toBe(true);
    expect(
      hasActionableStrictAdvisory([advisory({ severity: 'critical', firstPatched: '1.2.3' })])
    ).toBe(true);
  });

  it('is false for a high/critical advisory with NO fix (unactionable — never fail the gate)', () => {
    expect(
      hasActionableStrictAdvisory([advisory({ severity: 'critical', firstPatched: null })])
    ).toBe(false);
  });

  it('is false for a low/medium advisory even with a fix', () => {
    expect(
      hasActionableStrictAdvisory([advisory({ severity: 'low', firstPatched: '2.0.0' })])
    ).toBe(false);
    expect(
      hasActionableStrictAdvisory([advisory({ severity: 'medium', firstPatched: '2.0.0' })])
    ).toBe(false);
  });

  it('is false for an empty advisory list', () => {
    expect(hasActionableStrictAdvisory([])).toBe(false);
  });
});

describe('formatAdvisoriesReport', () => {
  it('reports degradation with the reason', () => {
    expect(formatAdvisoriesReport({ available: false, reason: 'gh not authenticated' })).toContain(
      'unavailable (gh not authenticated)'
    );
  });

  it('reports the clean state when there are no advisories', () => {
    expect(formatAdvisoriesReport({ available: true, advisories: [] })).toContain(
      'No open Dependabot advisories'
    );
  });

  it('lists each advisory with package, scope, range, and action + a transitive footer', () => {
    const report = formatAdvisoriesReport({
      available: true,
      advisories: [
        advisory({
          package: 'protobufjs',
          severity: 'medium',
          isDirect: false,
          firstPatched: '7.6.5',
        }),
      ],
    });
    expect(report).toContain('protobufjs');
    expect(report).toContain('transitive');
    expect(report).toContain('>= 1.0.0, < 2.0.0');
    expect(report).toContain('Manual override');
    // The footer summarizes the transitive-needs-override action.
    expect(report).toContain('pnpm.overrides bump');
  });

  it('omits the transitive footer when every advisory is direct', () => {
    const report = formatAdvisoriesReport({
      available: true,
      advisories: [advisory({ package: 'express', isDirect: true })],
    });
    expect(report).not.toContain('need a manual');
    expect(report).not.toContain('needs a manual');
  });

  it('labels a non-npm advisory by ecosystem and excludes it from the npm footer', () => {
    const report = formatAdvisoriesReport({
      available: true,
      advisories: [
        // A pip advisory that is NOT direct-npm: must not be counted as an npm
        // transitive needing a pnpm.overrides bump.
        advisory({
          package: 'requests',
          ecosystem: 'pip',
          isDirect: false,
          firstPatched: '2.32.0',
        }),
      ],
    });
    expect(report).toContain('(pip)');
    expect(report).not.toContain('pnpm.overrides');
    expect(report).not.toContain('needs a manual');
  });
});

describe('collectOpenAdvisories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A minimal workspace: one package.json declaring body-parser as a direct dep.
    vi.mocked(readdirSync).mockReturnValue(['package.json'] as never);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: { 'body-parser': '^2.3.0' } }) as never
    );
  });

  it('classifies direct vs transitive from the workspace dependency set', () => {
    vi.mocked(execFileSync).mockReturnValue(
      [
        rawAlertLine({
          package: 'body-parser',
          severity: 'low',
          vulnerableRange: '>= 2.0.0, < 2.3.0',
          firstPatched: '2.3.0',
          ghsaId: 'GHSA-body',
        }),
        rawAlertLine({
          package: 'protobufjs',
          severity: 'medium',
          vulnerableRange: '>= 7.5.0, <= 7.6.4',
          firstPatched: '7.6.5',
          ghsaId: 'GHSA-proto',
        }),
      ].join('\n') as never
    );

    const surface = collectOpenAdvisories('/repo');
    expect(surface.available).toBe(true);
    if (!surface.available) return;

    // Sorted medium(protobufjs) before low(body-parser).
    expect(surface.advisories.map(a => a.package)).toEqual(['protobufjs', 'body-parser']);
    const byName = Object.fromEntries(surface.advisories.map(a => [a.package, a]));
    expect(byName['body-parser'].isDirect).toBe(true); // declared in package.json
    expect(byName['protobufjs'].isDirect).toBe(false); // transitive-only
  });

  it('queries the Dependabot alerts API with pagination + open-state filter', () => {
    vi.mocked(execFileSync).mockReturnValue('' as never);
    collectOpenAdvisories('/repo');
    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toContain('--paginate');
    expect((args as string[]).join(' ')).toContain('dependabot/alerts');
    expect((args as string[]).join(' ')).toContain('state=="open"');
  });

  it('returns an empty list (available) when no alerts are open', () => {
    vi.mocked(execFileSync).mockReturnValue('\n  \n' as never);
    const surface = collectOpenAdvisories('/repo');
    expect(surface).toEqual({ available: true, advisories: [] });
  });

  it('skips a non-JSON line but keeps the valid advisories around it', () => {
    // A stray gh warning or a truncated page must drop only that line — the
    // whole report must NOT degrade to unavailable (its documented contract).
    vi.mocked(execFileSync).mockReturnValue(
      [
        rawAlertLine({
          package: 'protobufjs',
          severity: 'medium',
          vulnerableRange: '>= 7.5.0, <= 7.6.4',
          firstPatched: '7.6.5',
          ghsaId: 'GHSA-proto',
        }),
        'gh: a warning leaked onto stdout', // not valid JSON
        rawAlertLine({
          package: 'body-parser',
          severity: 'low',
          vulnerableRange: '>= 2.0.0, < 2.3.0',
          firstPatched: '2.3.0',
          ghsaId: 'GHSA-body',
        }),
      ].join('\n') as never
    );

    const surface = collectOpenAdvisories('/repo');
    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.advisories.map(a => a.package).sort()).toEqual(['body-parser', 'protobufjs']);
  });

  it('counts peer and optional dependencies as direct, not just deps/devDeps', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        peerDependencies: { 'peer-pkg': '^1' },
        optionalDependencies: { 'optional-pkg': '^1' },
      }) as never
    );
    vi.mocked(execFileSync).mockReturnValue(
      [
        rawAlertLine({
          package: 'peer-pkg',
          severity: 'high',
          vulnerableRange: '< 1.0.0',
          firstPatched: '1.0.0',
          ghsaId: 'GHSA-peer',
        }),
        rawAlertLine({
          package: 'optional-pkg',
          severity: 'low',
          vulnerableRange: '< 1.0.0',
          firstPatched: '1.0.0',
          ghsaId: 'GHSA-opt',
        }),
      ].join('\n') as never
    );

    const surface = collectOpenAdvisories('/repo');
    if (!surface.available) throw new Error('expected available');
    const byName = Object.fromEntries(surface.advisories.map(a => [a.package, a]));
    expect(byName['peer-pkg'].isDirect).toBe(true);
    expect(byName['optional-pkg'].isDirect).toBe(true);
  });

  it('degrades to unavailable-with-reason when gh throws', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error('HTTP 403') as Error & { stderr: string };
      err.stderr = 'gh: You must have admin access to view security alerts';
      throw err;
    });
    const surface = collectOpenAdvisories('/repo');
    expect(surface.available).toBe(false);
    if (surface.available) return;
    expect(surface.reason).toContain('admin access');
  });

  it('never classifies a non-npm advisory as direct, even if the name matches an npm dep', () => {
    // `requests` is in the npm dep set here, but the advisory is a pip one — the
    // npm dep set says nothing about pip, so it must stay non-direct + pip-scoped.
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: { requests: '^2' } }) as never
    );
    vi.mocked(execFileSync).mockReturnValue(
      rawAlertLine({
        package: 'requests',
        ecosystem: 'pip',
        severity: 'high',
        vulnerableRange: '< 2.32.0',
        firstPatched: '2.32.0',
        ghsaId: 'GHSA-pip',
      }) as never
    );

    const surface = collectOpenAdvisories('/repo');
    if (!surface.available) throw new Error('expected available');
    expect(surface.advisories[0].ecosystem).toBe('pip');
    expect(surface.advisories[0].isDirect).toBe(false);
  });

  it('skips an unstattable entry (dangling symlink) without degrading the report', () => {
    vi.mocked(readdirSync).mockReturnValue(['package.json', 'broken-symlink'] as never);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ dependencies: { somepkg: '^1' } }) as never
    );
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    vi.mocked(execFileSync).mockReturnValue(
      rawAlertLine({
        package: 'somepkg',
        severity: 'high',
        vulnerableRange: '< 1.0.0',
        firstPatched: '1.0.0',
        ghsaId: 'GHSA-x',
      }) as never
    );

    const surface = collectOpenAdvisories('/repo');
    // A broken symlink must NOT mask the whole advisory list behind "unavailable".
    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.advisories[0].isDirect).toBe(true); // package.json was still read
  });

  it('skips a malformed package.json without discarding the fetched advisory list', () => {
    // A mid-merge-conflict / WIP package.json must not throw away real advisories
    // that were already fetched — the bad file just contributes no dep names.
    vi.mocked(readFileSync).mockReturnValue('{ <<<<<<< HEAD not valid json' as never);
    vi.mocked(execFileSync).mockReturnValue(
      rawAlertLine({
        package: 'somepkg',
        severity: 'high',
        vulnerableRange: '< 1.0.0',
        firstPatched: '1.0.0',
        ghsaId: 'GHSA-x',
      }) as never
    );

    const surface = collectOpenAdvisories('/repo');
    expect(surface.available).toBe(true);
    if (!surface.available) return;
    expect(surface.advisories.map(a => a.package)).toEqual(['somepkg']);
    expect(surface.advisories[0].isDirect).toBe(false); // no dep names from the bad file
  });
});

describe('runAdvisoriesCommand', () => {
  const highAlertNdjson = rawAlertLine({
    package: 'somepkg',
    severity: 'high',
    vulnerableRange: '< 2.0.0',
    firstPatched: '2.0.0',
    ghsaId: 'GHSA-high',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    // No direct deps → the advisory classifies transitive, which is irrelevant
    // to the command-level branches under test (json / strict / exit-code).
    vi.mocked(readdirSync).mockReturnValue(['package.json'] as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ dependencies: {} }) as never);
  });

  function loggedOutput(): string {
    return vi
      .mocked(console.log)
      .mock.calls.flat()
      .map(arg => String(arg))
      .join('\n');
  }

  it('emits the advisory surface as JSON under --json', () => {
    vi.mocked(execFileSync).mockReturnValue(highAlertNdjson as never);
    runAdvisoriesCommand({ json: true, rootDir: '/repo' });
    const output = loggedOutput();
    expect(output).toContain('"available": true');
    expect(output).toContain('"package": "somepkg"');
  });

  it('prints the text report (not JSON) by default', () => {
    vi.mocked(execFileSync).mockReturnValue(highAlertNdjson as never);
    runAdvisoriesCommand({ rootDir: '/repo' });
    const output = loggedOutput();
    expect(output).toContain('somepkg');
    expect(output).not.toContain('"available"');
  });

  it('--strict sets a nonzero exit code on an actionable high/critical advisory', () => {
    vi.mocked(execFileSync).mockReturnValue(highAlertNdjson as never);
    runAdvisoriesCommand({ strict: true, rootDir: '/repo' });
    expect(process.exitCode).toBe(1);
  });

  it('--strict leaves the exit code clean for a low-severity advisory', () => {
    vi.mocked(execFileSync).mockReturnValue(
      rawAlertLine({
        package: 'lowpkg',
        severity: 'low',
        vulnerableRange: '< 2.0.0',
        firstPatched: '2.0.0',
        ghsaId: 'GHSA-low',
      }) as never
    );
    runAdvisoriesCommand({ strict: true, rootDir: '/repo' });
    expect(process.exitCode).toBeUndefined();
  });

  it('--strict fails open (no exit code) when the alerts API is unreadable', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('gh: 403 forbidden');
    });
    runAdvisoriesCommand({ strict: true, rootDir: '/repo' });
    expect(process.exitCode).toBeUndefined();
  });
});
