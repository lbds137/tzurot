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
  const PKG_JSON: Record<string, object> = {
    'packages/common-types/package.json': { name: '@tzurot/common-types', dependencies: {} },
    'services/bot-client/package.json': {
      name: '@tzurot/bot-client',
      dependencies: { '@tzurot/common-types': 'workspace:*' },
    },
  };

  const IN_SYNC_DOCKERFILE = [
    'FROM node:25-slim AS runner',
    'COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist',
    'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
  ].join('\n');

  let logSpy: ReturnType<typeof vi.spyOn>;
  let savedExitCode: typeof process.exitCode;

  /** Wire the fs mocks to present the fake workspace above */
  function mockWorkspace(options: { dockerfile?: string | null } = {}) {
    const dockerfile = options.dockerfile === undefined ? IN_SYNC_DOCKERFILE : options.dockerfile;

    vi.mocked(readdirSync).mockImplementation(dir => {
      if (String(dir).endsWith('packages')) {
        return ['common-types'] as never;
      }
      return ['bot-client'] as never;
    });
    vi.mocked(existsSync).mockImplementation(path => {
      const p = String(path);
      if (p.endsWith('package.json')) {
        return Object.keys(PKG_JSON).some(key => p.endsWith(key));
      }
      // Dockerfile existence
      return dockerfile !== null;
    });
    vi.mocked(readFileSync).mockImplementation(path => {
      const p = String(path);
      const pkgKey = Object.keys(PKG_JSON).find(key => p.endsWith(key));
      if (pkgKey !== undefined) {
        return JSON.stringify(PKG_JSON[pkgKey]);
      }
      return dockerfile ?? '';
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

  it('passes (no exit code) when runner copies match the dependency closure', async () => {
    mockWorkspace();

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Checked 1 service Dockerfile(s)');
    expect(output).toContain('All runner-stage dist copies match');
  });

  it('sets exit code 1 and reports MISSING when a dep COPY is absent', async () => {
    mockWorkspace({
      dockerfile: [
        'FROM node:25-slim AS runner',
        'COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist',
      ].join('\n'),
    });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist();

    expect(process.exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('packages/common-types/dist');
    expect(output).toContain('1 dist-copy issue');
  });

  it('skips services without a Dockerfile and logs the skip in verbose mode', async () => {
    mockWorkspace({ dockerfile: null });

    const { checkDockerfileDist } = await import('./check-dockerfile-dist.js');
    await checkDockerfileDist({ verbose: true });

    expect(process.exitCode).toBeUndefined();
    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Checked 0 service Dockerfile(s)');
    expect(output).toContain('no Dockerfile, skipped');
  });
});
