/**
 * Drift guard comparing a Dockerfile's repo-relative `COPY` sources against a
 * Railway service's configured `watchPatterns` via the public GraphQL API.
 */

import { execFileSync } from 'node:child_process';
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
const HEREDOC_PATTERN = /<<-?\s*["']?[A-Za-z_]/;
const ALLOWED_COPY_FLAG_PATTERN = /^--(?:chown=.+|chmod=.+|link(?:=(?:true|false))?)$/;
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
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
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

  const withoutArithmetic = trimmed.replace(/\$\(\([^)]*\)\)/g, '');
  if (HEREDOC_PATTERN.test(withoutArithmetic)) {
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

  for (const token of args) {
    if (token.startsWith('--') && !ALLOWED_COPY_FLAG_PATTERN.test(token)) {
      throw new UsageError(`Unsupported COPY flag "${token}" in Dockerfile: ${trimmed}`);
    }
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
 * blank and comment lines inside a continuation), accepted `COPY` flags
 * (`--chown=…`, `--chmod=…`, `--link`, `--link=true|false`) are stripped,
 * comment lines are ignored, and all remaining tokens on each `COPY`
 * instruction except the final destination argument are returned in order.
 * Throws `UsageError` on Dockerfile or `COPY` shapes this parser refuses
 * (`# escape=` / `# syntax=` directives, heredocs, `ADD` / `ONBUILD`
 * instructions, unsupported `COPY` `--` flags such as `--parents` or
 * `--exclude=…`, JSON-array form, or glob, variable, quote, backslash,
 * absolute, or dot-path sources).
 */
export function parseDockerfileCopySources(text: string): string[] {
  return joinLogicalLines(text).flatMap(logicalLine => parseInstructionLine(logicalLine));
}

function classifyWatchPattern(rawPattern: string): ClassifiedWatchPattern {
  const normalized = rawPattern.startsWith('/') ? rawPattern.slice(1) : rawPattern;
  if (
    rawPattern !== rawPattern.trim() ||
    normalized !== normalized.trim() ||
    normalized.startsWith('#') ||
    normalized.includes('\\')
  ) {
    return { kind: 'uncredited', raw: rawPattern };
  }
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
      return (isDir && cleanPath === pattern.prefix) || cleanPath.startsWith(`${pattern.prefix}/`);
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
 * - `<lit>/**` (where `<lit>` contains none of `* ? [ ] { } !`) covers a
 *   directory source equal to `<lit>`, and any source under `<lit>/`
 *   (dotfiles included).
 * - `<lit>` (with none of `* ? [ ] { } !` and no trailing `/`) covers a file
 *   source whose path equals `<lit>` exactly (not credited for directories).
 *
 * Patterns starting with `#`, containing `\`, or having leading or trailing
 * whitespace (before or after the `/` strip) are classified `uncredited`, as is
 * every other pattern shape. Railway documents watch paths as gitignore-style
 * patterns (`docs.railway.com/deployments/monorepo#watch-paths`); that
 * gitignore equivalence is from Railway's docs, not probed against Railway (not
 * verified).
 */
export function uncoveredSources(sources: CopySource[], patterns: string[]): string[] {
  const negated = patterns.filter(pattern => pattern.startsWith('!'));
  if (negated.length > 0) {
    throw new UsageError(
      `Unsupported watch pattern(s) ${negated.join(', ')}: negated watch patterns are not supported by this guard`
    );
  }

  const classifiedPatterns = patterns.map(pattern => classifyWatchPattern(pattern));
  return sources.flatMap(source => {
    const cleanPath = stripTrailingSlash(source.path);
    const isCovered = classifiedPatterns.some(pattern =>
      isSourceCoveredByPattern(cleanPath, source.isDir, pattern)
    );
    return isCovered ? [] : [cleanPath];
  });
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

function resolveDockerfilePath(
  repoRoot: string,
  rawDockerfile: string
): { cleanDockerfile: string; dockerfilePath: string } {
  const stripped = stripTrailingSlash(rawDockerfile.trim());
  if (path.isAbsolute(stripped)) {
    throw new UsageError(
      `--dockerfile "${rawDockerfile}" must be a repo-relative path inside the repository`
    );
  }
  const dockerfilePath = path.resolve(repoRoot, stripped);
  const cleanDockerfile = path.relative(repoRoot, dockerfilePath);
  if (
    cleanDockerfile.length === 0 ||
    cleanDockerfile === '..' ||
    cleanDockerfile.startsWith('../')
  ) {
    throw new UsageError(
      `--dockerfile "${rawDockerfile}" must resolve inside the repository (${repoRoot})`
    );
  }
  return { cleanDockerfile, dockerfilePath };
}

function gitInRepo(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' });
}

function parseDirtyPaths(porcelainOutput: string): string[] {
  const fields = porcelainOutput.split('\0');
  const dirtyPaths: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i] ?? '';
    if (entry.length > 0) {
      const match = /^([MADRCU?! ]{1,2}) (.*)$/s.exec(entry);
      dirtyPaths.push(match ? match[2] : entry);
      if (match && /[RC]/.test(match[1])) {
        i += 1;
      }
    }
  }
  return dirtyPaths;
}

function verifyGitProvenance(repoRoot: string, imageInputPaths: string[]): string {
  const branch = gitInRepo(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const sha = gitInRepo(repoRoot, ['rev-parse', '--short', 'HEAD']).trim();
  const statusOutput = gitInRepo(repoRoot, [
    'status',
    '--porcelain',
    '-z',
    '--',
    ...imageInputPaths,
  ]);
  const dirtyPaths = parseDirtyPaths(statusOutput);
  if (dirtyPaths.length > 0) {
    throw new UsageError(
      `uncommitted changes in image inputs; commit or stash them so the check reads the tree that deploys: ${dirtyPaths.join(', ')}`
    );
  }
  return `${branch}@${sha}`;
}

function readQuietRefSha(repoRoot: string, ref: string): string | null {
  try {
    const sha = gitInRepo(repoRoot, ['rev-parse', '--verify', '--quiet', ref]).trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

function verifyProdPublishedTree(repoRoot: string): void {
  const headSha = gitInRepo(repoRoot, ['rev-parse', 'HEAD']).trim();
  const originDevelopSha = readQuietRefSha(repoRoot, 'origin/develop');
  const originMainSha = readQuietRefSha(repoRoot, 'origin/main');
  if (headSha.length === 0 || (headSha !== originDevelopSha && headSha !== originMainSha)) {
    throw new UsageError(
      'a prod check must run on a checkout of origin/develop (pre-release) or origin/main; fetch and fast-forward first'
    );
  }
}

function collectDockerignorePaths(repoRoot: string, cleanDockerfile: string): string[] {
  return [`${cleanDockerfile}.dockerignore`, '.dockerignore'].filter(relPath =>
    fs.existsSync(path.resolve(repoRoot, relPath))
  );
}

/**
 * Parse `options.dockerfile` (whose Docker build context must be the repo
 * root), collect existing `.dockerignore` files (`<dockerfile>.dockerignore`
 * and `<repoRoot>/.dockerignore`), verify the image inputs have no uncommitted
 * changes in git (and for `prod`, that `HEAD` matches `origin/develop` or
 * `origin/main`), stat each `COPY` source from the repo root, fetch the live
 * `watchPatterns` for `options.service` in `options.env`, and throw if any
 * image input is uncovered.
 */
export async function runWatchPatternCheck(options: WatchPatternCheckOptions): Promise<void> {
  const { cleanDockerfile, dockerfilePath } = resolveDockerfilePath(
    DEFAULT_REPO_ROOT,
    options.dockerfile
  );
  let dockerfileText: string;
  try {
    dockerfileText = fs.readFileSync(dockerfilePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UsageError(`Dockerfile "${cleanDockerfile}" does not exist (${dockerfilePath})`);
    }
    throw error;
  }
  const dockerignorePaths = collectDockerignorePaths(DEFAULT_REPO_ROOT, cleanDockerfile);
  const rawSources = parseDockerfileCopySources(dockerfileText);
  const cleanSourcePaths = rawSources.map(sourcePath => stripTrailingSlash(sourcePath));

  const gitRef = verifyGitProvenance(DEFAULT_REPO_ROOT, [
    cleanDockerfile,
    ...dockerignorePaths,
    ...cleanSourcePaths,
  ]);
  if (options.env === 'prod') {
    verifyProdPublishedTree(DEFAULT_REPO_ROOT);
  }
  const provenance = `${gitRef} ${cleanDockerfile}`;

  const sources: CopySource[] = [
    { path: cleanDockerfile, isDir: false },
    ...dockerignorePaths.map(ignorePath => ({ path: ignorePath, isDir: false })),
    ...cleanSourcePaths.map(sourcePath => statCopySource(DEFAULT_REPO_ROOT, sourcePath)),
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

  // Empty `watchPatterns` (`[]` or `null`) is Railway's documented every-push
  // default (not verified); fail closed because no pattern list is present.
  if (patterns.length === 0) {
    console.log(
      chalk.cyan(
        `ℹ️ No watchPatterns configured for ${options.service} (${options.env}); Railway documents this as deploy-on-every-push (not verified by this guard) [${provenance}]`
      )
    );
    throw new Error(
      `no watchPatterns configured for ${options.service} (${options.env}); this guard cannot confirm Railway's every-push default, so it refuses to pass`
    );
  }

  const uncovered = uncoveredSources(sources, patterns);
  if (uncovered.length > 0) {
    for (const missing of uncovered) {
      console.error(chalk.red(`❌ Uncovered image input: ${missing} [${provenance}]`));
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
      `${uncovered.length} image input(s) not covered by ${options.service} watch patterns (${options.env}) [${provenance}]: ${uncovered.join(', ')}`
    );
  }

  console.log(
    chalk.green(
      `✅ All ${sources.length} image inputs (Dockerfile, .dockerignore files and COPY sources) are covered by ${options.service} watch patterns (${options.env}) [${provenance}]`
    )
  );
}
