/**
 * Commands Audit — consistency checks
 *
 * Each check takes the manifest and returns findings. `runChecks` composes them.
 * Severity: `error` gates CI (exit non-zero); `warn` is surfaced but non-gating.
 */

import {
  type CommandManifest,
  type Finding,
  type ManifestOption,
  allLeafOptions,
  allSubcommands,
  isSubcommand,
  isSubcommandGroup,
  optionTypeName,
  topLevelOptions,
} from './commandsAuditCore.js';

// Canonical CRUD subcommand vocabulary from `.claude/rules/04-discord.md`
// (browse/view/create/edit/delete/list), plus the established domain verbs the
// command surface already uses consistently. The goal is a CONSERVATIVE check:
// it should surface genuinely-novel verbs (a new command inventing its own word
// for an existing concept) and the legacy `list`, NOT cry wolf on every
// well-understood action. Add a verb here when it's deliberately adopted across
// the surface; leaving a truly one-off name un-listed is the intended signal.
// To find candidates that currently trip the warning, run
// `pnpm ops commands:audit` and read the `[subcommand-naming]` findings.
const KNOWN_SUBCOMMAND_NAMES = new Set<string>([
  // 04-discord.md canonical set
  'browse',
  'view',
  'create',
  'edit',
  'delete',
  'list', // legacy — handled specially below (warns toward `browse`)
  // config-route conventions (LLM/TTS settings) + the config-cascade
  // get/set/set-default/clear-default family used consistently by /settings
  // and /voice (read a value, set the per-scope default, clear it).
  'default',
  'free-default',
  'settings',
  'get',
  'set-default',
  'clear-default',
  // established add/remove pair (deny, etc.)
  'add',
  'remove',
  // established enable/disable/status triad (memory, etc.)
  'enable',
  'disable',
  'status',
  'stats',
  // established lifecycle / utility verbs in active use
  'clear',
  'undo',
  'import',
  'export',
  'template',
  // /character chat-mode verbs (chat / random / chime-in) — deliberate, established
  'chat',
  'random',
  'chime-in',
  'overrides',
  'activate',
  'deactivate',
  'ping',
  'health',
  'metrics',
  'usage',
  'cleanup',
  'presence',
  'avatar',
  'avatar-clear',
  'voice',
  'voice-clear',
  'kick',
  'servers',
  'db-sync',
  'purge',
  'search',
  'hard-delete',
  'test',
  'set',
  // noun subcommands opening a second browsable entity under one command
  // (/memory browse = episodes, /memory facts = extracted facts)
  'facts',
  // domain-specific verbs with no canonical CRUD equivalent
  'forget', // memory: retroactive/incognito deletion, distinct from `delete`
  'auth', // shapes: third-party integration sign-in
  'logout', // shapes: third-party integration sign-out
]);

// Catches placeholder/meta-note descriptions. `todo`/`tbd`/`xxx` are virtually
// never the start of a real description, so a leading-word match is safe and
// still flags "TODO: fix later". `test`, by contrast, is a common imperative
// verb ("Test your API key validity"), so it's only flagged as the WHOLE
// description — a bare "test" — to avoid the false positive.
const STUB_DESCRIPTION_RE = /^(todo|tbd|xxx)\b|^test$/i;
const STUB_DESCRIPTION_MIN_LENGTH = 12;

// Near-synonym option-name clusters: names that tend to denote the same concept.
// Conservative by design — only flags when BOTH names appear in the surface.
const SYNONYM_CLUSTERS: string[][] = [
  ['preset', 'config'],
  ['persona', 'profile'],
];

// Option names whose cross-command TYPE drift is deliberate and accepted, so the
// type-conflict drift check below skips them instead of crying wolf on every run. `type` is
// a genuinely different concept per command — `admin presence <type>` is an integer
// status-enum; `deny add <type>` is a string target-kind — and unifying them would be
// artificial. Add a name here only when the drift is intentional AND documented.
const ACCEPTED_OPTION_TYPE_DRIFT = new Set<string>(['type']);

function isStubDescription(desc: string): boolean {
  const trimmed = desc.trim();
  return trimmed.length < STUB_DESCRIPTION_MIN_LENGTH || STUB_DESCRIPTION_RE.test(trimmed);
}

/** category-coverage (error): command.category must be a named /help category. */
function checkCategoryCoverage(manifest: CommandManifest): Finding[] {
  // A command whose category isn't a named /help category silently buckets to
  // "Other" — exclude "Other" from the valid set so that's flagged.
  const valid = new Set(manifest.helpCategories.filter(c => c !== 'Other'));
  const findings: Finding[] = [];
  for (const cmd of manifest.commands) {
    if (cmd.category === undefined) {
      findings.push({
        command: cmd.name,
        severity: 'error',
        rule: 'category-coverage',
        detail: `Command has no category; it will silently bucket to "Other" in /help.`,
      });
    } else if (!valid.has(cmd.category)) {
      findings.push({
        command: cmd.name,
        severity: 'error',
        rule: 'category-coverage',
        detail: `Category "${cmd.category}" is not a named /help category — it silently buckets to "Other". Add it to CATEGORY_CONFIG in commands/help/index.ts.`,
      });
    }
  }
  return findings;
}

/** Push an error (empty) or warn (stub) finding for one labelled description. */
function checkOneDescription(
  findings: Finding[],
  command: string,
  label: string,
  desc: string | undefined
): void {
  if (desc === undefined || desc.trim() === '') {
    findings.push({
      command,
      severity: 'error',
      rule: 'description-presence',
      detail: `${label} has an empty description.`,
    });
    return;
  }
  if (isStubDescription(desc)) {
    findings.push({
      command,
      severity: 'warn',
      rule: 'description-presence',
      detail: `${label} has a stub-like description: "${desc}".`,
    });
  }
}

/**
 * Recursively visit an option (subcommand-group / subcommand / leaf) and its
 * children, checking each description. Recursion keeps the per-function nesting
 * flat — `parentPath` is the chain of enclosing subcommand/group names.
 */
function walkOptionDescriptions(
  findings: Finding[],
  command: string,
  parentPath: string[],
  opt: ManifestOption
): void {
  const isGroup = isSubcommandGroup(opt);
  const isSub = isSubcommand(opt);
  const kind = isGroup ? 'Group' : isSub ? 'Subcommand' : 'Option';
  const label =
    kind === 'Option'
      ? `Option /${[command, ...parentPath].join(' ')} <${opt.name}>`
      : `${kind} /${[command, ...parentPath, opt.name].join(' ')}`;
  checkOneDescription(findings, command, label, opt.description);

  const childPath = isGroup || isSub ? [...parentPath, opt.name] : parentPath;
  for (const child of opt.options ?? []) {
    walkOptionDescriptions(findings, command, childPath, child);
  }
}

/** description-presence (error: empty; warn: stub-like). */
function checkDescriptions(manifest: CommandManifest): Finding[] {
  const findings: Finding[] = [];
  for (const cmd of manifest.commands) {
    checkOneDescription(findings, cmd.name, `Command /${cmd.name}`, cmd.description);
    for (const opt of topLevelOptions(cmd)) {
      walkOptionDescriptions(findings, cmd.name, [], opt);
    }
  }
  return findings;
}

/** subcommand-naming (warn): names outside the canonical vocabulary. */
function checkSubcommandNaming(manifest: CommandManifest): Finding[] {
  const findings: Finding[] = [];
  for (const cmd of manifest.commands) {
    for (const sub of allSubcommands(cmd)) {
      if (sub.name === 'list') {
        findings.push({
          command: cmd.name,
          severity: 'warn',
          rule: 'subcommand-naming',
          detail: `Subcommand "list" is legacy — "browse" (with a select menu) is preferred for new commands.`,
        });
      } else if (!KNOWN_SUBCOMMAND_NAMES.has(sub.name)) {
        findings.push({
          command: cmd.name,
          severity: 'warn',
          rule: 'subcommand-naming',
          detail: `Subcommand "${sub.name}" is outside the known subcommand vocabulary. If it's a deliberate verb, add it to KNOWN_SUBCOMMAND_NAMES in commandsAuditChecks.ts; otherwise standardize on an existing one.`,
        });
      }
    }
  }
  return findings;
}

/**
 * option-name-drift (warn): conservative cross-command consistency check.
 *  (a) The same option name carrying different Discord types across commands.
 *  (b) Near-synonym names used for the same concept (both present in surface).
 */
function checkOptionNameDrift(manifest: CommandManifest): Finding[] {
  const findings: Finding[] = [];

  // name -> (type -> example paths)
  const byName = new Map<string, Map<number, string[]>>();
  const presentNames = new Set<string>();

  for (const cmd of manifest.commands) {
    for (const ref of allLeafOptions(cmd)) {
      const { name, type } = ref.option;
      presentNames.add(name);
      const typeMap = byName.get(name) ?? new Map<number, string[]>();
      const paths = typeMap.get(type) ?? [];
      paths.push(`${ref.path} <${name}>`);
      typeMap.set(type, paths);
      byName.set(name, typeMap);
    }
  }

  // (a) type conflicts
  for (const [name, typeMap] of byName) {
    if (typeMap.size > 1 && !ACCEPTED_OPTION_TYPE_DRIFT.has(name)) {
      const detailParts = [...typeMap.entries()].map(
        ([type, paths]) => `${optionTypeName(type)} (${paths[0]})`
      );
      findings.push({
        command: '(cross-command)',
        severity: 'warn',
        rule: 'option-name-drift',
        detail: `Option name "${name}" carries different types across commands: ${detailParts.join(', ')}.`,
      });
    }
  }

  // (b) near-synonym usage
  for (const cluster of SYNONYM_CLUSTERS) {
    const present = cluster.filter(n => presentNames.has(n));
    if (present.length > 1) {
      findings.push({
        command: '(cross-command)',
        severity: 'warn',
        rule: 'option-name-drift',
        detail: `Near-synonym option names used for the same concept: ${present.join(' / ')}. Standardize on one.`,
      });
    }
  }

  return findings;
}

/**
 * component-handler-completeness (error): a command that participates in
 * component routing (declares componentPrefixes OR exports a button/select-menu
 * handler) must export the corresponding handlers. Pure data check from the
 * manifest handler flags + prefixes.
 */
function checkComponentHandlerCompleteness(manifest: CommandManifest): Finding[] {
  const findings: Finding[] = [];
  for (const cmd of manifest.commands) {
    // Only the prefixes-without-handlers direction is a defect: a command that
    // declares componentPrefixes but exports no button/select handler drops its
    // component interactions. The reverse (handlers without declared prefixes)
    // is legitimate — a handler can match on its own customId convention — so
    // it is intentionally not flagged here.
    const declaresPrefixes = cmd.componentPrefixes.length > 0;
    const hasHandlers = cmd.handlers.button || cmd.handlers.selectMenu;
    if (declaresPrefixes && !hasHandlers) {
      findings.push({
        command: cmd.name,
        severity: 'error',
        rule: 'component-handler-completeness',
        detail: `Declares componentPrefixes (${cmd.componentPrefixes.join(', ')}) but exports neither handleButton nor handleSelectMenu — component interactions will be dropped.`,
      });
    }
  }
  return findings;
}

export function runChecks(manifest: CommandManifest): Finding[] {
  return [
    ...checkCategoryCoverage(manifest),
    ...checkDescriptions(manifest),
    ...checkSubcommandNaming(manifest),
    ...checkOptionNameDrift(manifest),
    ...checkComponentHandlerCompleteness(manifest),
  ];
}
