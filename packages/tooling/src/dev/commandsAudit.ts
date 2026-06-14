/**
 * Commands Audit
 *
 * Slash-command surface inventory + consistency audit. Reads the
 * auto-generated command manifest (`services/bot-client/command-manifest.json`,
 * produced by `commandManifest.test.ts`) and:
 *
 *  1. Renders the whole command surface (`--format tree|md|json`).
 *  2. Runs consistency checks, each producing a finding with a severity.
 *
 * The manifest indirection exists because command modules can't be imported
 * outside the bot-client mocked test harness (some throw or hang at module
 * load). The generator runs in bot-client; this consumer only reads JSON.
 *
 * Split across `commandsAuditCore` (shared types/helpers), `commandsAuditChecks`
 * (the consistency checks), and `commandsAuditRender` (inventory renderers) to
 * stay within the per-file line + per-function complexity limits. Callers import
 * each symbol from its defining module (no re-export barrel); this file owns the
 * manifest loader + the runner.
 *
 * Usage:
 *   pnpm ops commands:audit                 # tree inventory + findings
 *   pnpm ops commands:audit --format md     # markdown surface doc
 *   pnpm ops commands:audit --format json   # structured findings + inventory
 *   pnpm ops commands:audit --summary       # one JSONL audit-summary line
 *
 * Exits non-zero when any error-severity finding is present, so it can gate CI.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emitSummary } from '../audits/summary.js';
import {
  type CommandManifest,
  type CommandsAuditOptions,
  type Finding,
  allLeafOptions,
  allSubcommands,
} from './commandsAuditCore.js';
import { runChecks } from './commandsAuditChecks.js';
import { renderMarkdown, renderTree } from './commandsAuditRender.js';

export function loadManifest(options: CommandsAuditOptions = {}): CommandManifest {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const manifestPath =
    options.manifestPath ?? resolve(rootDir, 'services', 'bot-client', 'command-manifest.json');

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Failed to read command manifest at ${manifestPath}. ` +
        `Generate it with: pnpm --filter @tzurot/bot-client test -- -u src/handlers/commandManifest.test.ts`,
      { cause: err }
    );
  }

  const parsed = JSON.parse(raw) as CommandManifest;
  if (!Array.isArray(parsed.commands) || !Array.isArray(parsed.helpCategories)) {
    throw new Error(
      `Malformed command manifest at ${manifestPath}: missing commands/helpCategories`
    );
  }
  return parsed;
}

function emitJson(manifest: CommandManifest, findings: Finding[]): void {
  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warnCount = findings.filter(f => f.severity === 'warn').length;
  console.log(
    JSON.stringify(
      {
        summary: { total: findings.length, errors: errorCount, warnings: warnCount },
        findings,
        inventory: manifest.commands.map(c => ({
          name: c.name,
          category: c.category,
          handlers: c.handlers,
          subcommands: allSubcommands(c).map(s => s.name),
          options: allLeafOptions(c).map(l => ({
            path: l.path,
            name: l.option.name,
            type: l.option.type,
          })),
        })),
      },
      null,
      2
    )
  );
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log('✅ No command consistency issues found.');
    return;
  }
  const errors = findings.filter(f => f.severity === 'error');
  const warns = findings.filter(f => f.severity === 'warn');
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Consistency findings: ${errors.length} error(s), ${warns.length} warning(s)\n`);
  for (const f of findings) {
    const icon = f.severity === 'error' ? '❌' : '⚠️';
    console.log(`${icon} [${f.rule}] ${f.command}: ${f.detail}`);
  }
}

/**
 * Compute aggregate verdict + emit the JSONL audit-summary line.
 * `status: fail` when any error-severity finding exists; `warn` when only
 * warnings; `ok` when clean. `findings` counts everything (errors + warns).
 */
export function summarize(findings: Finding[]): {
  status: 'ok' | 'warn' | 'fail';
  findings: number;
} {
  const errorCount = findings.filter(f => f.severity === 'error').length;
  const status: 'ok' | 'warn' | 'fail' =
    errorCount > 0 ? 'fail' : findings.length > 0 ? 'warn' : 'ok';
  return { status, findings: findings.length };
}

export async function runCommandsAudit(options: CommandsAuditOptions = {}): Promise<void> {
  const manifest = loadManifest(options);
  const findings = runChecks(manifest);
  const { status, findings: findingCount } = summarize(findings);
  // status === 'fail' iff there's an error-severity finding (see summarize).
  const hasError = status === 'fail';

  if (options.summary === true) {
    emitSummary({
      tool: 'commands:audit',
      status,
      findings: findingCount,
      // No ratchet baseline — this is a pass/fail gate on error-severity findings.
      baseline: 0,
    });
    if (hasError) process.exit(1);
    return;
  }

  if (options.format === 'json') {
    emitJson(manifest, findings);
    if (hasError) process.exit(1);
    return;
  }

  console.log(options.format === 'md' ? renderMarkdown(manifest) : renderTree(manifest));
  printFindings(findings);
  if (hasError) process.exit(1);
}
