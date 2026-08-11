import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  loadWorkspacePackages,
  collectTransitiveDeps,
  extractRunnerDistCopies,
  classifyRunnerStage,
  checkService,
  type WorkspacePackage,
} from './check-dockerfile-dist.js';

beforeEach(() => {
  vi.resetAllMocks();
});

/** Build a packages map from a terse spec: { name: [dir, deps] } */
function packagesMap(spec: Record<string, [string, string[]]>): Map<string, WorkspacePackage> {
  return new Map(
    Object.entries(spec).map(([name, [dir, workspaceDeps]]) => [name, { dir, workspaceDeps }])
  );
}

const BASE_PACKAGES = packagesMap({
  '@tzurot/common-types': ['packages/common-types', []],
  '@tzurot/clients': ['packages/clients', ['@tzurot/common-types']],
  '@tzurot/embeddings': ['packages/embeddings', ['@tzurot/common-types']],
  '@tzurot/bot-client': ['services/bot-client', ['@tzurot/clients', '@tzurot/common-types']],
  '@tzurot/api-gateway': ['services/api-gateway', ['@tzurot/common-types', '@tzurot/embeddings']],
});

describe('extractRunnerDistCopies', () => {
  it('extracts dist copies from the final stage only', () => {
    const dockerfile = [
      'FROM node:25-slim AS builder',
      'COPY --from=pruner /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      'CMD ["node", "services/bot-client/dist/index.js"]',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual([
      'packages/common-types',
      'packages/clients',
      'services/bot-client',
    ]);
  });

  it('ignores non-dist copies in the runner stage', () => {
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=pruner /app/out/json/ .',
      'COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm',
      'COPY prisma ./prisma',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });

  it('treats a single-stage Dockerfile as all-runner', () => {
    const dockerfile = [
      'FROM node:25-slim',
      'COPY --from=builder /app/packages/embeddings/dist ./packages/embeddings/dist',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/embeddings']);
  });

  it('matches dist copies with subpaths after /dist', () => {
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist/index.js ./packages/common-types/dist/index.js',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });

  it('anchors on the stage explicitly named `runner`, ignoring a later stage', () => {
    const dockerfile = [
      'FROM node:25-slim AS builder',
      'COPY --from=pruner /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM scratch AS export',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    ].join('\n');

    // Only the runner stage's copy is returned — the trailing `export` stage
    // (added after runner) must not contribute copies.
    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });

  it('falls back to the last FROM stage, scanning to end of file, when no stage is named runner', () => {
    const dockerfile = [
      'FROM node:25-slim AS builder',
      'COPY --from=pruner /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM node:25-slim AS final',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual([
      'packages/clients',
      'services/bot-client',
    ]);
  });

  it('does not re-anchor onto a stage whose name merely begins with `runner`', () => {
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM node:25-slim AS runner-debug',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    ].join('\n');

    // `runner-debug` sits AFTER the real runner and would win the last-match
    // anchor if the pattern terminated on \b instead of end-of-line.
    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });

  it('still matches a runner stage with trailing whitespace or a lowercase `as`', () => {
    const trailingSpace = [
      'FROM node:25-slim AS runner   ',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM scratch AS export',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    ].join('\n');
    const lowercaseAs = trailingSpace.replace('AS runner   ', 'as runner');

    // End-of-line anchoring must not have narrowed these two accepted forms.
    expect(extractRunnerDistCopies(trailingSpace)).toEqual(['packages/common-types']);
    expect(extractRunnerDistCopies(lowercaseAs)).toEqual(['packages/common-types']);
  });

  it('does not match a flag-bearing FROM, degrading to last-stage anchoring', () => {
    // Characterization of the disclosed RUNNER_STAGE_PATTERN limitation: the
    // named-runner anchor needs a single-token image reference, so this
    // Dockerfile takes the last-`FROM` fallback — which here scans the
    // trailing export stage rather than the runner. Documented, not desired;
    // no service Dockerfile uses the flag form.
    const dockerfile = [
      'FROM --platform=$BUILDPLATFORM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM scratch AS export',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/clients']);
  });

  it('uses the LAST stage when multiple stages are named runner', () => {
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
    ].join('\n');

    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });
});

describe('collectTransitiveDeps', () => {
  it('returns direct deps', () => {
    expect(collectTransitiveDeps('@tzurot/embeddings', BASE_PACKAGES)).toEqual(
      new Set(['@tzurot/common-types'])
    );
  });

  it('follows transitive edges', () => {
    const packages = packagesMap({
      '@tzurot/common-types': ['packages/common-types', []],
      '@tzurot/clients': ['packages/clients', ['@tzurot/common-types']],
      // service deps ONLY on clients — common-types must still be reached
      '@tzurot/bot-client': ['services/bot-client', ['@tzurot/clients']],
    });

    expect(collectTransitiveDeps('@tzurot/bot-client', packages)).toEqual(
      new Set(['@tzurot/clients', '@tzurot/common-types'])
    );
  });

  it('does not include the starting package itself', () => {
    expect(
      collectTransitiveDeps('@tzurot/bot-client', BASE_PACKAGES).has('@tzurot/bot-client')
    ).toBe(false);
  });

  it('handles dependency cycles without hanging', () => {
    const packages = packagesMap({
      a: ['packages/a', ['b']],
      b: ['packages/b', ['a']],
    });

    expect(collectTransitiveDeps('a', packages)).toEqual(new Set(['b', 'a']));
  });

  it('returns empty set for unknown package', () => {
    expect(collectTransitiveDeps('@tzurot/nope', BASE_PACKAGES)).toEqual(new Set());
  });
});

describe('checkService', () => {
  const IN_SYNC_DOCKERFILE = [
    'FROM node:25-slim AS builder',
    'FROM node:25-slim AS runner',
    'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
    'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
  ].join('\n');

  it('returns no findings when copies match the dependency closure', () => {
    expect(checkService('@tzurot/bot-client', IN_SYNC_DOCKERFILE, BASE_PACKAGES)).toEqual([]);
  });

  it('flags a missing dep COPY (the PR #1145 regression shape)', () => {
    const missingClients = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n');

    const findings = checkService('@tzurot/bot-client', missingClients, BASE_PACKAGES);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      service: '@tzurot/bot-client',
      kind: 'missing-copy',
      packageDir: 'packages/clients',
    });
  });

  it('flags a missing COPY for a TRANSITIVE dep of a direct dep', () => {
    const packages = packagesMap({
      '@tzurot/common-types': ['packages/common-types', []],
      '@tzurot/clients': ['packages/clients', ['@tzurot/common-types']],
      '@tzurot/bot-client': ['services/bot-client', ['@tzurot/clients']],
    });
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n');

    const findings = checkService('@tzurot/bot-client', dockerfile, packages);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'missing-copy',
      packageDir: 'packages/common-types',
    });
  });

  it("does not flag a transitive-only dep's COPY as stale", () => {
    const packages = packagesMap({
      '@tzurot/common-types': ['packages/common-types', []],
      '@tzurot/clients': ['packages/clients', ['@tzurot/common-types']],
      '@tzurot/bot-client': ['services/bot-client', ['@tzurot/clients']],
    });
    const dockerfile = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n');

    expect(checkService('@tzurot/bot-client', dockerfile, packages)).toEqual([]);
  });

  it('flags a stale COPY for a removed dependency', () => {
    const staleEmbeddings = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'COPY --from=builder /app/packages/embeddings/dist ./packages/embeddings/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n');

    const findings = checkService('@tzurot/bot-client', staleEmbeddings, BASE_PACKAGES);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'stale-copy',
      packageDir: 'packages/embeddings',
    });
  });

  it("flags a missing COPY of the service's own dist", () => {
    const noOwnDist = [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
    ].join('\n');

    const findings = checkService('@tzurot/bot-client', noOwnDist, BASE_PACKAGES);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: 'missing-copy',
      packageDir: 'services/bot-client',
    });
  });

  it('returns no findings for a service not in the workspace map', () => {
    expect(checkService('@tzurot/unknown', IN_SYNC_DOCKERFILE, BASE_PACKAGES)).toEqual([]);
  });
});

describe('loadWorkspacePackages', () => {
  it('builds the name → dir/deps map from packages/ and services/', () => {
    vi.mocked(readdirSync).mockImplementation(dir => {
      if (String(dir).endsWith('packages')) {
        return ['common-types'] as never;
      }
      return ['bot-client'] as never;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation(path => {
      if (String(path).includes('common-types')) {
        return JSON.stringify({ name: '@tzurot/common-types', dependencies: { zod: '^4' } });
      }
      return JSON.stringify({
        name: '@tzurot/bot-client',
        dependencies: { '@tzurot/common-types': 'workspace:*', 'discord.js': '^14' },
      });
    });

    const packages = loadWorkspacePackages('/repo');

    expect(packages.get('@tzurot/common-types')).toEqual({
      dir: 'packages/common-types',
      workspaceDeps: [],
    });
    expect(packages.get('@tzurot/bot-client')).toEqual({
      dir: 'services/bot-client',
      workspaceDeps: ['@tzurot/common-types'],
    });
  });

  it('skips dirs without package.json (e.g. voice-engine)', () => {
    vi.mocked(readdirSync).mockImplementation(dir =>
      String(dir).endsWith('services') ? (['voice-engine'] as never) : ([] as never)
    );
    vi.mocked(existsSync).mockReturnValue(false);

    expect(loadWorkspacePackages('/repo').size).toBe(0);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it('tolerates a missing workspace group dir', () => {
    vi.mocked(readdirSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    expect(loadWorkspacePackages('/repo').size).toBe(0);
  });

  it('reports the offending path when a package.json is malformed', () => {
    vi.mocked(readdirSync).mockImplementation(dir =>
      String(dir).endsWith('packages') ? (['broken'] as never) : ([] as never)
    );
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('{ not json');

    expect(() => loadWorkspacePackages('/repo')).toThrow(/Failed to parse .*broken.*package\.json/);
  });
});

describe('checkDockerfileDist (orchestration)', () => {
  // Two services sharing packages/common-types — needed to exercise
  // aggregation across services (TASK-139), not just single-service checks.
  const PKG_JSON: Record<string, object> = {
    'packages/common-types/package.json': { name: '@tzurot/common-types', dependencies: {} },
    'services/bot-client/package.json': {
      name: '@tzurot/bot-client',
      dependencies: { '@tzurot/common-types': 'workspace:*' },
    },
    'services/api-gateway/package.json': {
      name: '@tzurot/api-gateway',
      dependencies: { '@tzurot/common-types': 'workspace:*' },
    },
  };

  const SERVICE_DIRS = ['services/bot-client', 'services/api-gateway'];

  const IN_SYNC_DOCKERFILES: Record<string, string> = {
    'services/bot-client': [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
    ].join('\n'),
    'services/api-gateway': [
      'FROM node:25-slim AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist',
    ].join('\n'),
  };

  let logSpy: ReturnType<typeof vi.spyOn>;
  let savedExitCode: typeof process.exitCode;

  /**
   * Wire the fs mocks to present a fake two-service workspace
   * (bot-client + api-gateway, both depending on common-types).
   *
   * `overrides` replaces one or both services' Dockerfile content by dir
   * (`services/bot-client` / `services/api-gateway`); `null` means "no
   * Dockerfile for this service". Omitted services stay in sync.
   */
  function mockWorkspace(overrides: Record<string, string | null> = {}) {
    const dockerfiles: Record<string, string | null> = { ...IN_SYNC_DOCKERFILES, ...overrides };

    vi.mocked(readdirSync).mockImplementation(dir => {
      if (String(dir).endsWith('packages')) {
        return ['common-types'] as never;
      }
      return ['bot-client', 'api-gateway'] as never;
    });
    vi.mocked(existsSync).mockImplementation(path => {
      const p = String(path);
      if (p.endsWith('package.json')) {
        return Object.keys(PKG_JSON).some(key => p.endsWith(key));
      }
      // Dockerfile existence, keyed by which service dir the path belongs to
      const serviceDir = SERVICE_DIRS.find(dir => p.endsWith(`${dir}/Dockerfile`));
      return serviceDir !== undefined && dockerfiles[serviceDir] !== null;
    });
    vi.mocked(readFileSync).mockImplementation(path => {
      const p = String(path);
      const pkgKey = Object.keys(PKG_JSON).find(key => p.endsWith(key));
      if (pkgKey !== undefined) {
        return JSON.stringify(PKG_JSON[pkgKey]);
      }
      const serviceDir = SERVICE_DIRS.find(dir => p.endsWith(`${dir}/Dockerfile`));
      return (serviceDir !== undefined ? dockerfiles[serviceDir] : undefined) ?? '';
    });
  }

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = savedExitCode;
  });

  it('passes (no exit code) when both services are in sync', async () => {
    mockWorkspace();

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Checked 2 service Dockerfile(s)');
    expect(output).toContain('All runner-stage dist copies match');
  });

  it('sets exit code 1 and reports MISSING when a dep COPY is absent', async () => {
    mockWorkspace({
      'services/bot-client': [
        'FROM node:25-slim AS runner',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      ].join('\n'),
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('packages/common-types/dist');
    expect(output).toContain('1 issue');
  });

  it('reports only the broken service and excludes the passing one when one of two is broken', async () => {
    mockWorkspace({
      'services/bot-client': [
        'FROM node:25-slim AS runner',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      ].join('\n'), // missing the common-types COPY
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('@tzurot/bot-client');
    expect(output).toContain('1 issue');
    // api-gateway is in sync — it must not surface as a finding
    expect(output).not.toContain('@tzurot/api-gateway');
  });

  it('sums findings across both services when both are broken', async () => {
    mockWorkspace({
      'services/bot-client': [
        'FROM node:25-slim AS runner',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      ].join('\n'), // missing common-types (1 finding)
      'services/api-gateway': 'FROM node:25-slim AS runner', // missing common-types AND own dist (2 findings)
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('@tzurot/bot-client');
    expect(output).toContain('@tzurot/api-gateway');
    expect(output).toContain('3 issue');
  });

  it('skips services without a Dockerfile and logs the skip in verbose mode', async () => {
    mockWorkspace({ 'services/bot-client': null, 'services/api-gateway': null });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist({ verbose: true });

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Checked 0 service Dockerfile(s)');
    expect(output).toContain('no Dockerfile, skipped');
  });

  it('fails, not merely warns, when a Dockerfile has no stage named runner', async () => {
    mockWorkspace({
      'services/bot-client': [
        'FROM node:25-slim AS final',
        'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      ].join('\n'),
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    // Deliberately NOT verbose: CI and `pnpm quality` both invoke the guard
    // without --verbose, so a signal that only appears there is invisible where
    // it matters. Every dist COPY here is correct — the finding is purely that
    // the guard cannot prove which stage it checked.
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('ANCHOR');
    expect(output).toContain('@tzurot/bot-client');
    expect(output).toContain('no stage recognized as');
    expect(output).toContain('1 issue');
  });

  it('fails when a stage follows AS runner, since that later stage is what ships', async () => {
    mockWorkspace({
      'services/bot-client': [
        'FROM node:25-slim AS runner',
        'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
        'FROM scratch AS export',
      ].join('\n'),
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('@tzurot/bot-client');
    expect(output).toContain('a stage follows `AS runner`');
    // The runner stage's own copies are complete, so this is the anchoring
    // finding alone — not a copy finding riding along.
    expect(output).toContain('1 issue');
  });
});

describe('classifyRunnerStage', () => {
  it('reports named-last only when a stage is named runner AND nothing follows it', () => {
    expect(classifyRunnerStage('FROM node:25-slim AS runner')).toBe('named-last');
    expect(classifyRunnerStage('FROM node AS builder\nFROM node AS runner')).toBe('named-last');
    expect(classifyRunnerStage('FROM node AS runner\nFROM scratch AS export')).toBe(
      'named-not-last'
    );
    expect(classifyRunnerStage('FROM node:25-slim AS runner-debug')).toBe('unnamed');
    expect(classifyRunnerStage('FROM node:25-slim AS final')).toBe('unnamed');
    expect(classifyRunnerStage('FROM node:25-slim')).toBe('unnamed');
  });

  it('classifies a mixed-case stage NAME, not just a mixed-case `as` keyword', () => {
    // Pins the JSDoc's claim that the `i` flag — required for as/AS keyword
    // variance — necessarily extends to the stage name too. Also guards a
    // future accidental tightening to case-sensitive name matching.
    expect(classifyRunnerStage('FROM node:25-slim AS Runner')).toBe('named-last');
    expect(classifyRunnerStage('FROM node:25-slim AS RUNNER')).toBe('named-last');
  });

  it('agrees with the anchoring it reports on', () => {
    // The classifier describes which path findRunnerStageWindow takes, so the
    // two must not drift: under `unnamed` a stage appended after the runtime
    // stage IS scanned (the fallback's exposure); under a named runner it is not.
    const unnamed = ['FROM node AS final', 'FROM scratch AS export'].join('\n');
    const named = ['FROM node AS runner', 'FROM scratch AS export'].join('\n');
    const trailingCopy = '\nCOPY --from=builder /app/packages/clients/dist ./packages/clients/dist';

    expect(classifyRunnerStage(unnamed)).toBe('unnamed');
    expect(extractRunnerDistCopies(unnamed + trailingCopy)).toEqual(['packages/clients']);

    expect(classifyRunnerStage(named)).toBe('named-not-last');
    expect(extractRunnerDistCopies(named + trailingCopy)).toEqual([]);
  });

  it('anchors on the same line the classifier keyed on, across all three outcomes', () => {
    // classifyRunnerStage and findRunnerStageWindow each run their OWN
    // last-match scan over RUNNER_STAGE_PATTERN. That duplication is
    // deliberate (they are cheap and independent), but it is exactly the
    // drift shape this PR exists to remove — so pin the equivalence across
    // every outcome rather than the two shapes the test above happens to use.
    const copy = (pkg: string) => `COPY --from=builder /app/${pkg}/dist ./${pkg}/dist`;

    // named-last: the window is the runner stage, to end of file.
    const namedLast = [
      'FROM node AS builder',
      copy('packages/clients'),
      'FROM node AS runner',
      copy('packages/common-types'),
    ].join('\n');
    expect(classifyRunnerStage(namedLast)).toBe('named-last');
    expect(extractRunnerDistCopies(namedLast)).toEqual(['packages/common-types']);

    // named-not-last: the window STOPS at the following stage.
    const namedNotLast = [namedLast, 'FROM scratch AS export', copy('packages/embeddings')].join(
      '\n'
    );
    expect(classifyRunnerStage(namedNotLast)).toBe('named-not-last');
    expect(extractRunnerDistCopies(namedNotLast)).toEqual(['packages/common-types']);

    // unnamed: the window is the LAST stage, whatever it is called.
    const unnamed = namedNotLast.replace('AS runner', 'AS serve');
    expect(classifyRunnerStage(unnamed)).toBe('unnamed');
    expect(extractRunnerDistCopies(unnamed)).toEqual(['packages/embeddings']);
  });

  it('handles multiple runner stages WITH a further stage after the last one', () => {
    // The two directions are tested separately (last-runner-wins; window stops
    // at the next stage) but never together, and their interaction is where a
    // reduce-based last-match scan is easiest to get wrong.
    const dockerfile = [
      'FROM node AS runner',
      'COPY --from=builder /app/packages/clients/dist ./packages/clients/dist',
      'FROM node AS runner',
      'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
      'FROM scratch AS export',
      'COPY --from=builder /app/packages/embeddings/dist ./packages/embeddings/dist',
    ].join('\n');

    expect(classifyRunnerStage(dockerfile)).toBe('named-not-last');
    // The SECOND runner wins the anchor, and the export stage is excluded.
    expect(extractRunnerDistCopies(dockerfile)).toEqual(['packages/common-types']);
  });
});
