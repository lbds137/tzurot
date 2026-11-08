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

const WEBSITE_WATCH_PATTERNS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'services/website/**',
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

  it('extracts the exact expected sources from the real services/website/Dockerfile', () => {
    const dockerfileText = fs.readFileSync(WEBSITE_DOCKERFILE_PATH, 'utf-8');

    expect(parseDockerfileCopySources(dockerfileText)).toEqual([
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'services/website',
      'docs/legal',
      'docs/guides',
      'docs/commands.md',
      'services/website/nginx.conf.template',
    ]);
  });

  it('throws UsageError naming the offending line on a trailing backslash continuation', () => {
    const line = 'COPY package.json \\';
    expect(() => parseDockerfileCopySources(`${line}\n  pnpm-lock.yaml ./`)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(`${line}\n  pnpm-lock.yaml ./`)).toThrow(line);
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

  it('marks a directory source as uncovered when the pattern only matches *.md files', () => {
    expect(uncoveredSources([{ path: 'docs/legal', isDir: true }], ['docs/legal/*.md'])).toEqual([
      'docs/legal',
    ]);
  });

  it('marks a directory source with nested content as uncovered when the pattern is only one level deep (dir/*)', () => {
    expect(uncoveredSources([{ path: 'docs/guides', isDir: true }], ['docs/guides/*'])).toEqual([
      'docs/guides',
    ]);
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
    mockGetWatchPatterns.mockResolvedValue(WEBSITE_WATCH_PATTERNS);
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
      dockerfile: 'services/website/Dockerfile',
    });

    expect(mockResolveIds).toHaveBeenCalledWith('dev', 'tzurot-website');
    expect(mockGetWatchPatterns).toHaveBeenCalledWith({
      environmentId: 'env-dev',
      serviceId: 'svc-website',
      env: 'dev',
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('✅');
    expect(output).toContain('All 8 Dockerfile COPY sources');
    expect(output).toContain(WEBSITE_DOCKERFILE_PATH);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prints each uncovered source and the Dockerfile path and throws when a COPY source is missing from watchPatterns', async () => {
    mockResolveIds.mockReturnValue({
      projectId: 'proj-1',
      environmentId: 'env-prod',
      serviceId: 'svc-website-prod',
    });
    mockGetWatchPatterns.mockResolvedValue([
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'services/website/**',
      'docs/legal/**',
    ]);

    await expect(
      runWatchPatternCheck({
        env: 'prod',
        service: 'tzurot-website',
        dockerfile: 'services/website/Dockerfile',
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
    expect(errOutput).toContain(WEBSITE_DOCKERFILE_PATH);
  });

  it('succeeds and prints an info line when watchPatterns is empty ([])', async () => {
    mockGetWatchPatterns.mockResolvedValue([]);

    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: 'services/website/Dockerfile',
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('No watchPatterns configured for tzurot-website (dev)');
    expect(output).toContain('every push deploys');
    expect(output).toContain(WEBSITE_DOCKERFILE_PATH);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('throws UsageError naming the missing source when statSync fails with ENOENT', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('COPY docs/does-not-exist-anywhere.md ./\n');

    let caught: unknown;
    try {
      await runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: 'services/website/Dockerfile',
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
        dockerfile: 'services/website/Dockerfile',
      })
    ).rejects.toThrow('resolved without a service id');
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });
});
