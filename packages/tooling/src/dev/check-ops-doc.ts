/**
 * Guard: docs/reference/tooling/OPS_CLI_REFERENCE.md stays in sync with the
 * registered `pnpm ops` command set.
 *
 * Nothing verified that reference against the commands actually registered in
 * the CLI, and it drifted silently — four shipped `cache:` commands were
 * missing from it until a manual review caught them. `guard:commands-doc`
 * covers the Discord slash-command surface (docs/commands.md); this covers the
 * ops CLI surface.
 *
 * This is a binary sync-check (like guard:duplicate-exports and
 * guard:commands-doc), NOT an audit-class tool: no threshold, no WHY.md, no
 * --summary.
 *
 * ## Why a static scan rather than CAC introspection
 *
 * Enumerating the live `cli.commands` would mean importing every registrar,
 * including `commands/guard.ts` — the file that registers THIS command. That
 * closes an import cycle (`guard.ts` → this module → registrars → `guard.ts`)
 * which `pnpm depcruise`'s no-circular rule rejects. The alternative used by
 * `guard:claude-content-refs` — spawning `pnpm ops --help` — costs a full tsx
 * boot and can't be unit-tested against fixtures.
 *
 * So the scan reads the registrar sources directly. Verified equivalent: the
 * scan and `pnpm ops --help` produce the identical 103-command set. The
 * fail-open risk of a regex (a registration written in a shape the pattern
 * misses would silently need no doc row) is closed by
 * `findUnparsedRegistrations` — every `.command(` occurrence that the name
 * pattern did not claim is itself a hard failure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Registrar sources — every `cli.command(...)` call in the repo lives here. */
const COMMANDS_DIR = 'packages/tooling/src/commands';
const DOC_PATH = 'docs/reference/tooling/OPS_CLI_REFERENCE.md';

/**
 * A `.command('name'…)` registration. The name charset stops at the first
 * space, so cac arg syntax (`run [...command]`, `maintenance <action>`) yields
 * the bare command name.
 */
const REGISTRATION = /\.command\(\s*['"]([a-z][a-z0-9:-]*)/g;

/** Every `.command(` call site, parseable or not — the fail-open backstop. */
const ANY_REGISTRATION = /\.command\(/g;

/**
 * Commands intentionally absent from the reference doc. Each entry needs a
 * one-line reason. Empty is the healthy state: an internal or deprecated
 * command is usually better deleted than allowlisted.
 */
export const UNDOCUMENTED_ALLOWLIST: Record<string, string> = {
  // (empty — every registered command currently has a doc row)
};

export interface OpsDocDrift {
  /** Registered commands with no mention in the reference doc. */
  undocumented: string[];
  /** `file:line` of `.command(` calls the name pattern could not parse. */
  unparsed: string[];
  /** Allowlist entries whose command is documented (or no longer exists). */
  staleAllowlist: string[];
  /** Doc table rows whose command is no longer registered. */
  staleDocRows: string[];
}

/**
 * A doc TABLE ROW's command cell: a line opening `| `pnpm ops <name>`.
 * The reverse (stale-row) direction deliberately covers rows only — a row is
 * the doc's contract that the command exists, while a prose or code-fence
 * mention can't be reverse-checked without false positives (prose legitimately
 * names partial or historical forms).
 */
const DOC_ROW = /^\|\s*`pnpm ops ([a-z][a-z0-9:-]*)/gm;

/** The distinct command names claimed by doc table rows, sorted. */
export function listDocRowCommands(doc: string): string[] {
  return [...new Set([...doc.matchAll(DOC_ROW)].map(m => m[1]))].sort();
}

/** Registrar source files, sorted for deterministic output. */
function listRegistrarFiles(rootDir: string): string[] {
  return readdirSync(join(rootDir, COMMANDS_DIR))
    .filter(entry => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .sort();
}

/**
 * The full `namespace:name` set registered across the registrar modules.
 */
export function listRegisteredOpsCommands(rootDir: string): string[] {
  const names = new Set<string>();
  for (const file of listRegistrarFiles(rootDir)) {
    const source = readFileSync(join(rootDir, COMMANDS_DIR, file), 'utf-8');
    for (const match of source.matchAll(REGISTRATION)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

/**
 * `file:line` for every `.command(` call the name pattern did not claim.
 * A non-empty result means the scan has gone blind to a registration shape
 * (template literal, computed name) and must be taught it before the guard
 * can be trusted.
 */
export function findUnparsedRegistrations(rootDir: string): string[] {
  const findings: string[] = [];
  for (const file of listRegistrarFiles(rootDir)) {
    const lines = readFileSync(join(rootDir, COMMANDS_DIR, file), 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const total = [...lines[i].matchAll(ANY_REGISTRATION)].length;
      const parsed = [...lines[i].matchAll(REGISTRATION)].length;
      // A multi-line `.command(\n  'name',` call parses on the NEXT line, so
      // an unmatched `.command(` at end-of-line is only a finding when the
      // following line doesn't open with a quoted name either.
      const continued = /^\s*['"][a-z][a-z0-9:-]*/.test(lines[i + 1] ?? '') ? 1 : 0;
      if (total > parsed + continued) {
        findings.push(`${COMMANDS_DIR}/${file}:${i + 1}`);
      }
    }
  }
  return findings;
}

/**
 * Loose doc matching, per the guard's contract: per-option coverage is out of
 * scope, and a mention anywhere in the file counts. Two accepted shapes:
 *
 * - `ops <name>` — how every table row and code fence in the doc writes it
 * - a backtick span holding exactly the name
 *
 * Both are boundary-anchored so `test:audit` is not considered documented by a
 * `test:audit-contracts` row, and prose (`waiting backlog never blocks`,
 * `503s below /health`) does not document the `backlog` / `health` commands.
 */
export function isDocumented(doc: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Left-anchored on the full `pnpm ops` invocation so prose that merely ends
  // in "ops" (e.g. "backup ops") can't false-document the following word;
  // right-anchored so a longer sibling name can't cover a shorter one.
  const opsPrefixed = new RegExp(`pnpm ops ${escaped}(?![a-z0-9:-])`);
  const codeSpan = new RegExp('`' + escaped + '`');
  return opsPrefixed.test(doc) || codeSpan.test(doc);
}

export function findOpsDocDrift(
  rootDir: string,
  allowlist: Record<string, string> = UNDOCUMENTED_ALLOWLIST
): OpsDocDrift {
  const registered = listRegisteredOpsCommands(rootDir);
  const doc = readFileSync(join(rootDir, DOC_PATH), 'utf-8');

  const undocumented = registered.filter(name => !isDocumented(doc, name) && !(name in allowlist));
  const registeredSet = new Set(registered);
  const staleAllowlist = Object.keys(allowlist)
    .filter(name => !registeredSet.has(name) || isDocumented(doc, name))
    .sort();
  const staleDocRows = listDocRowCommands(doc).filter(name => !registeredSet.has(name));

  return {
    undocumented,
    unparsed: findUnparsedRegistrations(rootDir),
    staleAllowlist,
    staleDocRows,
  };
}

export function checkOpsDoc(): void {
  const drift = findOpsDocDrift(process.cwd());

  if (
    drift.undocumented.length === 0 &&
    drift.unparsed.length === 0 &&
    drift.staleAllowlist.length === 0 &&
    drift.staleDocRows.length === 0
  ) {
    console.log(`✓ ${DOC_PATH} documents every registered pnpm ops command.`);
    return;
  }

  if (drift.undocumented.length > 0) {
    console.error(`❌ ${DOC_PATH} is missing rows for registered commands:`);
    for (const name of drift.undocumented) {
      console.error(`   pnpm ops ${name} is registered but appears nowhere in ${DOC_PATH}`);
    }
    console.error(
      '\n   Add a row to the matching section (or a new section) in the same change as the ' +
        'command. If it is deliberately undocumented, add a justified ' +
        'UNDOCUMENTED_ALLOWLIST entry in check-ops-doc.ts.'
    );
  }

  if (drift.unparsed.length > 0) {
    console.error('\n❌ Unparseable `.command(` registrations (the scan is blind here):');
    for (const site of drift.unparsed) {
      console.error(`   ${site}`);
    }
    console.error('   Use a plain quoted command name, or teach REGISTRATION the new shape.');
  }

  if (drift.staleAllowlist.length > 0) {
    console.error('\n❌ Stale UNDOCUMENTED_ALLOWLIST entries (now documented, or gone):');
    for (const name of drift.staleAllowlist) {
      console.error(`   ${name}`);
    }
    console.error('   Remove the entry from UNDOCUMENTED_ALLOWLIST in check-ops-doc.ts.');
  }

  if (drift.staleDocRows.length > 0) {
    console.error(`\n❌ ${DOC_PATH} has rows for commands that are no longer registered:`);
    for (const name of drift.staleDocRows) {
      console.error(`   pnpm ops ${name} has a doc row but is not registered in the CLI`);
    }
    console.error('   Remove the row (or restore the command) in the same change.');
  }

  process.exitCode = 1;
}
