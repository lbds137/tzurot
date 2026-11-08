/**
 * Drift guard comparing a Dockerfile's repo-relative `COPY` sources against a
 * Railway service's configured `watchPatterns` via the public GraphQL API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

import { UsageError } from '../utils/errors.js';
import { getRailwayServiceWatchPatterns, type RailwayEnv } from './railway-api.js';
import { resolveRailwayIds } from './railway-status.js';

export interface CopySource {
  path: string;
  isDir: boolean;
}

export interface WatchPatternCheckOptions {
  env: RailwayEnv;
  service: string;
  dockerfile: string;
}

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function stripTrailingSlash(sourcePath: string): string {
  let cleaned = sourcePath;
  while (cleaned.length > 1 && cleaned.endsWith('/')) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

function validateCopySourceToken(source: string, rawLine: string): void {
  if (/[*?[$]/.test(source)) {
    throw new UsageError(
      `Unsupported wildcard or variable in Dockerfile COPY source "${source}": ${rawLine}`
    );
  }
  const cleanSource = stripTrailingSlash(source);
  if (
    source === '.' ||
    source === './' ||
    cleanSource.split('/').some(segment => segment.startsWith('.'))
  ) {
    throw new UsageError(
      `Unsupported dot-path Dockerfile COPY source "${source}" (not matched by "**"): ${rawLine}`
    );
  }
}

function parseCopyLine(rawLine: string): string[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return [];
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens[0]?.toUpperCase() !== 'COPY') {
    return [];
  }

  if (trimmed.endsWith('\\')) {
    throw new UsageError(`Unsupported multiline COPY continuation in Dockerfile: ${trimmed}`);
  }

  if (trimmed.includes('<<')) {
    throw new UsageError(`Unsupported heredoc COPY instruction in Dockerfile: ${trimmed}`);
  }

  const args = tokens.slice(1);
  if (args.some(token => token.startsWith('--from='))) {
    return [];
  }

  const positional = args.filter(token => !token.startsWith('--'));
  if (positional[0]?.startsWith('[')) {
    throw new UsageError(`Unsupported JSON-array COPY instruction in Dockerfile: ${trimmed}`);
  }

  if (positional.length < 2) {
    throw new UsageError(`Malformed COPY instruction in Dockerfile: ${trimmed}`);
  }

  const copySources = positional.slice(0, -1);
  for (const source of copySources) {
    validateCopySourceToken(source, trimmed);
  }
  return copySources;
}

/**
 * Extract repo-relative source paths from every `COPY` instruction in `text`
 * that does not carry a `--from=` stage flag.
 *
 * Other `--flag=value` tokens (`--chown=`, `--chmod=`) are dropped, comment
 * lines are ignored, and all remaining tokens except the final destination
 * argument are returned in order. Throws `UsageError` on COPY shapes this
 * line-oriented parser does not support (line continuations, JSON-array form,
 * heredocs, glob/variable tokens, or `.` / dotfile sources).
 */
export function parseDockerfileCopySources(text: string): string[] {
  return text.split('\n').flatMap(rawLine => parseCopyLine(rawLine));
}

/**
 * Return the repo-relative `COPY` sources not matched by any watch pattern.
 *
 * Throws `UsageError` if any watch pattern starts with `!`. Strips one leading
 * `/` from each pattern before matching. A file source is covered when some
 * pattern matches its path via `path.matchesGlob`; a directory source is
 * covered only when some pattern matches `<dir>/__probe__` and some pattern
 * matches `<dir>/__probe__/__probe__` (two levels deep, so `dir/*` does not
 * cover nested content). Trailing slashes on source paths are stripped first.
 */
export function uncoveredSources(sources: CopySource[], patterns: string[]): string[] {
  const negated = patterns.filter(pattern => pattern.startsWith('!'));
  if (negated.length > 0) {
    throw new UsageError(
      `Unsupported watch pattern(s) ${negated.join(', ')}: negated watch patterns are not supported by this guard`
    );
  }

  const normalizedPatterns = patterns.map(pattern =>
    pattern.startsWith('/') ? pattern.slice(1) : pattern
  );
  const uncovered: string[] = [];

  for (const source of sources) {
    const cleanPath = stripTrailingSlash(source.path);
    const isCovered = source.isDir
      ? normalizedPatterns.some(pattern => path.matchesGlob(`${cleanPath}/__probe__`, pattern)) &&
        normalizedPatterns.some(pattern =>
          path.matchesGlob(`${cleanPath}/__probe__/__probe__`, pattern)
        )
      : normalizedPatterns.some(pattern => path.matchesGlob(cleanPath, pattern));
    if (!isCovered) {
      uncovered.push(cleanPath);
    }
  }

  return uncovered;
}

function statCopySource(repoRoot: string, sourcePath: string): CopySource {
  const cleanPath = stripTrailingSlash(sourcePath);
  const resolvedSourcePath = path.resolve(repoRoot, cleanPath);
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(resolvedSourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  if (stat === undefined) {
    throw new UsageError(
      `Dockerfile COPY source "${cleanPath}" does not exist (${resolvedSourcePath})`
    );
  }
  return { path: cleanPath, isDir: stat.isDirectory() };
}

/**
 * Parse `options.dockerfile`, stat each `COPY` source from the repo root, fetch
 * the live `watchPatterns` for `options.service` in `options.env`, and throw if
 * any source is uncovered.
 */
export async function runWatchPatternCheck(options: WatchPatternCheckOptions): Promise<void> {
  const dockerfilePath = path.resolve(DEFAULT_REPO_ROOT, options.dockerfile);
  const dockerfileText = fs.readFileSync(dockerfilePath, 'utf-8');
  const rawSources = parseDockerfileCopySources(dockerfileText);

  const sources: CopySource[] = rawSources.map(sourcePath =>
    statCopySource(DEFAULT_REPO_ROOT, sourcePath)
  );

  const { environmentId, serviceId } = resolveRailwayIds(options.env, options.service);
  if (serviceId === undefined) {
    throw new Error(
      `Railway service "${options.service}" resolved without a service id (${options.env})`
    );
  }

  const patterns = await getRailwayServiceWatchPatterns({
    environmentId,
    serviceId,
    env: options.env,
  });

  // Empty `watchPatterns` (`[]` or `null`) means every push deploys
  // (Railway's documented default; not probed here, not verified).
  if (patterns.length === 0) {
    console.log(
      chalk.cyan(
        `ℹ️ No watchPatterns configured for ${options.service} (${options.env}) — every push deploys [${dockerfilePath}]`
      )
    );
    return;
  }

  const uncovered = uncoveredSources(sources, patterns);
  if (uncovered.length > 0) {
    for (const missing of uncovered) {
      console.error(
        chalk.red(`❌ Uncovered Dockerfile COPY source: ${missing} [${dockerfilePath}]`)
      );
    }
    throw new Error(
      `${uncovered.length} Dockerfile COPY source(s) not covered by ${options.service} watch patterns (${options.env}) [${dockerfilePath}]: ${uncovered.join(', ')}`
    );
  }

  console.log(
    chalk.green(
      `✅ All ${sources.length} Dockerfile COPY sources are covered by ${options.service} watch patterns (${options.env}) [${dockerfilePath}]`
    )
  );
}
