/**
 * Dockerfile dist-COPY Guard
 *
 * Each service Dockerfile's final (runner) stage copies workspace-package
 * `dist` dirs MANUALLY — one COPY line per runtime `@tzurot/*` dependency.
 * `turbo prune` handles sources and node_modules automatically, but the
 * runner-stage dist copies are hand-maintained: a package extraction that
 * adds a new runtime dep without its COPY line ships an image that crashes
 * at startup with ERR_MODULE_NOT_FOUND, and standard CI never builds the
 * Docker image, so nothing catches it before deploy.
 *
 * This guard statically cross-checks each service Dockerfile's runner-stage
 * COPY set against the TRANSITIVE workspace prod-dependency closure from
 * package.json (transitive because e.g. @tzurot/clients itself imports
 * @tzurot/common-types at runtime — direct-deps-only would both miss needed
 * copies and false-flag legitimate ones as stale). No Docker build needed.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

interface CheckOptions {
  verbose?: boolean;
}

/** @internal Exported for testing */
export interface WorkspacePackage {
  /** Repo-relative dir, e.g. 'packages/common-types' */
  dir: string;
  /** Prod `@tzurot/*` dependency names */
  workspaceDeps: string[];
}

/** @internal Exported for testing */
export interface DistCopyFinding {
  service: string;
  kind: 'missing-copy' | 'stale-copy' | 'runner-anchor';
  /**
   * Repo-relative package dir the finding is about — the dependency whose
   * `dist` is missing or stale. Absent on `runner-anchor` findings, which are
   * about the Dockerfile's stage STRUCTURE and identify no package; carrying
   * the service's own dir there would just restate `service` in path form.
   */
  packageDir?: string;
  detail: string;
}

const SEPARATOR = chalk.cyan.bold('═══════════════════════════════════════════════════════');

/** Workspace groups that can host `@tzurot/*` packages */
const WORKSPACE_GROUPS = ['packages', 'services'];

/**
 * Matches a runner-stage dist COPY, capturing the repo-relative package dir:
 *   COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
 *
 * Assumes single-line, multi-stage COPY instructions: backslash-continuation
 * COPYs and stage-less `COPY <src> <dest>` forms (no `--from=`) are not
 * matched. Both are outside the project's Dockerfile style — every service
 * uses turbo-prune multi-stage builds with short single-line copies.
 */
const DIST_COPY_PATTERN =
  /^\s*COPY\s+--from=\S+\s+\/app\/((?:packages|services)\/[^/\s]+)\/dist(?:[/\s]|$)/;

/** Matches any Dockerfile stage start, e.g. `FROM node:25-slim AS runner` */
const STAGE_START_PATTERN = /^\s*FROM\s/i;

/**
 * Matches a stage named exactly `runner` — case-insensitively, e.g.
 * `FROM node:25-slim AS runner`. The `i` flag is needed for the legitimate
 * `as`/`AS` keyword variance and necessarily extends to the stage name too,
 * so `AS Runner` also anchors here even though Docker's own `--from=` stage
 * references are case-sensitive. Harmless: no Dockerfile here mixes case.
 *
 * The trailing `\s*$` is load-bearing, not tidiness. A `\b` terminator would
 * also match names that merely BEGIN with `runner` (`AS runner-debug`,
 * `AS runner.arm64`), since the word/non-word transition is itself a
 * boundary — and because findRunnerStageWindow anchors on the LAST match, a
 * `runner-debug` stage placed after the real runner would silently become
 * the scan window. That is precisely the false negative this anchoring
 * exists to prevent. Dockerfiles have no inline-comment syntax, so anchoring
 * at end-of-line is safe; trailing whitespace and a lowercase `as` still match.
 *
 * Assumes the image reference is a single token — a flag-bearing form
 * (`FROM --platform=$BUILDPLATFORM node AS runner`) does NOT match, and the
 * caller then falls back to last-`FROM` anchoring. That fallback is the
 * pre-existing behaviour, so the miss degrades rather than breaks; the flag
 * form is not used by any service Dockerfile here. Same disclosure style as
 * DIST_COPY_PATTERN above.
 */
const RUNNER_STAGE_PATTERN = /^\s*FROM\s+\S+\s+AS\s+runner\s*$/i;

/**
 * Parse a package.json, failing loudly WITH path context — a bare
 * SyntaxError doesn't say which package.json is malformed.
 */
function readPackageJson(pkgJsonPath: string): {
  name?: string;
  dependencies?: Record<string, string>;
} {
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as {
      name?: string;
      dependencies?: Record<string, string>;
    };
  } catch (error) {
    throw new Error(
      `Failed to parse ${pkgJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

/**
 * Scan packages/* and services/* for package.json files and build a map of
 * package name → { dir, workspaceDeps }.
 *
 * Reads `dependencies` only — the project convention declares workspace deps
 * as `workspace:*` prod dependencies. A `@tzurot/*` package declared via
 * peerDependencies would not be seen by this guard.
 *
 * @internal Exported for testing
 */
export function loadWorkspacePackages(rootDir: string): Map<string, WorkspacePackage> {
  const result = new Map<string, WorkspacePackage>();

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = join(rootDir, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Entries aren't filtered to directories on purpose: a stray file in
      // packages/ or services/ yields a non-existent package.json path and
      // falls through this existsSync guard — silent skip is the intent.
      const pkgJsonPath = join(groupDir, entry, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        continue;
      }

      const parsed = readPackageJson(pkgJsonPath);
      if (parsed.name === undefined) {
        continue;
      }

      // NOTE: only reads `dependencies` — a workspace peerDependency would
      // not be checked (see function JSDoc).
      const workspaceDeps = Object.keys(parsed.dependencies ?? {}).filter(dep =>
        dep.startsWith('@tzurot/')
      );
      result.set(parsed.name, { dir: `${group}/${entry}`, workspaceDeps });
    }
  }

  return result;
}

/**
 * Compute the transitive closure of workspace prod dependencies for a package.
 * The starting package itself is not included in the acyclic case; a dependency
 * cycle that reaches back to the start node will include it, which is harmless —
 * checkService always adds the service's own dir to the expected set anyway.
 *
 * @internal Exported for testing
 */
export function collectTransitiveDeps(
  name: string,
  packages: Map<string, WorkspacePackage>
): Set<string> {
  const visited = new Set<string>();
  const queue = [...(packages.get(name)?.workspaceDeps ?? [])];

  while (queue.length > 0) {
    const dep = queue.shift();
    if (dep === undefined || visited.has(dep)) {
      continue;
    }
    visited.add(dep);
    queue.push(...(packages.get(dep)?.workspaceDeps ?? []));
  }

  return visited;
}

/**
 * How confidently this guard can identify the Dockerfile's runtime stage:
 *
 * - `named-last` — a stage is named `runner` AND no stage follows it. The only
 *   state where the stage this guard checks is provably the stage that ships.
 * - `named-not-last` — a stage is named `runner` but another stage follows it.
 * - `unnamed` — no stage is recognized as `runner`; {@link findRunnerStageWindow}
 *   takes the weaker last-`FROM` fallback.
 *
 * The two non-`named-last` states are reported as findings rather than logged,
 * because each breaks a premise the guard's result rests on — and a guard
 * against silent false negatives must not have a silent failure mode of its
 * own. `named-not-last` is the sharper of the two: `docker build` with no
 * `--target` builds the LAST stage, so a stage appended after `runner` is what
 * actually ships while this guard would go on validating `runner`'s copies.
 *
 * No IN-REPO artifact passes `--target` (searched: workflows, package.json,
 * every service Dockerfile; no railway.json/toml exists). That search
 * cannot see Railway's per-service dashboard build settings, which leave no
 * trace here — so this states "no in-repo target", not "no target anywhere".
 * If this check ever fires on a Dockerfile that deliberately keeps a stage
 * after `runner`, check Railway's dashboard for an out-of-band `--target`
 * before assuming the Dockerfile is wrong. The failure is loud and actionable
 * either way, which is why the guard errs toward reporting the ambiguity.
 *
 * @internal Exported for testing
 */
export function classifyRunnerStage(
  dockerfileContent: string
): 'named-last' | 'named-not-last' | 'unnamed' {
  const lines = dockerfileContent.split('\n');
  const runnerIndex = lines.reduce(
    (last, line, i) => (RUNNER_STAGE_PATTERN.test(line) ? i : last),
    -1
  );

  if (runnerIndex === -1) {
    return 'unnamed';
  }
  return lines.slice(runnerIndex + 1).some(line => STAGE_START_PATTERN.test(line))
    ? 'named-not-last'
    : 'named-last';
}

/**
 * Locate the runner stage's line window: `[start, end)` bounding the lines
 * that belong to it.
 *
 * Anchors on a stage explicitly named `runner` (`FROM ... AS runner`) when
 * one exists — the window then runs from just after that `FROM` line up to
 * (but not including) the NEXT stage-start line, so a stage added AFTER
 * runner (a debug stage, `FROM scratch AS export`) never contributes copies.
 * If MULTIPLE stages are named `runner` (pathological but possible), the
 * LAST one wins.
 *
 * Falls back to the last `FROM` line in the file, scanning to end-of-file,
 * when no stage is named `runner` — this keeps single-stage Dockerfiles
 * (and any legacy Dockerfile that never adopted the `runner` name) working.
 */
function findRunnerStageWindow(lines: string[]): { start: number; end: number } {
  const runnerStageStart = lines.reduce(
    (last, line, i) => (RUNNER_STAGE_PATTERN.test(line) ? i : last),
    -1
  );

  if (runnerStageStart !== -1) {
    let end = lines.length;
    for (let i = runnerStageStart + 1; i < lines.length; i++) {
      if (STAGE_START_PATTERN.test(lines[i])) {
        end = i;
        break;
      }
    }
    return { start: runnerStageStart + 1, end };
  }

  const lastStageStart = lines.reduce(
    (last, line, i) => (STAGE_START_PATTERN.test(line) ? i : last),
    -1
  );
  return { start: lastStageStart + 1, end: lines.length };
}

/**
 * Extract the repo-relative package dirs whose `dist` is copied in the
 * Dockerfile's runner stage. Earlier stages (pruner, installer, builder) are
 * ignored — only the runner's copies reach the runtime image. See
 * {@link findRunnerStageWindow} for how the runner stage's line window is
 * anchored, including the no-named-`runner`-stage fallback.
 *
 * @internal Exported for testing
 */
export function extractRunnerDistCopies(dockerfileContent: string): string[] {
  const lines = dockerfileContent.split('\n');
  const { start, end } = findRunnerStageWindow(lines);

  const copies: string[] = [];
  for (const line of lines.slice(start, end)) {
    const match = DIST_COPY_PATTERN.exec(line);
    if (match !== null) {
      copies.push(match[1]);
    }
  }
  return copies;
}

/**
 * Cross-check one service's Dockerfile runner-stage copies against its
 * transitive workspace dependency closure.
 *
 * @internal Exported for testing
 */
export function checkService(
  serviceName: string,
  dockerfileContent: string,
  packages: Map<string, WorkspacePackage>
): DistCopyFinding[] {
  const pkg = packages.get(serviceName);
  if (pkg === undefined) {
    return [];
  }

  // Runtime image needs: every transitive workspace dep's dist + the service's own dist
  const expectedDirs = new Set<string>([pkg.dir]);
  for (const dep of collectTransitiveDeps(serviceName, packages)) {
    const depPkg = packages.get(dep);
    if (depPkg !== undefined) {
      expectedDirs.add(depPkg.dir);
    }
  }

  const copiedDirs = new Set(extractRunnerDistCopies(dockerfileContent));
  const findings: DistCopyFinding[] = [];

  for (const dir of expectedDirs) {
    if (!copiedDirs.has(dir)) {
      findings.push({
        service: serviceName,
        kind: 'missing-copy',
        packageDir: dir,
        detail: `runner stage is missing \`COPY --from=builder /app/${dir}/dist ./${dir}/dist\` — runtime image will crash with ERR_MODULE_NOT_FOUND`,
      });
    }
  }

  for (const dir of copiedDirs) {
    if (!expectedDirs.has(dir)) {
      findings.push({
        service: serviceName,
        kind: 'stale-copy',
        packageDir: dir,
        detail: `runner stage copies ${dir}/dist but it is not in the service's transitive workspace prod-dependency closure — remove the COPY (or add the missing dependency)`,
      });
    }
  }

  return findings;
}

/**
 * A finding for any state where the guard cannot prove it checked the stage
 * that actually ships, or `null` when it can. See {@link classifyRunnerStage}
 * for why each state matters.
 */
function runnerAnchorFinding(
  serviceName: string,
  dockerfileContent: string
): DistCopyFinding | null {
  const anchoring = classifyRunnerStage(dockerfileContent);
  if (anchoring === 'named-last') {
    return null;
  }

  const detail =
    anchoring === 'named-not-last'
      ? 'a stage follows `AS runner`, so `docker build` without `--target` ships THAT stage while this guard checks `runner` — make `runner` the final stage, or pass `--target runner` and teach this guard about it'
      : 'no stage recognized as `runner` (the pattern needs `FROM <image> AS runner`), so the weaker last-FROM anchoring is in use and a stage added after the runtime stage would be checked instead of it';

  return { service: serviceName, kind: 'runner-anchor', detail };
}

/**
 * Scan every service that has a Dockerfile and collect findings.
 */
function scanServices(
  packages: Map<string, WorkspacePackage>,
  rootDir: string,
  verbose: boolean
): { findings: DistCopyFinding[]; servicesChecked: number } {
  const findings: DistCopyFinding[] = [];
  let servicesChecked = 0;

  for (const [name, pkg] of packages) {
    if (!pkg.dir.startsWith('services/')) {
      continue;
    }

    const dockerfilePath = join(rootDir, pkg.dir, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      if (verbose) {
        console.log(chalk.dim(`  ${name}: no Dockerfile, skipped`));
      }
      continue;
    }

    servicesChecked++;
    const dockerfileContent = readFileSync(dockerfilePath, 'utf-8');

    const serviceFindings = checkService(name, dockerfileContent, packages);
    const anchorFinding = runnerAnchorFinding(name, dockerfileContent);
    if (anchorFinding !== null) {
      serviceFindings.push(anchorFinding);
    }

    findings.push(...serviceFindings);

    if (verbose && serviceFindings.length === 0) {
      console.log(chalk.green(`  ✅ ${name}: runner-stage dist copies in sync`));
    }
  }

  return { findings, servicesChecked };
}

/**
 * Keyed by kind so a new finding kind cannot silently inherit another's badge.
 * Labels are padded to a common width so the console output stays columnar.
 */
const FINDING_BADGES: Record<DistCopyFinding['kind'], () => string> = {
  'missing-copy': () => chalk.red.bold('MISSING'),
  'stale-copy': () => chalk.yellow.bold('STALE  '),
  'runner-anchor': () => chalk.red.bold('ANCHOR '),
};

function displayFindings(findings: DistCopyFinding[]): void {
  for (const finding of findings) {
    const badge = FINDING_BADGES[finding.kind]();
    console.log(`  ${badge} ${chalk.white(finding.service)}: ${finding.detail}`);
  }
  console.log('');
}

/**
 * Check every service Dockerfile's runner-stage dist copies.
 */
export async function checkDockerfileDist(options: CheckOptions = {}): Promise<void> {
  const { verbose = false } = options;
  const rootDir = process.cwd();

  console.log(SEPARATOR);
  console.log(chalk.cyan.bold('           DOCKERFILE DIST-COPY GUARD                   '));
  console.log(SEPARATOR);
  console.log('');

  const packages = loadWorkspacePackages(rootDir);
  const { findings, servicesChecked } = scanServices(packages, rootDir, verbose);

  if (findings.length > 0) {
    displayFindings(findings);
  }

  console.log(chalk.dim(`Checked ${servicesChecked} service Dockerfile(s)\n`));

  if (findings.length === 0) {
    console.log(chalk.green.bold('✅ All runner-stage dist copies match workspace dependencies!'));
  } else {
    // "issue(s)", not "dist-copy issue(s)" — runner-anchor findings are about
    // WHICH stage got checked, not about a copy being wrong.
    console.log(chalk.red.bold(`Found ${findings.length} issue(s).`));
    process.exitCode = 1;
  }

  console.log('');
  console.log(SEPARATOR);
}
