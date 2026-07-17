/**
 * Guard: docs/commands.md stays in sync with the command modules.
 *
 * Every top-level slash command lives in its own directory under
 * services/bot-client/src/commands/, and docs/commands.md documents each as a
 * table row starting with `| \`/name\``. The two drifted repeatedly in
 * practice (/feedback and /notifications shipped undocumented until a manual
 * release-prep sweep) — and the table is now rendered live at
 * tzurot.org/docs/commands, so a missing row is public. The check is
 * bidirectional: an undocumented command fails, and so does a documented
 * command that no longer exists.
 *
 * This is a binary sync-check (like guard:duplicate-exports), NOT an
 * audit-class tool: no threshold, no WHY.md, no --summary.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS_DIR = 'services/bot-client/src/commands';
const DOC_PATH = 'docs/commands.md';

/** A documented command row: a table line whose first cell is `/name`. */
const DOC_ROW = /^\|\s*`\/([a-z][a-z-]*)`/;

export interface CommandsDocDrift {
  undocumented: string[];
  stale: string[];
}

/** Top-level command names = the directory names under commands/. */
export function listCommandModules(rootDir: string): string[] {
  const dir = join(rootDir, COMMANDS_DIR);
  return readdirSync(dir)
    .filter(entry => {
      try {
        return statSync(join(dir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/** Command names documented as table rows in docs/commands.md. */
export function listDocumentedCommands(rootDir: string): string[] {
  const doc = readFileSync(join(rootDir, DOC_PATH), 'utf-8');
  const names = new Set<string>();
  for (const line of doc.split('\n')) {
    const match = DOC_ROW.exec(line);
    if (match !== null) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

export function findCommandsDocDrift(rootDir: string): CommandsDocDrift {
  const modules = new Set(listCommandModules(rootDir));
  const documented = new Set(listDocumentedCommands(rootDir));
  return {
    undocumented: [...modules].filter(name => !documented.has(name)).sort(),
    stale: [...documented].filter(name => !modules.has(name)).sort(),
  };
}

export function checkCommandsDoc(): void {
  const drift = findCommandsDocDrift(process.cwd());

  if (drift.undocumented.length === 0 && drift.stale.length === 0) {
    console.log(`✓ ${DOC_PATH} is in sync with ${COMMANDS_DIR}/.`);
    return;
  }

  console.error(`❌ ${DOC_PATH} has drifted from ${COMMANDS_DIR}/:`);
  for (const name of drift.undocumented) {
    console.error(`  /${name} exists as a command module but has NO table row in ${DOC_PATH}`);
  }
  for (const name of drift.stale) {
    console.error(`  /${name} is documented but has no command module (stale row?)`);
  }
  console.error(
    '\nThe command table is rendered live at tzurot.org/docs/commands — add the ' +
      'missing row (or remove the stale one) in the same change as the command.'
  );
  process.exitCode = 1;
}
