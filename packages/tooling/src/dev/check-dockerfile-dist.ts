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
  kind: 'missing-copy' | 'stale-copy';
  /** Repo-relative package dir the finding is about */
  packageDir: string;
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
 * Extract the repo-relative package dirs whose `dist` is copied in the
 * Dockerfile's FINAL stage (the runner). Earlier stages (pruner, installer,
 * builder) are ignored — only the runner's copies reach the runtime image.
 *
 * @internal Exported for testing
 */
export function extractRunnerDistCopies(dockerfileContent: string): string[] {
  const lines = dockerfileContent.split('\n');
  const lastStageStart = lines.reduce(
    (last, line, i) => (STAGE_START_PATTERN.test(line) ? i : last),
    -1
  );

  const copies: string[] = [];
  for (const line of lines.slice(lastStageStart + 1)) {
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
    const serviceFindings = checkService(name, readFileSync(dockerfilePath, 'utf-8'), packages);
    findings.push(...serviceFindings);

    if (verbose && serviceFindings.length === 0) {
      console.log(chalk.green(`  ✅ ${name}: runner-stage dist copies in sync`));
    }
  }

  return { findings, servicesChecked };
}

function displayFindings(findings: DistCopyFinding[]): void {
  for (const finding of findings) {
    const badge =
      finding.kind === 'missing-copy' ? chalk.red.bold('MISSING') : chalk.yellow.bold('STALE');
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
    console.log(chalk.red.bold(`Found ${findings.length} dist-copy issue(s).`));
    process.exitCode = 1;
  }

  console.log('');
  console.log(SEPARATOR);
}
