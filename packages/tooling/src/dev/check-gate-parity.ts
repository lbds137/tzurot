/**
 * Gate-parity guard: the local `pnpm quality` chain and the CI lint job are
 * two separately-maintained lists of the same checks. When they drift, a
 * check passes locally and fails in CI (or worse, a gate exists only
 * locally and a violation merges through a PR whose author never ran it).
 *
 * This guard parses both lists and hard-fails when a command exists on one
 * side without either existing on the other side or being covered by an
 * explicit, justified allowlist entry. Binary sync-check (like
 * guard:duplicate-exports) — not an audit-class tool.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Setup/plumbing tokens that are not quality gates on either side. */
const SETUP_TOKENS = new Set(['install', '--filter', 'prisma', 'run']);

/**
 * Checks that run ONLY in CI, each with the reason local execution is not
 * required. Adding an entry here is a deliberate decision — the reason
 * column is mandatory.
 */
export const CI_ONLY: Record<string, string> = {
  'test:generate-schema':
    'pglite-schema sync check needs a dummy DATABASE_URL + fresh prisma client; ' +
    'locally the pre-commit hook regenerates the schema whenever schema.prisma changes',
  xray:
    'the unjustified-suppressions fail-grep lives in a CI shell wrapper; ' +
    'xray itself has no threshold mode yet (follow-up tracked in backlog)',
};

/**
 * Checks that run ONLY locally, each with the reason CI does not need them.
 */
export const LOCAL_ONLY: Record<string, string> = {
  typecheck:
    'CI compiles every package with tsc in the build steps of each job, ' +
    'which covers production type errors; typecheck:spec (test types) runs on both sides',
};

/** Normalize a command line to its canonical gate token. */
export function normalizeCommand(line: string): string | null {
  const trimmed = line.trim();
  const prefix = /^(?:pnpm|npx)\s+/.exec(trimmed);
  if (!prefix) return null;
  let rest = trimmed.slice(prefix[0].length).trim();
  if (rest.startsWith('run ')) rest = rest.slice(4);
  if (rest.startsWith('ops ')) rest = rest.slice(4);
  const token = rest.split(/\s+/)[0];
  if (token === undefined || token.length === 0) return null;
  return token;
}

/**
 * Extract canonical gate tokens from the CI lint job. Only lines that START
 * with pnpm/npx count — mid-line mentions (echo strings, error-message text
 * inside run blocks) are not executed commands.
 */
export function extractCiLintTokens(ciYamlContent: string): Set<string> {
  const jobBlock = /^ {2}lint:\n([\s\S]*?)(?=^ {2}[a-z][a-z-]*:\s*$)/m.exec(ciYamlContent);
  const block = jobBlock ? jobBlock[1] : ciYamlContent;
  const tokens = new Set<string>();
  for (const rawLine of block.split('\n')) {
    let line = rawLine.trim().replace(/^run:\s*/, '');
    // See through `VAR=$( ... )` command substitutions and leading env-var
    // assignments (`NO_COLOR=1 pnpm ...`) — those still execute the command.
    line = line.replace(/^[A-Z_]+=\$\(\s*/, '').replace(/^(?:[A-Z_]+=\S+\s+)+/, '');
    if (!/^(?:pnpm|npx)\s/.test(line)) continue;
    const token = normalizeCommand(line);
    if (token !== null && !SETUP_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

/** Extract canonical gate tokens from the root package.json quality chain. */
export function extractQualityTokens(packageJsonContent: string): Set<string> {
  const pkg = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
  const quality = pkg.scripts?.quality;
  if (quality === undefined) return new Set();
  const tokens = new Set<string>();
  for (const segment of quality.split('&&')) {
    const token = normalizeCommand(segment);
    if (token !== null && !SETUP_TOKENS.has(token)) tokens.add(token);
  }
  return tokens;
}

export interface GateParityViolations {
  /** In CI's lint job but neither in quality nor CI_ONLY-allowlisted. */
  ciOnly: string[];
  /** In quality but neither in CI's lint job nor LOCAL_ONLY-allowlisted. */
  localOnly: string[];
  /**
   * Allowlist entries that no longer describe an asymmetry: the token either
   * vanished from its own side (rot) or now exists on BOTH sides (parity was
   * achieved and the entry is redundant).
   */
  staleAllowlist: string[];
}

export function findGateParityViolations(
  ciTokens: Set<string>,
  qualityTokens: Set<string>
): GateParityViolations {
  const ciOnly = [...ciTokens].filter(t => !qualityTokens.has(t) && !(t in CI_ONLY)).sort();
  const localOnly = [...qualityTokens].filter(t => !ciTokens.has(t) && !(t in LOCAL_ONLY)).sort();
  const staleAllowlist = [
    ...Object.keys(CI_ONLY).filter(t => !ciTokens.has(t) || qualityTokens.has(t)),
    ...Object.keys(LOCAL_ONLY).filter(t => !qualityTokens.has(t) || ciTokens.has(t)),
  ].sort();
  return { ciOnly, localOnly, staleAllowlist };
}

export interface CheckGateParityOptions {
  rootDir?: string;
}

export function checkGateParity(options: CheckGateParityOptions = {}): void {
  const root = options.rootDir ?? process.cwd();
  const ciYaml = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const packageJson = readFileSync(path.join(root, 'package.json'), 'utf8');

  const ciTokens = extractCiLintTokens(ciYaml);
  const qualityTokens = extractQualityTokens(packageJson);
  const violations = findGateParityViolations(ciTokens, qualityTokens);

  console.log(
    `🔍 Gate parity: ${ciTokens.size} CI lint-job checks vs ${qualityTokens.size} quality-chain checks...`
  );

  const clean =
    violations.ciOnly.length === 0 &&
    violations.localOnly.length === 0 &&
    violations.staleAllowlist.length === 0;

  if (clean) {
    console.log('✅ Local quality chain and CI lint job are in sync (allowlists honored).');
    return;
  }

  if (violations.ciOnly.length > 0) {
    console.error('\n❌ In CI lint job but MISSING from `pnpm quality`:');
    for (const t of violations.ciOnly) console.error(`   - ${t}`);
    console.error(
      '   Add to the quality chain in package.json, or add a justified CI_ONLY entry in check-gate-parity.ts.'
    );
  }
  if (violations.localOnly.length > 0) {
    console.error('\n❌ In `pnpm quality` but MISSING from the CI lint job:');
    for (const t of violations.localOnly) console.error(`   - ${t}`);
    console.error(
      '   Add a step to .github/workflows/ci.yml lint job, or add a justified LOCAL_ONLY entry in check-gate-parity.ts.'
    );
  }
  if (violations.staleAllowlist.length > 0) {
    console.error('\n❌ Stale allowlist entries (token no longer present on its side):');
    for (const t of violations.staleAllowlist) console.error(`   - ${t}`);
    console.error('   Remove the entry from CI_ONLY / LOCAL_ONLY in check-gate-parity.ts.');
  }
  process.exitCode = 1;
}
