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

const PARSER_DIRECTIVE_PATTERN = /^#\s*(?:escape|syntax)\s*=/i;
const UNSUPPORTED_LITERAL_CHARS = /[*?[\]{}!]/;

type ClassifiedWatchPattern =
  | { kind: 'all' }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'exact-file'; path: string }
  | { kind: 'uncredited'; raw: string };

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
  if (/["'\\]/.test(source)) {
    throw new UsageError(
      `Unsupported quote or backslash in Dockerfile COPY source "${source}": ${rawLine}`
    );
  }
  if (source.startsWith('/')) {
    throw new UsageError(`Unsupported absolute Dockerfile COPY source "${source}": ${rawLine}`);
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

/** Split a raw line on a trailing line-continuation backslash. */
function splitContinuation(rawLine: string): { continues: boolean; body: string } {
  const rtrimmed = rawLine.trimEnd();
  if (rtrimmed.endsWith('\\')) {
    return { continues: true, body: rtrimmed.slice(0, -1).trim() };
  }
  return { continues: false, body: rawLine.trim() };
}

/** Consume one line while a continuation is pending; returns the new pending text. */
function continueLogicalLine(pending: string, rawLine: string, out: string[]): string | null {
  if (rawLine.trim().startsWith('#')) {
    return pending;
  }
  const { continues, body } = splitContinuation(rawLine);
  const joined = body.length > 0 ? `${pending} ${body}` : pending;
  if (continues) {
    return joined;
  }
  out.push(joined.trim());
  return null;
}

function assertNotParserDirective(trimmedComment: string): void {
  if (PARSER_DIRECTIVE_PATTERN.test(trimmedComment)) {
    throw new UsageError(`Unsupported Dockerfile parser directive: ${trimmedComment}`);
  }
}

function joinLogicalLines(text: string): string[] {
  const logicalLines: string[] = [];
  let pending: string | null = null;
  let seenInstruction = false;

  for (const rawLine of text.split(/\r?\n/)) {
    if (pending !== null) {
      pending = continueLogicalLine(pending, rawLine, logicalLines);
      continue;
    }

    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed.startsWith('#')) {
      if (!seenInstruction) {
        assertNotParserDirective(trimmed);
      }
      continue;
    }

    seenInstruction = true;
    const { continues, body } = splitContinuation(rawLine);
    if (continues) {
      pending = body;
    } else {
      logicalLines.push(trimmed);
    }
  }

  if (pending !== null && pending.length > 0) {
    logicalLines.push(pending.trim());
  }

  return logicalLines;
}

function parseInstructionLine(rawLine: string): string[] {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return [];
  }

  if (trimmed.includes('<<')) {
    throw new UsageError(`Unsupported heredoc instruction in Dockerfile: ${trimmed}`);
  }

  const tokens = trimmed.split(/\s+/);
  const instruction = tokens[0]?.toUpperCase();
  if (instruction === 'ADD' || instruction === 'ONBUILD') {
    throw new UsageError(`Unsupported ${instruction} instruction in Dockerfile: ${trimmed}`);
  }
  if (instruction !== 'COPY') {
    return [];
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
 * Physical lines ending with `\` are joined into logical lines first (dropping
 * comment lines inside a continuation), `--flag=value` tokens (`--chown=`,
 * `--chmod=`) are stripped, comment lines are ignored, and all remaining
 * tokens on each `COPY` instruction except the final destination argument are
 * returned in order. Throws `UsageError` on Dockerfile or `COPY` shapes this
 * parser refuses (`# escape=` / `# syntax=` directives, heredocs, `ADD` /
 * `ONBUILD` instructions, JSON-array form, or glob, variable, quote,
 * backslash, absolute, or dot-path sources).
 */
export function parseDockerfileCopySources(text: string): string[] {
  return joinLogicalLines(text).flatMap(logicalLine => parseInstructionLine(logicalLine));
}

function classifyWatchPattern(rawPattern: string): ClassifiedWatchPattern {
  const normalized = rawPattern.startsWith('/') ? rawPattern.slice(1) : rawPattern;
  if (normalized === '**') {
    return { kind: 'all' };
  }
  if (normalized.endsWith('/**')) {
    const lit = normalized.slice(0, -3);
    if (lit.length > 0 && !lit.endsWith('/') && !UNSUPPORTED_LITERAL_CHARS.test(lit)) {
      return { kind: 'prefix', prefix: lit };
    }
    return { kind: 'uncredited', raw: rawPattern };
  }
  if (
    normalized.length > 0 &&
    !normalized.endsWith('/') &&
    !UNSUPPORTED_LITERAL_CHARS.test(normalized)
  ) {
    return { kind: 'exact-file', path: normalized };
  }
  return { kind: 'uncredited', raw: rawPattern };
}

function isSourceCoveredByPattern(
  cleanPath: string,
  isDir: boolean,
  pattern: ClassifiedWatchPattern
): boolean {
  switch (pattern.kind) {
    case 'all':
      return true;
    case 'prefix':
      return cleanPath === pattern.prefix || cleanPath.startsWith(`${pattern.prefix}/`);
    case 'exact-file':
      return !isDir && cleanPath === pattern.path;
    case 'uncredited':
      return false;
  }
}

function uncreditedWatchPatterns(patterns: string[]): string[] {
  return patterns.flatMap(rawPattern => {
    const classified = classifyWatchPattern(rawPattern);
    return classified.kind === 'uncredited' ? [classified.raw] : [];
  });
}

/**
 * Return the repo-relative image inputs not matched by any credited watch
 * pattern.
 *
 * Throws `UsageError` if any watch pattern starts with `!`. Strips one leading
 * `/` from each pattern before classifying it into one of three credited
 * shapes:
 * - `**` covers any file or directory source.
 * - `<lit>/**` (where `<lit>` contains none of `* ? [ ] { } !`) covers any
 *   file or directory source whose path equals `<lit>` or starts with
 *   `<lit>/` (dotfiles included).
 * - `<lit>` (with none of `* ? [ ] { } !` and no trailing `/`) covers a file
 *   source whose path equals `<lit>` exactly (not credited for directories).
 *
 * Every other pattern shape covers nothing. Railway documents watch paths as
 * gitignore-style patterns (`docs.railway.com/deployments/monorepo#watch-paths`);
 * that gitignore equivalence is from Railway's docs, not probed against
 * Railway (not verified).
 */
export function uncoveredSources(sources: CopySource[], patterns: string[]): string[] {
  const negated = patterns.filter(pattern => pattern.startsWith('!'));
  if (negated.length > 0) {
    throw new UsageError(
      `Unsupported watch pattern(s) ${negated.join(', ')}: negated watch patterns are not supported by this guard`
    );
  }

  const classifiedPatterns = patterns.map(pattern => classifyWatchPattern(pattern));
  const uncovered: string[] = [];

  for (const source of sources) {
    const cleanPath = stripTrailingSlash(source.path);
    const isCovered = classifiedPatterns.some(pattern =>
      isSourceCoveredByPattern(cleanPath, source.isDir, pattern)
    );
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
 * the Dockerfile itself or any `COPY` source is uncovered.
 */
export async function runWatchPatternCheck(options: WatchPatternCheckOptions): Promise<void> {
  const cleanDockerfile = stripTrailingSlash(options.dockerfile);
  const dockerfilePath = path.resolve(DEFAULT_REPO_ROOT, cleanDockerfile);
  let dockerfileText: string;
  try {
    dockerfileText = fs.readFileSync(dockerfilePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UsageError(`Dockerfile "${cleanDockerfile}" does not exist (${dockerfilePath})`);
    }
    throw error;
  }
  const rawSources = parseDockerfileCopySources(dockerfileText);

  const sources: CopySource[] = [
    { path: cleanDockerfile, isDir: false },
    ...rawSources.map(sourcePath => statCopySource(DEFAULT_REPO_ROOT, sourcePath)),
  ];

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
      console.error(chalk.red(`❌ Uncovered image input: ${missing} [${dockerfilePath}]`));
    }
    const uncredited = uncreditedWatchPatterns(patterns);
    if (uncredited.length > 0) {
      console.error(
        chalk.yellow(
          `⚠️ ${uncredited.length} patterns in shapes this guard does not credit: ${uncredited.join(', ')}; supported: \`**\`, \`<path>/**\`, exact file path`
        )
      );
    }
    throw new Error(
      `${uncovered.length} image input(s) not covered by ${options.service} watch patterns (${options.env}) [${dockerfilePath}]: ${uncovered.join(', ')}`
    );
  }

  console.log(
    chalk.green(
      `✅ All ${sources.length} image inputs (Dockerfile + COPY sources) are covered by ${options.service} watch patterns (${options.env}) [${dockerfilePath}]`
    )
  );
}
