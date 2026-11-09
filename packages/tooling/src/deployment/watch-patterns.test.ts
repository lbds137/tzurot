import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

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

// `watch-patterns.ts` calls execFileSync with `encoding: 'utf-8'`, so the real
// return value is a string; execFileSync's overload set would otherwise force
// every mockReturnValue through a Buffer cast.
const mockExecFileSync = vi.mocked(execFileSync) as unknown as Mock<(...args: unknown[]) => string>;
const mockGetWatchPatterns = vi.mocked(getRailwayServiceWatchPatterns);
const mockResolveIds = vi.mocked(resolveRailwayIds);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const WEBSITE_DOCKERFILE_PATH = path.join(REPO_ROOT, 'services/website/Dockerfile');
const FIXTURE_DOCKERFILE_REL =
  'packages/tooling/src/deployment/__fixtures__/watch-check/Dockerfile';
const FIXTURE_DOCKERFILE_PATH = path.join(REPO_ROOT, FIXTURE_DOCKERFILE_REL);

const FIXTURE_WATCH_PATTERNS = [
  FIXTURE_DOCKERFILE_REL,
  '.dockerignore',
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

  it('skips COPY --from=builder even when combined with an unsupported flag (--parents)', () => {
    expect(parseDockerfileCopySources('COPY --from=builder --parents a ./')).toEqual([]);
  });

  it('strips --chown= and --chmod= flags while keeping source arguments', () => {
    const dockerfile = 'COPY --chown=node:node --chmod=0644 package.json pnpm-lock.yaml ./';

    expect(parseDockerfileCopySources(dockerfile)).toEqual(['package.json', 'pnpm-lock.yaml']);
  });

  it('accepts --link, --link=true, and --link=false flags on COPY instructions', () => {
    expect(parseDockerfileCopySources('COPY --link package.json ./')).toEqual(['package.json']);
    expect(parseDockerfileCopySources('COPY --link=true package.json ./')).toEqual([
      'package.json',
    ]);
    expect(parseDockerfileCopySources('COPY --link=false package.json ./')).toEqual([
      'package.json',
    ]);
  });

  it('throws UsageError naming the flag and line on unsupported COPY flags (--parents, --exclude=*.md, bare --chown)', () => {
    for (const [flag, line] of [
      ['--parents', 'COPY --parents docs/legal ./'],
      ['--exclude=*.md', 'COPY --exclude=*.md docs/legal ./docs/legal'],
      ['--chown', 'COPY --chown package.json ./'],
    ] as const) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(flag);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
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

  it('skips blank lines inside a backslash continuation (BuildKit behaviour)', () => {
    const runWithBlank = ['RUN foo \\', '', '  COPY x y', 'COPY a ./'].join('\n');
    expect(parseDockerfileCopySources(runWithBlank)).toEqual(['a']);

    const copyWithBlank = ['COPY a \\', '', '  b ./'].join('\n');
    expect(parseDockerfileCopySources(copyWithBlank)).toEqual(['a', 'b']);
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
    for (const line of ['RUN <<EOF', 'RUN cat <<EOF']) {
      const dockerfile = `${line}\nCOPY secret.txt ./\nEOF`;
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(dockerfile)).toThrow(line);
    }
  });

  it('throws UsageError naming the offending line on a heredoc RUN instruction without leading whitespace (RUN cat<<EOF)', () => {
    const line = 'RUN cat<<EOF';
    const dockerfile = `${line}\nCOPY secret.txt ./\nEOF`;
    expect(() => parseDockerfileCopySources(dockerfile)).toThrow(UsageError);
    expect(() => parseDockerfileCopySources(dockerfile)).toThrow(line);
  });

  it('allows arithmetic bit-shift in a RUN instruction without treating it as a heredoc', () => {
    expect(parseDockerfileCopySources('RUN echo $((1<<4))')).toEqual([]);
    expect(parseDockerfileCopySources('RUN echo $((x<<y))')).toEqual([]);
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
    for (const line of ['COPY <<EOF /app/config.json', 'COPY <<-"EOT" /x']) {
      expect(() => parseDockerfileCopySources(line)).toThrow(UsageError);
      expect(() => parseDockerfileCopySources(line)).toThrow(line);
    }
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

  it('does not credit <path>/** for a file source named <path>, while covering a directory source', () => {
    expect(
      uncoveredSources([{ path: 'docs/commands.md', isDir: false }], ['docs/commands.md/**'])
    ).toEqual(['docs/commands.md']);
    expect(uncoveredSources([{ path: 'docs/legal', isDir: true }], ['docs/legal/**'])).toEqual([]);
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

  it('classifies a watch pattern starting with # (after / strip) as uncredited', () => {
    expect(
      uncoveredSources(
        [
          { path: '#docs/commands.md', isDir: false },
          { path: '#docs/legal', isDir: true },
        ],
        ['#docs/commands.md', '/#docs/legal/**']
      )
    ).toEqual(['#docs/commands.md', '#docs/legal']);
  });

  it('classifies a watch pattern containing a backslash as uncredited', () => {
    expect(
      uncoveredSources(
        [
          { path: 'docs\\commands.md', isDir: false },
          { path: 'docs\\legal', isDir: true },
        ],
        ['docs\\commands.md', 'docs\\legal/**']
      )
    ).toEqual(['docs\\commands.md', 'docs\\legal']);
  });

  it('classifies a watch pattern with leading or trailing whitespace as uncredited', () => {
    expect(
      uncoveredSources(
        [
          { path: ' docs/commands.md', isDir: false },
          { path: 'docs/commands.md ', isDir: false },
          { path: ' docs/legal', isDir: true },
        ],
        [' docs/commands.md', 'docs/commands.md ', '/ docs/legal/**', 'docs/legal/** ']
      )
    ).toEqual([' docs/commands.md', 'docs/commands.md ', ' docs/legal']);
  });
});

describe('runWatchPatternCheck', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockResolveIds.mockReset();
    mockGetWatchPatterns.mockReset();
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'develop\n';
      }
      if (argv.includes('--short')) {
        return 'abc1234\n';
      }
      if (
        argv.includes('rev-parse') &&
        (argv.includes('HEAD') || argv.includes('origin/develop'))
      ) {
        return 'abc1234567890abcdef1234567890abcdef12345\n';
      }
      return '';
    });
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

  it('forwards args across execFileSync, resolveRailwayIds, and getRailwayServiceWatchPatterns and prints branch@sha and the Dockerfile path', async () => {
    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'git',
      ['-C', REPO_ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'git',
      ['-C', REPO_ROOT, 'rev-parse', '--short', 'HEAD'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      [
        '-C',
        REPO_ROOT,
        'status',
        '--porcelain',
        '-z',
        '--',
        FIXTURE_DOCKERFILE_REL,
        '.dockerignore',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'docs/legal',
        'docs/guides',
        'docs/commands.md',
      ],
      { encoding: 'utf-8' }
    );
    expect(mockResolveIds).toHaveBeenCalledWith('dev', 'tzurot-website');
    expect(mockGetWatchPatterns).toHaveBeenCalledWith({
      environmentId: 'env-dev',
      serviceId: 'svc-website',
      env: 'dev',
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('✅');
    expect(output).toContain(
      `All 8 image inputs (Dockerfile, .dockerignore files and COPY sources) are covered by tzurot-website watch patterns (dev) [develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('fails naming .dockerignore when root .dockerignore exists and no watch pattern covers it', async () => {
    mockGetWatchPatterns.mockResolvedValue([
      FIXTURE_DOCKERFILE_REL,
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
    ).rejects.toThrow(/1 image input\(s\) not covered.*\.dockerignore/);

    const errOutput = errorSpy.mock.calls.flat().map(String).join('\n');
    expect(errOutput).toContain(
      `❌ Uncovered image input: .dockerignore [develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`
    );
  });

  it('includes both <dockerfile>.dockerignore and root .dockerignore when both exist on disk', async () => {
    const perDockerfileIgnoreRel = `${FIXTURE_DOCKERFILE_REL}.dockerignore`;
    const perDockerfileIgnoreAbs = `${FIXTURE_DOCKERFILE_PATH}.dockerignore`;
    const rootIgnoreAbs = path.join(REPO_ROOT, '.dockerignore');
    vi.spyOn(fs, 'existsSync').mockImplementation(
      candidate => candidate === perDockerfileIgnoreAbs || candidate === rootIgnoreAbs
    );

    mockGetWatchPatterns.mockResolvedValue(FIXTURE_WATCH_PATTERNS);

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow(perDockerfileIgnoreRel);

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      [
        '-C',
        REPO_ROOT,
        'status',
        '--porcelain',
        '-z',
        '--',
        FIXTURE_DOCKERFILE_REL,
        perDockerfileIgnoreRel,
        '.dockerignore',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'docs/legal',
        'docs/guides',
        'docs/commands.md',
      ],
      { encoding: 'utf-8' }
    );

    logSpy.mockClear();
    errorSpy.mockClear();
    mockGetWatchPatterns.mockResolvedValue([...FIXTURE_WATCH_PATTERNS, perDockerfileIgnoreRel]);

    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain(
      `All 9 image inputs (Dockerfile, .dockerignore files and COPY sources) are covered by tzurot-website watch patterns (dev) [develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prints each uncovered source and branch@sha with the Dockerfile path and throws when a COPY source is missing from watchPatterns', async () => {
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
    expect(errOutput).toContain(`[develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`);
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

  it('prints an info line and throws when watchPatterns is empty ([] normalized from null API response)', async () => {
    mockGetWatchPatterns.mockResolvedValue([]);

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toThrow(
      "no watchPatterns configured for tzurot-website (dev); this guard cannot confirm Railway's every-push default, so it refuses to pass"
    );

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain(
      `ℹ️ No watchPatterns configured for tzurot-website (dev); Railway documents this as deploy-on-every-push (not verified by this guard) [develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('throws the uncommitted-changes UsageError (not "does not exist") when a COPY source is both dirty in git and missing on disk', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('COPY docs/dirty-and-missing/ ./\n');
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'develop\n';
      }
      if (argv.includes('--short')) {
        return 'abc1234\n';
      }
      return ' D docs/dirty-and-missing\0';
    });

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
    expect((caught as Error).message).toContain(
      'uncommitted changes in image inputs; commit or stash them so the check reads the tree that deploys: docs/dirty-and-missing'
    );
    expect((caught as Error).message).not.toContain('does not exist');
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      [
        '-C',
        REPO_ROOT,
        'status',
        '--porcelain',
        '-z',
        '--',
        FIXTURE_DOCKERFILE_REL,
        '.dockerignore',
        'docs/dirty-and-missing',
      ],
      { encoding: 'utf-8' }
    );
  });

  it('throws UsageError naming the dirty paths when git status --porcelain is non-empty and skips Railway calls', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'develop\n';
      }
      if (argv.includes('--short')) {
        return 'abc1234\n';
      }
      return ' M package.json\0?? docs/legal/PRIVACY_POLICY.md\0';
    });

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
    expect((caught as Error).message).toContain(
      'uncommitted changes in image inputs; commit or stash them so the check reads the tree that deploys'
    );
    expect((caught as Error).message).toContain('package.json');
    expect((caught as Error).message).toContain('docs/legal/PRIVACY_POLICY.md');
    expect(mockResolveIds).not.toHaveBeenCalled();
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });

  it('parses NUL-delimited git status --porcelain -z entries for a rename (reporting the new path and skipping the original path) and a path with a space', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'develop\n';
      }
      if (argv.includes('--short')) {
        return 'abc1234\n';
      }
      return 'R  docs/legal/NEW_POLICY.md\0docs/legal/OLD_POLICY.md\0 M docs/guides/guide with space.md\0';
    });

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
    expect((caught as Error).message).toBe(
      'uncommitted changes in image inputs; commit or stash them so the check reads the tree that deploys: docs/legal/NEW_POLICY.md, docs/guides/guide with space.md'
    );
    expect((caught as Error).message).not.toContain('OLD_POLICY.md');
  });

  it('passes on prod when HEAD equals origin/develop and forwards rev-parse argv across execFileSync', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'develop\n';
      }
      if (argv.includes('--short')) {
        return 'abc1234\n';
      }
      if (argv.includes('status')) {
        return '';
      }
      if (argv[argv.length - 1] === 'HEAD') {
        return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
      }
      if (argv[argv.length - 1] === 'origin/develop') {
        return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
      }
      if (argv[argv.length - 1] === 'origin/main') {
        throw new Error('fatal: Needed a single revision');
      }
      return '';
    });

    await runWatchPatternCheck({
      env: 'prod',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      4,
      'git',
      ['-C', REPO_ROOT, 'rev-parse', 'HEAD'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      5,
      'git',
      ['-C', REPO_ROOT, 'rev-parse', '--verify', '--quiet', 'origin/develop'],
      { encoding: 'utf-8' }
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      6,
      'git',
      ['-C', REPO_ROOT, 'rev-parse', '--verify', '--quiet', 'origin/main'],
      { encoding: 'utf-8' }
    );
  });

  it('passes on prod when HEAD equals origin/main', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'main\n';
      }
      if (argv.includes('--short')) {
        return 'cafebab\n';
      }
      if (argv.includes('status')) {
        return '';
      }
      if (argv[argv.length - 1] === 'HEAD') {
        return 'cafebabecafebabecafebabecafebabecafebabe\n';
      }
      if (argv[argv.length - 1] === 'origin/develop') {
        return '1111111111111111111111111111111111111111\n';
      }
      if (argv[argv.length - 1] === 'origin/main') {
        return 'cafebabecafebabecafebabecafebabecafebabe\n';
      }
      return '';
    });

    await runWatchPatternCheck({
      env: 'prod',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('✅');
  });

  it('throws UsageError on prod when HEAD equals neither origin/develop nor origin/main', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'feat/local\n';
      }
      if (argv.includes('--short')) {
        return '9999999\n';
      }
      if (argv.includes('status')) {
        return '';
      }
      if (argv[argv.length - 1] === 'HEAD') {
        return '9999999999999999999999999999999999999999\n';
      }
      if (argv[argv.length - 1] === 'origin/develop') {
        return '1111111111111111111111111111111111111111\n';
      }
      if (argv[argv.length - 1] === 'origin/main') {
        throw new Error('fatal: Needed a single revision');
      }
      return '';
    });

    let caught: unknown;
    try {
      await runWatchPatternCheck({
        env: 'prod',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toBe(
      'a prod check must run on a checkout of origin/develop (pre-release) or origin/main; fetch and fast-forward first'
    );
    expect(mockResolveIds).not.toHaveBeenCalled();
    expect(mockGetWatchPatterns).not.toHaveBeenCalled();
  });

  it('passes on dev even when HEAD equals neither origin/develop nor origin/main', async () => {
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argv = args as string[];
      if (argv.includes('--abbrev-ref')) {
        return 'feat/local\n';
      }
      if (argv.includes('--short')) {
        return '9999999\n';
      }
      if (argv.includes('status')) {
        return '';
      }
      if (argv[argv.length - 1] === 'HEAD') {
        return '9999999999999999999999999999999999999999\n';
      }
      return '1111111111111111111111111111111111111111\n';
    });

    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: FIXTURE_DOCKERFILE_REL,
    });

    expect(mockExecFileSync).toHaveBeenCalledTimes(3);
    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain('✅');
  });

  it('refuses an absolute --dockerfile path with UsageError before reading from disk', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const promise = runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: '/etc/Dockerfile',
    });

    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toThrow('/etc/Dockerfile');
    expect(readSpy).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('refuses a parent-escaping --dockerfile path (../x/Dockerfile) with UsageError before reading from disk', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const promise = runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: '../x/Dockerfile',
    });

    await expect(promise).rejects.toBeInstanceOf(UsageError);
    await expect(promise).rejects.toThrow('../x/Dockerfile');
    expect(readSpy).not.toHaveBeenCalled();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('normalizes a repo-relative --dockerfile path (./...) for the Dockerfile input entry', async () => {
    await runWatchPatternCheck({
      env: 'dev',
      service: 'tzurot-website',
      dockerfile: `./${FIXTURE_DOCKERFILE_REL}`,
    });

    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      'git',
      expect.arrayContaining([FIXTURE_DOCKERFILE_REL]),
      { encoding: 'utf-8' }
    );
    const output = logSpy.mock.calls.flat().map(String).join('\n');
    expect(output).toContain(`[develop@abc1234 ${FIXTURE_DOCKERFILE_REL}]`);
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

  it('rethrows a non-ENOENT error (EACCES) from statSync unchanged', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied, stat'), { code: 'EACCES' });
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw eacces;
    });

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toBe(eacces);
  });

  it('rethrows a non-ENOENT error (EACCES) from Dockerfile readFileSync unchanged', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw eacces;
    });

    await expect(
      runWatchPatternCheck({
        env: 'dev',
        service: 'tzurot-website',
        dockerfile: FIXTURE_DOCKERFILE_REL,
      })
    ).rejects.toBe(eacces);
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
