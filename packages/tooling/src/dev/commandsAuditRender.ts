/**
 * Commands Audit — inventory renderers
 *
 * Renders the command manifest as a terminal tree (`renderTree`) or a
 * surface-at-a-glance Markdown doc (`renderMarkdown`). Per-command/per-option
 * extraction keeps each function flat (cognitive-complexity + max-depth limits).
 */

import {
  type ManifestCommand,
  type ManifestOption,
  type CommandManifest,
  allLeafOptions,
  allSubcommands,
  groupByCategory,
  isSubcommand,
  isSubcommandGroup,
  optionTypeName,
  topLevelOptions,
} from './commandsAuditCore.js';

export function handlerBadges(cmd: ManifestCommand): string {
  const badges: string[] = [];
  if (cmd.handlers.autocomplete) badges.push('autocomplete');
  if (cmd.handlers.selectMenu) badges.push('select');
  if (cmd.handlers.button) badges.push('button');
  if (cmd.handlers.modal) badges.push('modal');
  return badges.length > 0 ? ` [${badges.join(', ')}]` : '';
}

function leafLabel(opt: ManifestOption): string {
  const flags: string[] = [];
  if (opt.required === true) flags.push('required');
  if (opt.autocomplete === true) flags.push('autocomplete');
  if (opt.choices && opt.choices.length > 0) flags.push(`${opt.choices.length} choices`);
  const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
  return `${opt.name}:${optionTypeName(opt.type)}${suffix}`;
}

// ── Tree renderer ────────────────────────────────────────────────────────────

/** Render one option subtree (recursion keeps nesting depth flat). */
function renderOptionTreeLines(opt: ManifestOption, indent: number): string[] {
  const pad = ' '.repeat(indent);
  if (isSubcommandGroup(opt)) {
    const lines = [`${pad}${opt.name}/ (group) — ${opt.description ?? ''}`];
    for (const child of opt.options ?? []) lines.push(...renderOptionTreeLines(child, indent + 2));
    return lines;
  }
  if (isSubcommand(opt)) {
    const lines = [`${pad}${opt.name} — ${opt.description ?? ''}`];
    for (const child of opt.options ?? []) lines.push(...renderOptionTreeLines(child, indent + 2));
    return lines;
  }
  return [`${pad}· ${leafLabel(opt)}`];
}

function renderCommandTreeLines(cmd: ManifestCommand): string[] {
  const lines = [`  /${cmd.name}${handlerBadges(cmd)} — ${cmd.description}`];
  for (const opt of topLevelOptions(cmd)) lines.push(...renderOptionTreeLines(opt, 4));
  return lines;
}

export function renderTree(manifest: CommandManifest): string {
  const lines: string[] = [];
  for (const [category, cmds] of groupByCategory(manifest.commands)) {
    lines.push(`▸ ${category}`);
    for (const cmd of cmds) lines.push(...renderCommandTreeLines(cmd));
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function subcommandTableLines(cmd: ManifestCommand): string[] {
  const subs = allSubcommands(cmd);
  if (subs.length === 0) return [];
  const lines = ['| Subcommand | Description |', '| --- | --- |'];
  for (const sub of subs) lines.push(`| \`${sub.name}\` | ${sub.description ?? ''} |`);
  lines.push('');
  return lines;
}

function optionTableLines(cmd: ManifestCommand): string[] {
  const leaves = allLeafOptions(cmd);
  if (leaves.length === 0) return [];
  const lines = [
    '| Option | Path | Type | Required | Autocomplete |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const leaf of leaves) {
    const required = leaf.option.required === true ? 'yes' : 'no';
    const autocomplete = leaf.option.autocomplete === true ? 'yes' : 'no';
    lines.push(
      `| \`${leaf.option.name}\` | \`${leaf.path}\` | ${optionTypeName(leaf.option.type)} | ${required} | ${autocomplete} |`
    );
  }
  lines.push('');
  return lines;
}

function renderCommandMarkdown(cmd: ManifestCommand): string[] {
  const badges = handlerBadges(cmd).trim();
  return [
    `### /${cmd.name} ${badges}`.trim(),
    '',
    cmd.description,
    '',
    ...subcommandTableLines(cmd),
    ...optionTableLines(cmd),
  ];
}

export function renderMarkdown(manifest: CommandManifest): string {
  const lines: string[] = ['# Slash Command Surface', ''];
  for (const [category, cmds] of groupByCategory(manifest.commands)) {
    lines.push(`## ${category}`, '');
    for (const cmd of cmds) lines.push(...renderCommandMarkdown(cmd));
  }
  return lines.join('\n').trimEnd() + '\n';
}
