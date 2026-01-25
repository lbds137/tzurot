#!/usr/bin/env tsx

/**
 * Update Dependencies Script
 *
 * This script ensures dependency updates are consistent across the monorepo:
 * 1. Updates all dependencies to latest versions
 * 2. Syncs package.json version specifiers with lockfile
 * 3. Verifies builds still work
 */

import { execFileSync, type StdioOptions } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockfilePackages {
  [path: string]: {
    dependencies?: Record<string, { specifier: string; version: string }>;
    devDependencies?: Record<string, { specifier: string; version: string }>;
  };
}

/**
 * Execute a pnpm command safely using execFileSync with argument arrays.
 * This prevents command injection even though all commands here are static.
 */
function execPnpm(args: string[], options: { stdio?: StdioOptions } = {}): string {
  const command = `pnpm ${args.join(' ')}`;
  console.log(`\n📦 ${command}`);
  return execFileSync('pnpm', args, {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    stdio: options.stdio ?? 'inherit',
  });
}

function findPackageJsonFiles(): string[] {
  const packageJsons: string[] = [join(ROOT_DIR, 'package.json')];

  // Find all package.json files in packages/ and services/
  const searchDirs = ['packages', 'services', 'scripts'];

  for (const dir of searchDirs) {
    const dirPath = join(ROOT_DIR, dir);
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

function parseLockfile(): LockfilePackages {
  const lockfilePath = join(ROOT_DIR, 'pnpm-lock.yaml');
  const lockfileContent = readFileSync(lockfilePath, 'utf-8');

  // Parse YAML manually for the importers section
  const lines = lockfileContent.split('\n');
  const importers: LockfilePackages = {};

  let currentImporter: string | null = null;
  let currentSection: 'dependencies' | 'devDependencies' | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match importer path
    if (line.match(/^  '[^']+':$/) || line.match(/^  \.:$/)) {
      currentImporter = line.trim().replace(/:$/, '').replace(/'/g, '');
      importers[currentImporter] = {};
      currentSection = null;
    } else if (currentImporter && line === '    dependencies:') {
      currentSection = 'dependencies';
      importers[currentImporter].dependencies = {};
    } else if (currentImporter && line === '    devDependencies:') {
      currentSection = 'devDependencies';
      importers[currentImporter].devDependencies = {};
    } else if (currentImporter && currentSection && line.match(/^      '[^']+':$/)) {
      // Package entry
      const pkgName = line.trim().replace(/:$/, '').replace(/'/g, '');
      const nextLine = lines[i + 1];

      if (nextLine && nextLine.includes('specifier:')) {
        const specMatch = nextLine.match(/specifier: (.+)/);
        const versionLine = lines[i + 2];
        const versionMatch = versionLine?.match(/version: ([^\s(]+)/);

        if (specMatch && versionMatch) {
          const specifier = specMatch[1].trim();
          const version = versionMatch[1].trim();

          if (currentSection === 'dependencies') {
            importers[currentImporter].dependencies![pkgName] = { specifier, version };
          } else if (currentSection === 'devDependencies') {
            importers[currentImporter].devDependencies![pkgName] = { specifier, version };
          }
        }
      }
    }
  }

  return importers;
}

function getImporterPath(packageJsonPath: string): string {
  const relativePath = packageJsonPath
    .replace(ROOT_DIR, '')
    .replace(/^\//, '')
    .replace(/\/package\.json$/, '');
  return relativePath === '' ? '.' : relativePath;
}

function syncPackageJson(packageJsonPath: string, lockfileData: LockfilePackages): boolean {
  const pkg: PackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const importerPath = getImporterPath(packageJsonPath);
  const lockfileEntry = lockfileData[importerPath];

  if (!lockfileEntry) {
    console.log(`⚠️  No lockfile entry for ${importerPath}`);
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

  if (changed) {
    writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  return changed;
}

async function main() {
  console.log('🚀 Updating dependencies...\n');

  // Step 1: Update dependencies
  console.log('📋 Step 1: Running pnpm update --latest');
  execPnpm(['update', '--latest']);

  // Step 2: Parse lockfile
  console.log('\n📋 Step 2: Parsing lockfile to sync package.json files');
  const lockfileData = parseLockfile();

  // Step 3: Sync all package.json files
  console.log('\n📋 Step 3: Syncing package.json files with lockfile');
  const packageJsonFiles = findPackageJsonFiles();
  let totalChanged = 0;

  for (const pkgPath of packageJsonFiles) {
    const pkgName = pkgPath.replace(ROOT_DIR, '').replace(/^\//, '');
    console.log(`\n🔍 Checking ${pkgName}`);

    if (syncPackageJson(pkgPath, lockfileData)) {
      totalChanged++;
    } else {
      console.log('  ✓ Already in sync');
    }
  }

  if (totalChanged > 0) {
    console.log(`\n📦 Updated ${totalChanged} package.json file(s)`);
    console.log('\n📋 Step 4: Running pnpm install to update lockfile');
    execPnpm(['install']);
  } else {
    console.log('\n✓ All package.json files already in sync');
  }

  // Step 5: Build to verify
  console.log('\n📋 Step 5: Building to verify everything works');
  execPnpm(['build']);

  console.log('\n✅ Dependencies updated and verified!');
  console.log('\n📝 Next steps:');
  console.log('  1. Review changes: git diff');
  console.log('  2. Test locally if needed');
  console.log('  3. Commit: git add -A && git commit -m "chore: update dependencies"');
}

main().catch(error => {
  console.error('\n❌ Error:', error);
  process.exit(1);
});
