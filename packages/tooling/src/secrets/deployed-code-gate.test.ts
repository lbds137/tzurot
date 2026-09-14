import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('../deployment/railway-api.js', () => ({ getLiveDeploymentCommit: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { getLiveDeploymentCommit } from '../deployment/railway-api.js';
import { checkDeployedCodeAcceptsPrevious } from './deployed-code-gate.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockGetLiveDeploymentCommit = vi.mocked(getLiveDeploymentCommit);

const KNOWN_COMMIT = 'db783ced15f2efe99cbf1e13bf89d51e03e52203';

/**
 * Git's wildcard-pathspec rule, as probed against this repo rather than
 * assumed: a pathspec containing a wildcard is matched against the WHOLE path,
 * and the wildcard spans "/". So a spec ending at the "src" segment matches
 * only a path that ends there — no file — while the same spec plus a trailing
 * file segment matches every file beneath it.
 *
 * Probe that established this (token known present in service source):
 *   git grep -q INTERNAL_SERVICE_SECRET HEAD -- 'services/<star>/src'    -> exit 1
 *   git grep -q INTERNAL_SERVICE_SECRET HEAD -- 'services/<star>/src/<star>' -> exit 0
 *
 * The earlier hand-rolled approximation here (prefix-startsWith plus
 * suffix-includes) reported a match for BOTH forms, so it passed while the
 * shipped pathspec matched nothing in real git. This models the real rule.
 *
 * `:/` is a git pathspec MAGIC SIGIL (top-level anchoring), not part of the
 * path — strip it before matching, the same way real git strips magic before
 * comparing against tracked paths.
 */
function pathspecMatches(spec: string, path: string): boolean {
  const withoutMagic = spec.startsWith(':/') ? spec.slice(2) : spec;
  const pattern = withoutMagic
    .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('*', '.*');
  return new RegExp(`^${pattern}$`).test(path);
}

/**
 * Simulate `git cat-file -e` and `git grep -q <token> <sha> -- <pathspecs>`
 * over a fake commit whose only file carrying the token is the one named by
 * `tokenPath`. `git grep` exits non-zero (throws, under execFileSync) when
 * nothing matches, so the simulation throws in that case.
 *
 * The pathspec filter is applied with `pathspecMatches` above: a call carrying
 * no pathspec matches every path, which is exactly the vacuous-pass the gate's
 * pathspec prevents.
 */
function fakeGit(options: { knownCommit: string; tokenPath: string | undefined }) {
  return (_cmd: string, argv: readonly string[]): string => {
    if (argv[0] === 'cat-file') {
      if (!String(argv[2]).startsWith(options.knownCommit)) {
        throw new Error('fatal: Not a valid object name');
      }
      return '';
    }
    if (argv[0] === 'grep') {
      const sepIndex = argv.indexOf('--');
      const pathspecs = sepIndex === -1 ? [] : argv.slice(sepIndex + 1);
      const candidate = options.tokenPath;
      if (candidate === undefined) {
        throw new Error('no match');
      }
      const inScope =
        pathspecs.length === 0 || pathspecs.some(spec => pathspecMatches(spec, candidate));
      if (!inScope) {
        throw new Error('no match');
      }
      return '';
    }
    throw new Error(`unexpected git argv: ${argv.join(' ')}`);
  };
}

describe('checkDeployedCodeAcceptsPrevious', () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockGetLiveDeploymentCommit.mockReset();
    mockGetLiveDeploymentCommit.mockResolvedValue(KNOWN_COMMIT);
  });

  it('passes when the deployed commit carries the token in service source', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    const result = await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    expect(result).toEqual({ ok: true, commit: KNOWN_COMMIT });
  });

  it('a commit where only a tracker file carries the token does not pass', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'tracker/tasks/task-976 - Dual-secret-acceptance-for-INTERNAL_SERVICE_SECRET.md',
      }) as unknown as typeof execFileSync
    );

    const result = await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('services/*/src');
  });

  it('refuses when the deployed commit is not in this clone', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: 'some-other-commit',
        tokenPath: undefined,
      }) as unknown as typeof execFileSync
    );

    const result = await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('git fetch origin');
  });

  it('refuses when the live deployment cannot be read', async () => {
    mockGetLiveDeploymentCommit.mockRejectedValue(new Error('network unreachable'));

    const result = await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('network unreachable');
  });

  it('refuses when no source file carries the token', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({ knownCommit: KNOWN_COMMIT, tokenPath: undefined }) as unknown as typeof execFileSync
    );

    const result = await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    expect(result.ok).toBe(false);
  });

  it('looks for <name>_PREVIOUS derived from the rotated name', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    const grepCall = mockExecFileSync.mock.calls.find(call => call[1]?.[0] === 'grep');
    expect(grepCall).toBeDefined();
    expect(grepCall?.[1]).toContain('INTERNAL_SERVICE_SECRET_PREVIOUS');
  });

  // Without `-F`, git treats the token as a basic regular expression. The
  // registry has one entry today, but it's designed to grow, so this pins the
  // flag rather than relying on today's single name having no metacharacters.
  it('passes -F to git immediately before the pattern', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    const grepCall = mockExecFileSync.mock.calls.find(call => call[1]?.[0] === 'grep');
    const argv = grepCall?.[1] as string[];
    const patternIndex = argv.indexOf('INTERNAL_SERVICE_SECRET_PREVIOUS');
    expect(patternIndex).toBeGreaterThan(0);
    expect(argv[patternIndex - 1]).toBe('-F');
  });

  // Proves `-F` is load-bearing rather than decorative: a name containing a
  // regex metacharacter must reach git as a literal pattern, unescaped by our
  // own code — we delegate literal matching to git via `-F`, not hand-rolled
  // escaping.
  it('passes a metacharacter-bearing token through to git verbatim as the pattern', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'A.C',
      env: 'dev',
    });

    const grepCall = mockExecFileSync.mock.calls.find(call => call[1]?.[0] === 'grep');
    const argv = grepCall?.[1] as string[];
    expect(argv).toContain('A.C_PREVIOUS');
    expect(argv.indexOf('A.C_PREVIOUS')).toBe(argv.indexOf('-F') + 1);
  });

  // A pathspec too narrow to match anything makes the gate refuse every stage 1
  // while still looking correct — the failure mode is silent, so it gets its
  // own assertion rather than riding on the pass case above.
  it('the configured pathspecs match a real source path in both services and packages', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    const grepCall = mockExecFileSync.mock.calls.find(call => call[1]?.[0] === 'grep');
    const argv = grepCall?.[1] as string[];
    const pathspecs = argv.slice(argv.indexOf('--') + 1);

    expect(
      pathspecs.some(spec =>
        pathspecMatches(spec, 'services/api-gateway/src/services/AuthMiddleware.ts')
      )
    ).toBe(true);
    expect(
      pathspecs.some(spec =>
        pathspecMatches(spec, 'packages/tooling/src/secrets/rotate-env-stages.ts')
      )
    ).toBe(true);
    // …and still not a tracker file, which is the whole point of scoping.
    expect(
      pathspecs.some(spec => pathspecMatches(spec, 'tracker/tasks/task-976 - Dual-secret.md'))
    ).toBe(false);
  });

  // A pathspec without the `:/` top-level magic is resolved relative to the
  // CURRENT DIRECTORY, not the repo root (probe recorded on `SOURCE_PATHSPECS`
  // in `deployed-code-gate.ts`), and `pnpm ops` resolves from any subdirectory
  // of the checkout, so every configured pathspec carries the anchor rather
  // than rely on the caller's cwd. Dropping it reddens this case by name, distinct from
  // the "match a real source path" case above (which is cwd-agnostic in this
  // simulation and would keep passing even without the anchor).
  it('every configured pathspec is anchored to the repo root', async () => {
    mockExecFileSync.mockImplementation(
      fakeGit({
        knownCommit: KNOWN_COMMIT,
        tokenPath: 'services/api-gateway/src/services/AuthMiddleware.ts',
      }) as unknown as typeof execFileSync
    );

    await checkDeployedCodeAcceptsPrevious({
      environmentId: 'env-1',
      serviceId: 'svc-gateway',
      serviceName: 'api-gateway',
      name: 'INTERNAL_SERVICE_SECRET',
      env: 'dev',
    });

    const grepCall = mockExecFileSync.mock.calls.find(call => call[1]?.[0] === 'grep');
    const argv = grepCall?.[1] as string[];
    const pathspecs = argv.slice(argv.indexOf('--') + 1);

    expect(pathspecs.length).toBeGreaterThan(0);
    for (const spec of pathspecs) {
      expect(spec.startsWith(':/')).toBe(true);
    }
  });
});
