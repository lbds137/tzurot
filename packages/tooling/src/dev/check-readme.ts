/**
 * Guard: root README.md stays in sync with the repo it describes.
 *
 * Five things must agree: the Project Structure tree lists exactly the
 * `services/` and `packages/` directories on disk; the Prerequisites
 * versions match `package.json` `engines`; every fenced `pnpm <script>`
 * names a real root script; the Slash Commands section mentions every
 * shipped slash command and message context-menu command; and every
 * relative link (and bare `#anchor`) resolves.
 *
 * The command-list class (4) has no allowlist — see check-readme-classes.ts.
 *
 * This is a binary sync-check (like guard:ops-doc and guard:commands-doc),
 * NOT an audit-class tool: no threshold, no WHY.md, no --summary. The five
 * check functions live in check-readme-classes.ts, kept separate purely for
 * the per-file line budget; this module owns the filesystem facts and the
 * CLI shell.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listCommandModules } from './check-commands-doc.js';
import {
  checkFencedScripts,
  checkLinks,
  checkPrerequisites,
  checkProjectStructure,
  checkSlashCommands,
} from './check-readme-classes.js';

const README_PATH = 'README.md';
const COMMANDS_DIR = 'services/bot-client/src/commands';

const CONTEXT_MENU_NAME =
  /new ContextMenuCommandBuilder\(\)[\s\S]*?\.setName\(\s*['"]([^'"]+)['"]/g;

interface PackageJsonFacts {
  engines?: { node?: string; pnpm?: string };
  scripts?: Record<string, unknown>;
}

/** Directory entries directly under `rootDir/sub`, dot-prefixed excluded. */
function listDirs(rootDir: string, sub: string): string[] {
  const dir = join(rootDir, sub);
  return readdirSync(dir)
    .filter(entry => !entry.startsWith('.'))
    .filter(entry => statSync(join(dir, entry)).isDirectory())
    .sort();
}

/**
 * Message context-menu display names: the top-level (non-directory) `.ts`
 * command modules, each holding one or more `new ContextMenuCommandBuilder()
 * .setName('...')` chains.
 */
export function listContextMenuNames(rootDir: string): string[] {
  const dir = join(rootDir, COMMANDS_DIR);
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) {
      continue;
    }
    const source = readFileSync(join(dir, entry), 'utf-8');
    for (const match of source.matchAll(CONTEXT_MENU_NAME)) {
      names.push(match[1]);
    }
  }
  return names.sort();
}

export interface ReadmeDrift {
  projectStructure: string[];
  prerequisites: string[];
  fencedScripts: string[];
  slashCommands: string[];
  links: string[];
}

export function findReadmeDrift(rootDir: string): ReadmeDrift {
  const readme = readFileSync(join(rootDir, README_PATH), 'utf-8');
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')) as PackageJsonFacts;

  return {
    projectStructure: checkProjectStructure(
      readme,
      listDirs(rootDir, 'services'),
      listDirs(rootDir, 'packages')
    ),
    prerequisites: checkPrerequisites(readme, pkg.engines ?? {}),
    fencedScripts: checkFencedScripts(readme, pkg.scripts ?? {}),
    slashCommands: checkSlashCommands(
      readme,
      listCommandModules(rootDir),
      listContextMenuNames(rootDir)
    ),
    links: checkLinks(readme, relPath => existsSync(join(rootDir, relPath))),
  };
}

export function checkReadme(): void {
  const drift = findReadmeDrift(process.cwd());
  const allFindings = [
    ...drift.projectStructure,
    ...drift.prerequisites,
    ...drift.fencedScripts,
    ...drift.slashCommands,
    ...drift.links,
  ];

  if (allFindings.length === 0) {
    console.log(`✓ ${README_PATH} agrees with the repo it describes.`);
    return;
  }

  console.error(`❌ ${README_PATH} has drifted:`);
  for (const finding of allFindings) {
    console.error(`   ${finding}`);
  }
  console.error('\n   Fix the README (or the underlying repo state) in the same change.');
  process.exitCode = 1;
}
