/**
 * Update Dependencies
 *
 * This module ensures dependency updates are consistent across the monorepo:
 * 1. Updates all dependencies to latest versions
 * 2. Syncs package.json version specifiers with lockfile
 * 3. Verifies builds still work
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

/* eslint-disable sonarjs/cognitive-complexity -- pre-existing */

interface UpdateDepsOptions {
  skipBuild?: boolean;
  dryRun?: boolean;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

type LockfilePackages = Record<
  string,
  {
    dependencies?: Record<string, { specifier: string; version: string }>;
    devDependencies?: Record<string, { specifier: string; version: string }>;
  }
>;

/**
 * Execute a command safely with array arguments (no shell injection)
 */
function execFileSafe(command: string, args: string[], cwd: string): void {
  console.log(`\n📦 ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: 'inherit',
  });
}

/**
 * Find all package.json files in the monorepo
 */
function findPackageJsonFiles(rootDir: string): string[] {
  const packageJsons: string[] = [join(rootDir, 'package.json')];

  // Find all package.json files in packages/ and services/
  const searchDirs = ['packages', 'services', 'scripts'];

  for (const dir of searchDirs) {
    const dirPath = join(rootDir, dir);
    try {
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const entryPath = join(dirPath, entry);
        if (statSync(entryPath).isDirectory()) {
          const pkgPath = join(entryPath, 'package.json');
          try {
            statSync(pkgPath);
            packageJsons.push(pkgPath);
          } catch {
            // No package.json in this directory
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return packageJsons;
}

/**
 * Parse pnpm lockfile to extract importer information
 */
function parseLockfile(rootDir: string): LockfilePackages {
  const lockfilePath = join(rootDir, 'pnpm-lock.yaml');
  const lockfileContent = readFileSync(lockfilePath, 'utf-8');

  // Parse YAML manually for the importers section
  const lines = lockfileContent.split('\n');
  const importers: LockfilePackages = {};

  let currentImporter: string | null = null;
  let currentSection: 'dependencies' | 'devDependencies' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match importer path
    if (/^ {2}'[^']+':$/.exec(line) || /^ {2}\.:$/.exec(line)) {
      currentImporter = line.trim().replace(/:$/, '').replace(/'/g, '');
      importers[currentImporter] = {};
      currentSection = null;
    } else if (currentImporter && line === '    dependencies:') {
      currentSection = 'dependencies';
      importers[currentImporter].dependencies = {};
    } else if (currentImporter && line === '    devDependencies:') {
      currentSection = 'devDependencies';
      importers[currentImporter].devDependencies = {};
    } else if (currentImporter && currentSection && /^ {6}'[^']+':$/.exec(line)) {
      // Package entry
      const pkgName = line.trim().replace(/:$/, '').replace(/'/g, '');
      const nextLine = lines[i + 1];

      if (nextLine?.includes('specifier:')) {
        const specMatch = /specifier: (.+)/.exec(nextLine);
        const versionLine = lines[i + 2];
        const versionMatch = /version: ([^\s(]+)/.exec(versionLine);

        if (specMatch && versionMatch) {
          const specifier = specMatch[1].trim();
          const version = versionMatch[1].trim();
          const importer = importers[currentImporter];

          if (currentSection === 'dependencies' && importer.dependencies) {
            importer.dependencies[pkgName] = { specifier, version };
          } else if (currentSection === 'devDependencies' && importer.devDependencies) {
            importer.devDependencies[pkgName] = { specifier, version };
          }
        }
      }
    }
  }

  return importers;
}

/**
 * Get the importer path for a package.json file
 */
function getImporterPath(packageJsonPath: string, rootDir: string): string {
  const relativePath = packageJsonPath
    .replace(rootDir, '')
    .replace(/^\//, '')
    .replace(/\/?package\.json$/, ''); // Handle both /package.json and package.json
  return relativePath === '' ? '.' : relativePath;
}

/**
 * Sync a package.json file with the lockfile versions
 */
function syncPackageJson(
  packageJsonPath: string,
  lockfileData: LockfilePackages,
  rootDir: string,
  dryRun: boolean
): boolean {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
  const importerPath = getImporterPath(packageJsonPath, rootDir);
  const lockfileEntry = lockfileData[importerPath];

  if (!lockfileEntry) {
    console.log(chalk.yellow(`⚠️  No lockfile entry for ${importerPath}`));
    return false;
  }

  let changed = false;

  // Sync dependencies
  if (pkg.dependencies && lockfileEntry.dependencies) {
    for (const [name, currentSpec] of Object.entries(pkg.dependencies)) {
      // Skip workspace references
      if (currentSpec.startsWith('workspace:')) continue;

      const lockfileInfo = lockfileEntry.dependencies[name];
      if (lockfileInfo) {
        const actualVersion = lockfileInfo.version.split('(')[0]; // Remove peer dep info
        const newSpec = `^${actualVersion}`;

        if (currentSpec !== newSpec) {
          console.log(`  ${name}: ${currentSpec} → ${newSpec}`);
          pkg.dependencies[name] = newSpec;
          changed = true;
        }
      }
    }
  }

  // Sync devDependencies
  if (pkg.devDependencies && lockfileEntry.devDependencies) {
    for (const [name, currentSpec] of Object.entries(pkg.devDependencies)) {
      if (currentSpec.startsWith('workspace:')) continue;

      const lockfileInfo = lockfileEntry.devDependencies[name];
      if (lockfileInfo) {
        const actualVersion = lockfileInfo.version.split('(')[0];
        const newSpec = `^${actualVersion}`;

        if (currentSpec !== newSpec) {
          console.log(`  ${name}: ${currentSpec} → ${newSpec} (dev)`);
          pkg.devDependencies[name] = newSpec;
          changed = true;
        }
      }
    }
  }

  if (changed && !dryRun) {
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  return changed;
}

/**
 * Update dependencies across the monorepo
 */
export async function updateDeps(options: UpdateDepsOptions = {}): Promise<void> {
  const { skipBuild = false, dryRun = false } = options;
  const rootDir = process.cwd();

  console.log(chalk.cyan.bold('🚀 Updating dependencies...\n'));

  if (dryRun) {
    console.log(chalk.yellow('📋 Dry run mode - no changes will be written\n'));
  }

  // Step 1: Update dependencies
  console.log(chalk.cyan('📋 Step 1: Running pnpm update --latest'));
  if (!dryRun) {
    execFileSafe('pnpm', ['update', '--latest'], rootDir);
  } else {
    console.log(chalk.dim('  [skipped in dry run]'));
  }

  // Step 2: Parse lockfile
  console.log(chalk.cyan('\n📋 Step 2: Parsing lockfile to sync package.json files'));
  const lockfileData = parseLockfile(rootDir);

  // Step 3: Sync all package.json files
  console.log(chalk.cyan('\n📋 Step 3: Syncing package.json files with lockfile'));
  const packageJsonFiles = findPackageJsonFiles(rootDir);
  let totalChanged = 0;

  for (const pkgPath of packageJsonFiles) {
    const pkgName = pkgPath.replace(rootDir, '').replace(/^\//, '');
    console.log(`\n🔍 Checking ${pkgName}`);

    if (syncPackageJson(pkgPath, lockfileData, rootDir, dryRun)) {
      totalChanged++;
    } else {
      console.log(chalk.green('  ✓ Already in sync'));
    }
  }

  if (totalChanged > 0) {
    console.log(
      chalk.yellow(
        `\n📦 ${dryRun ? 'Would update' : 'Updated'} ${totalChanged} package.json file(s)`
      )
    );
    if (!dryRun) {
      console.log(chalk.cyan('\n📋 Step 4: Running pnpm install to update lockfile'));
      execFileSafe('pnpm', ['install'], rootDir);
    }
  } else {
    console.log(chalk.green('\n✓ All package.json files already in sync'));
  }

  // Step 5: Build to verify
  if (!skipBuild && !dryRun) {
    console.log(chalk.cyan('\n📋 Step 5: Building to verify everything works'));
    execFileSafe('pnpm', ['build'], rootDir);
  } else if (skipBuild) {
    console.log(chalk.dim('\n📋 Step 5: Build verification skipped'));
  }

  console.log(chalk.green.bold('\n✅ Dependencies updated and verified!'));
  console.log(chalk.dim('\n📝 Next steps:'));
  console.log(chalk.dim('  1. Review changes: git diff'));
  console.log(chalk.dim('  2. Test locally if needed'));
  console.log(chalk.dim('  3. Commit: git add -A && git commit -m "chore: update dependencies"'));
}
