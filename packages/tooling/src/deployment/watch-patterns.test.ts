import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./railway-api.js', () => ({
  getRailwayServiceWatchPatterns: vi.fn(),
}));

vi.mock('./railway-status.js', () => ({
  resolveRailwayIds: vi.fn(),
}));

import { UsageError } from '../utils/errors.js';
import { getRailwayServiceWatchPatterns } from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';
import {
  parseDockerfileCopySources,
  uncoveredSources,
  runWatchPatternCheck,
} from './watch-patterns.js';

const mockGetWatchPatterns = vi.mocked(getRailwayServiceWatchPatterns);
const mockResolveIds = vi.mocked(resolveRailwayIds);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WEBSITE_DOCKERFILE_PATH = path.join(REPO_ROOT, 'services/website/Dockerfile');
const FIXTURE_DOCKERFILE_REL =
  'packages/tooling/src/deployment/__fixtures__/watch-check/Dockerfile';
const FIXTURE_DOCKERFILE_PATH = path.join(REPO_ROOT, FIXTURE_DOCKERFILE_REL);

const FIXTURE_WATCH_PATTERNS = [
  FIXTURE_DOCKERFILE_REL,
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'docs/legal/**',
  'docs/guides/**',
  'docs/commands.md',
];

describe('parseDockerfileCopySources', () => {
  it('parses a single source COPY instruction', () => {
    expect(parseDockerfileCopySources('COPY docs/commands.md ./docs/commands.md')).toEqual([
      'docs/commands.md',
    ]);
  });

  it('parses multiple sources from a single COPY instruction', () => {
    expect(parseDockerfileCopySources('COPY a b c ./')).toEqual(['a', 'b', 'c']);
  });

  it('skips COPY instructions with --from= stage flags', () => {
    const dockerfile = [
      'COPY package.json ./',
      'COPY --from=builder /app/services/website/dist ./services/website/dist',
    ].join('\n');

    expect(parseDockerfileCopySources(dockerfile)).toEqual(['package.json']);
  });

  it('strips --chown= and --chmod= flags while keeping source arguments', () => {
    const dockerfile = 'COPY --chown=node:node --chmod=0644 package.json pnpm-lock.yaml ./';

    expect(parseDockerfileCopySources(dockerfile)).toEqual(['package.json', 'pnpm-lock.yaml']);
  });

  it('ignores comment lines and non-COPY instructions', () => {
    const dockerfile = [
      '# COPY ignored/comment ./ignored',
      '  # COPY indented/comment ./ignored',
      'FROM node:24-slim AS builder',
      'WORKDIR /app',
      'COPY docs/legal ./docs/legal',
    ].join('\n');

    expect(parseDockerfileCopySources(dockerfile)).toEqual(['docs/legal']);
  });

  it('extracts the exact expected sources from the fixture Dockerfile', () => {
    const dockerfileText = fs.readFileSync(FIXTURE_DOCKERFILE_PATH, 'utf-8');

    expect(parseDockerfileCopySources(dockerfileText)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'docs/legal',
      'docs/guides',
      'docs/commands.md',
    ]);
  });

  it('parses the real services/website/Dockerfile without throwing and includes docs/legal', () => {
    const dockerfileText = fs.readFileSync(WEBSITE_DOCKERFILE_PATH, 'utf-8');

    expect(parseDockerfileCopySources(dockerfileText)).toContain('docs/legal');
  });

  it('joins a backslash-continued COPY instruction across lines and drops continuation comments', () => {
    const dockerfile = [
      'COPY package.json \\',
      '  # comment inside continuation',
      '  pnpm-lock.yaml ./',
    ].join('\n');

    expect(parseDockerfileCopySources(dockerfile)).toEqual(['package.json', 'pnpm-lock.yaml']);
  });

  it('ignores a backslash-continued RUN body that starts a continuation line with COPY', () => {
    const dockerfile = ['RUN echo \\', '  COPY a b'].join('\n');

    expect(parseDockerfileCopySources(dockerfile)).toEqual([]);
  });

  it('parses a CRLF-delimited Dockerfile including backslash continuations', () => {
    const dockerfile = [
      'FROM node:24-slim',
      'COPY package.json \\',
      '  pnpm-lock.yaml ./',
      'COPY docs/commands.md ./docs/commands.md',
    ].join('\r\n');

    expect(parseDockerfileCopySources(dockerfile)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'docs/commands.md',
    ]);
  });

  it('parses a lowercase copy instruction', () => {
    expect(parseDockerfileCopySources('copy docs/commands.md ./docs/commands.md')).toEqual([
      'docs/commands.md',
    ]);
  });

  it('throws UsageError naming the offending line on an # escape= parser directive', () => {
    for (const directive of ['# escape=`', '# ESCAPE = \\']) {
      const dockerfile = `${directive}\nFROM node:24-slim\nCOPY package.json ./`;
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(directive);
    }
  });

  it('throws UsageError naming the offending line on a # syntax= parser directive', () => {
    for (const directive of ['# syntax=docker/dockerfile:1', '# SYNTAX = foo']) {
      const dockerfile = `${directive}\nFROM node:24-slim\nCOPY package.json ./`;
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(directive);
    }
  });

  it('throws UsageError naming the offending line on a heredoc RUN instruction', () => {
    const line = 'RUN <<EOF';
    const dockerfile = `${line}\nCOPY secret.txt ./\nEOF`;
    expect(() => parseDockerfileCopySources(dockerfile)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(dockerfile)).toThrow(line);
  });

  it('throws UsageError naming the offending line on an ADD instruction', () => {
    for (const line of ['ADD package.json ./', 'add docs/legal ./docs/legal']) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
  });

  it('throws UsageError naming the offending line on an ONBUILD instruction', () => {
    for (const line of ['ONBUILD COPY package.json ./', 'onbuild RUN echo hi']) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
  });

  it('throws UsageError naming the offending line on a JSON-array COPY instruction', () => {
    const line = 'COPY --chown=node:node ["package.json", "./"]';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line on a heredoc COPY instruction', () => {
    const line = 'COPY <<EOF /app/config.json';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source contains *', () => {
    const line = 'COPY packages/*/package.json ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source contains ?', () => {
    const line = 'COPY docs/file?.md ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source contains [', () => {
    const line = 'COPY docs/part[0-9].md ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source contains $', () => {
    const line = 'COPY $SRC_DIR/config.json ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source is quoted', () => {
    for (const line of ['COPY "package.json" ./', "COPY 'package.json' ./"]) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
  });

  it('throws UsageError naming the offending line when a source contains a backslash', () => {
    const line = 'COPY docs\\legal ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source is an absolute path', () => {
    const line = 'COPY /etc/passwd ./';
    expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(line)).toThrow(line);
  });

  it('throws UsageError naming the offending line when a source is . or ./', () => {
    for (const line of ['COPY . ./', 'COPY ./ /app/']) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
  });

  it('throws UsageError naming the offending line when a source has a path segment starting with .', () => {
    for (const line of ['COPY .env ./', 'COPY docs/.hidden/guide.md ./docs/']) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
  });
});

describe('uncoveredSources', () => {
  it('marks a directory source as covered by dir/** and strips a trailing slash', () => {
    expect(
      uncoveredSources(
        [
          { path: 'docs/legal', isDir: true },
          { path: 'docs/guides/', isDir: true },
        ],
        ['docs/legal/**', 'docs/guides/**']
      )
    ).toEqual([]);
  });

  it('marks a directory source as covered by a parent docs/** pattern', () => {
    expect(uncoveredSources([{ path: 'docs/legal', isDir: true }], ['docs/**'])).toEqual([]);
  });

  it('does not credit a prefix pattern without a slash boundary (docs/leg/** does not cover docs/legal)', () => {
    expect(uncoveredSources([{ path: 'docs/legal', isDir: true }], ['docs/leg/**'])).toEqual([
      'docs/legal',
    ]);
  });

  it('marks a dotfile source under a directory (d/.hidden) as covered by d/**', () => {
    expect(uncoveredSources([{ path: 'd/.hidden', isDir: false }], ['d/**'])).toEqual([]);
  });

  it('marks a source as uncovered when watch patterns are uncredited wildcard probes (d/_* and d/_*/_*)', () => {
    expect(
      uncoveredSources(
        [
          { path: 'd', isDir: true },
          { path: 'd/_file', isDir: false },
        ],
        ['d/_*', 'd/_*/_*']
      )
    ).toEqual(['d', 'd/_file']);
  });

  it('marks a source as uncovered when the pattern is a single-level wildcard (d/*)', () => {
    expect(
      uncoveredSources(
        [
          { path: 'd', isDir: true },
          { path: 'd/file.txt', isDir: false },
        ],
        ['d/*']
      )
    ).toEqual(['d', 'd/file.txt']);
  });

  it('marks a source as uncovered when the pattern uses brace expansion ({…})', () => {
    expect(
      uncoveredSources(
        [
          { path: 'd', isDir: true },
          { path: 'd/x', isDir: false },
        ],
        ['d/{__probe__,x}', 'd/{a,b}/**']
      )
    ).toEqual(['d', 'd/x']);
  });

  it('marks a directory source as uncovered when the pattern only matches *.md files', () => {
    expect(uncoveredSources([{ path: 'docs/legal', isDir: true }], ['docs/legal/*.md'])).toEqual([
      'docs/legal',
    ]);
  });

  it('credits an exact literal pattern for a file source of that name and not a directory of that name', () => {
    expect(
      uncoveredSources(
        [
          { path: 'docs/commands.md', isDir: false },
          { path: 'docs/legal', isDir: true },
        ],
        ['docs/commands.md', 'docs/legal']
      )
    ).toEqual(['docs/legal']);
  });

  it('marks all file and directory sources as covered by **', () => {
    expect(
      uncoveredSources(
        [
          { path: 'package.json', isDir: false },
          { path: 'docs/legal', isDir: true },
          { path: 'd/.hidden', isDir: false },
        ],
        ['**']
      )
    ).toEqual([]);
  });

  it('strips one leading slash from each watch pattern before matching', () => {
    expect(
      uncoveredSources(
        [
          { path: 'docs/guides', isDir: true },
          { path: 'docs/commands.md', isDir: false },
        ],
        ['/docs/guides/**', '/docs/commands.md']
      )
    ).toEqual([]);
  });

  it('throws UsageError naming negated watch patterns starting with !', () => {
    expect(() =>
      uncoveredSources(
        [{ path: 'docs/guides', isDir: true }],
        ['docs/guides/**', '!docs/guides/internal/**']
      )
    ).toThrow(UsageError);
    expect(() =>
      uncoveredSources(
        [{ path: 'docs/guides', isDir: true }],
        ['docs/guides/**', '!docs/guides/internal/**']
      )
    ).toThrow(
      /!docs\/guides\/internal\/\*\*.*negated watch patterns are not supported by this guard/
    );
  });

  it('marks a file source as covered by an exact pattern or enclosing glob', () => {
    expect(
      uncoveredSources(
        [
          { path: 'package.json', isDir: false },
          { path: 'services/website/nginx.conf.template', isDir: false },
        ],
        ['package.json', 'services/website/**']
      )
    ).toEqual([]);
  });

  it('reports only the missing sources when some sources are uncovered', () => {
    expect(
      uncoveredSources(
        [
          { path: 'package.json', isDir: false },
          { path: 'docs/guides', isDir: true },
          { path: 'docs/commands.md', isDir: false },
        ],
        ['package.json']
      )
    ).toEqual(['docs/guides', 'docs/commands.md']);
  });
});

describe('runWatchPatternCheck', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockResolveIds.mockReset();
    mockGetWatchPatterns.mockReset();
    mockResolveIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-dev',
      serviceId: 'svc-website',
    });
    mockGetWatchPatterns.mockResolvedValue(FIXTURE_WATCH_PATTERNS);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards args across resolveRailwayIds and getRailwayServiceWatchPatterns and prints the covered count and Dockerfile path', async () => {
    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    expect(mockResolveIds).toHaveBeenCalledWith('dev', 'tzurot-website');
    expect(mockGetWatchPatterns).toHaveBeenCalledWith({
      environmentId: 'env-dev',
      serviceId: 'svc-website',
      env: 'dev',
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('✅');
    expect(output).toContain(
      `All 7 image inputs (Dockerfile + COPY sources) are covered by tzurot-website watch patterns (dev) [${FIXTURE_DOCKERFILE_PATH}]`
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prints each uncovered source and the Dockerfile path and throws when a COPY source is missing from watchPatterns', async () => {
    mockResolveIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-prod',
      serviceId: 'svc-website-prod',
    });
    mockGetWatchPatterns.mockResolvedValue([
      FIXTURE_DOCKERFILE_REL,
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'docs/legal/**',
    ]);

    await expect(
      runWatchPatternCheck({
        env: 'prod',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow(/docs\/guides.*docs\/commands\.md/);

    expect(mockResolveIds).toHaveBeenCalledWith('prod', 'tzurot-website');
    expect(mockGetWatchPatterns).toHaveBeenCalledWith({
      environmentId: 'env-prod',
      serviceId: 'svc-website-prod',
      env: 'prod',
    });

    const errOutput = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(errOutput).toContain('docs/guides');
    expect(errOutput).toContain('docs/commands.md');
    expect(errOutput).toContain(FIXTURE_DOCKERFILE_PATH);
  });

  it('prints the uncredited-shape diagnostic line when uncredited watch patterns exist and the check fails', async () => {
    mockGetWatchPatterns.mockResolvedValue([
      FIXTURE_DOCKERFILE_REL,
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'docs/legal/**',
      'docs/guides/*',
      'docs/{commands,other}.md',
    ]);

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow(/docs\/guides.*docs\/commands\.md/);

    const errOutput = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(errOutput).toContain(
      'patterns in shapes this guard does not credit: docs/guides/*, docs/{commands,other}.md; supported: `**`, `<path>/**`, exact file path'
    );
  });

  it('fails naming the Dockerfile path when all COPY sources are covered but the Dockerfile itself is uncovered', async () => {
    mockGetWatchPatterns.mockResolvedValue([
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'docs/legal/**',
      'docs/guides/**',
      'docs/commands.md',
    ]);

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow(FIXTURE_DOCKERFILE_REL);

    const errOutput = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(errOutput).toContain(FIXTURE_DOCKERFILE_REL);
  });

  it('throws UsageError naming the resolved path when --dockerfile is missing on disk', async () => {
    const missingRel = 'packages/tooling/src/deployment/__fixtures__/watch-check/NoSuchDockerfile';
    const expectedResolved = path.join(REPO_ROOT, missingRel);

    let caught: unknown;
    try {
      await runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: missingRel,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain(expectedResolved);
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });

  it('succeeds and prints an info line when watchPatterns is empty ([] normalized from null API response)', async () => {
    mockGetWatchPatterns.mockResolvedValue([]);

    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('No watchPatterns configured for tzurot-website (dev)');
    expect(output).toContain('every push deploys');
    expect(output).toContain(FIXTURE_DOCKERFILE_PATH);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('throws UsageError naming the missing source when statSync fails with ENOENT', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('COPY docs/does-not-exist-anywhere.md ./\n');

    let caught: unknown;
    try {
      await runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toContain('docs/does-not-exist-anywhere.md');
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });

  it('throws when resolveRailwayIds returns no serviceId', async () => {
    mockResolveIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-dev',
    });

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow('resolved without a service id');
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });
});
