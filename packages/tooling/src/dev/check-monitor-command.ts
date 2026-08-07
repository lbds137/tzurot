/**
 * Guard: the canonical CI-monitor command must not drift across its three surfaces.
 *
 * The same bash one-liner (run-gate + `gh pr checks --watch`) is embedded in:
 *   - `.claude/hooks/pr-monitor-reminder.sh` — the copy that is actually EMITTED
 *     to the agent on every push, so it is ground truth
 *   - `.claude/rules/05-tooling.md` — the canonical documented block
 *   - `.claude/skills/tzurot-git-workflow/SKILL.md` — the manual-arm fallback
 *
 * Keeping the literal in all three is a deliberate readability choice (a pointer
 * would make the rule unreadable at the exact moment someone needs the command),
 * so this guard is what makes the duplication safe: drift can't merge. One review
 * cycle changed the command three times, and each round needed a hand-run
 * byte-identical check across the three files — one round drifted anyway.
 *
 * The copies differ only in placeholders (the hook interpolates a real SHA and PR
 * number; the docs use `<sha>` / `N`), so comparison is on a normalized form.
 *
 * Binary sync-check (like guard:commands-doc), NOT audit-class: no threshold, no
 * WHY.md, no --summary.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Files carrying a copy of the command; the first entry is the reference. */
export const MONITOR_COMMAND_SURFACES = [
  '.claude/hooks/pr-monitor-reminder.sh',
  '.claude/rules/05-tooling.md',
  '.claude/skills/tzurot-git-workflow/SKILL.md',
] as const;

/**
 * Anchors on the gate invocation, which every copy must contain and no other
 * line in these files does. Requires the `--sha` flag too, so prose naming the
 * command (`run \`pnpm ops gh:ci-gate\` to wait`) can't be mistaken for a copy
 * of the invocation.
 */
const COMMAND_LINE = /pnpm ops gh:ci-gate .*--sha/;

export interface SurfaceCommand {
  file: string;
  line: number;
  raw: string;
  normalized: string;
}

/**
 * Erase the per-surface placeholders so the three copies become comparable:
 *
 * - the PR number after `gh:ci-gate` — the hook interpolates the real one, the
 *   rule writes `N`, the skill `<N>`
 * - the heredoc's `\$` escaping — the hook's copy lives in a heredoc, where the
 *   backslash is what stops bash expanding the substitution at emit time
 *
 * The `--sha` VALUE is deliberately NOT normalized: all three copies now pass
 * the literal `$(git rev-parse HEAD)`, so it can be compared like any other
 * token. That is the stricter choice — a placeholder rule broad enough to cover
 * a value containing spaces would also swallow any flag appended after it.
 */
export function normalizeMonitorCommand(raw: string): string {
  return raw
    .trim()
    .replaceAll('\\$', '$')
    .replace(/gh:ci-gate \S+/, 'gh:ci-gate <PLACEHOLDER>');
}

/**
 * Extract the single command line from one surface. Throws when a surface
 * carries zero or several — both mean the guard is no longer watching what it
 * claims to (a renamed file reads as "no drift" otherwise).
 */
export function extractMonitorCommand(file: string, contents: string): SurfaceCommand {
  const matches: { line: number; raw: string }[] = [];
  contents.split('\n').forEach((raw, i) => {
    if (COMMAND_LINE.test(raw)) matches.push({ line: i + 1, raw });
  });

  if (matches.length === 0) {
    throw new Error(
      `${file}: no CI-monitor command found. If the command moved or was renamed, ` +
        'update MONITOR_COMMAND_SURFACES in check-monitor-command.ts.'
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${file}: expected 1 CI-monitor command, found ${matches.length} ` +
        `(lines ${matches.map(m => m.line).join(', ')}). Keep one copy per surface.`
    );
  }

  const [match] = matches;
  return {
    file,
    line: match.line,
    raw: match.raw.trim(),
    normalized: normalizeMonitorCommand(match.raw),
  };
}

/** Copies whose normalized form differs from the reference (the hook's). */
export function findMonitorCommandDrift(commands: SurfaceCommand[]): SurfaceCommand[] {
  const [reference, ...rest] = commands;
  return rest.filter(c => c.normalized !== reference.normalized);
}

export function checkMonitorCommand(): void {
  const rootDir = process.cwd();

  let commands: SurfaceCommand[];
  try {
    commands = MONITOR_COMMAND_SURFACES.map(file =>
      extractMonitorCommand(file, readFileSync(join(rootDir, file), 'utf-8'))
    );
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const drifted = findMonitorCommandDrift(commands);
  if (drifted.length === 0) {
    console.log(
      `✓ CI-monitor command identical across ${MONITOR_COMMAND_SURFACES.length} surfaces.`
    );
    return;
  }

  const [reference] = commands;
  console.error(
    `❌ CI-monitor command drifted on ${drifted.length} surface${drifted.length === 1 ? '' : 's'}.`
  );
  console.error(`\nReference (${reference.file}:${reference.line}):\n  ${reference.normalized}`);
  for (const c of drifted) {
    console.error(`\nDrifted (${c.file}:${c.line}):\n  ${c.normalized}`);
  }
  console.error(
    '\nThe hook is ground truth — it is the copy actually emitted to the agent on ' +
      'every push. Apply the change to all three surfaces (placeholders may differ; ' +
      'nothing else may).'
  );
  process.exitCode = 1;
}
