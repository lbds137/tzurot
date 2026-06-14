/**
 * Commands Audit — shared core
 *
 * Manifest types, the option-type vocabulary, and structure helpers shared by
 * the checks (`commandsAuditChecks.ts`) and the renderers
 * (`commandsAuditRender.ts`). Kept dependency-free of those two so neither
 * forms an import cycle through the main module.
 */

// ── Manifest shape (mirrors commandManifest.test.ts output) ──────────────────

/** Discord application command option JSON (subset we read). */
export interface ManifestOption {
  type: number;
  name: string;
  description?: string;
  required?: boolean;
  autocomplete?: boolean;
  choices?: { name: string; value: string | number }[];
  options?: ManifestOption[];
}

export interface ManifestCommandData {
  name: string;
  description: string;
  /**
   * Discord ApplicationCommandType — `1` (ChatInput) for every slash command we
   * emit. `SlashCommandBuilder.toJSON()` always includes it, so the manifest
   * always carries it; it's optional here only because no consumer reads it.
   */
  type?: number;
  options?: ManifestOption[];
}

export interface ManifestCommand {
  name: string;
  category?: string;
  description: string;
  handlers: {
    execute: boolean;
    autocomplete: boolean;
    selectMenu: boolean;
    button: boolean;
    modal: boolean;
  };
  componentPrefixes: string[];
  data: ManifestCommandData;
}

export interface CommandManifest {
  generatedNote?: string;
  helpCategories: string[];
  commands: ManifestCommand[];
}

// ── Findings ─────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warn';

export interface Finding {
  command: string;
  severity: Severity;
  rule: string;
  detail: string;
}

export interface CommandsAuditOptions {
  format?: 'tree' | 'md' | 'json';
  summary?: boolean;
  /**
   * @internal Canary-test seam. Override the manifest path. Production callers
   * omit this; it resolves to `services/bot-client/command-manifest.json`
   * under `rootDir`.
   */
  manifestPath?: string;
  /**
   * @internal Canary-test seam. Override the working directory the tool
   * resolves the manifest path against. Defaults to `process.cwd()`.
   */
  rootDir?: string;
}

// Discord ApplicationCommandOptionType numeric values we care about.
export const OPTION_TYPE = {
  SUBCOMMAND: 1,
  SUBCOMMAND_GROUP: 2,
} as const;

export const OPTION_TYPE_NAMES: Record<number, string> = {
  1: 'subcommand',
  2: 'group',
  3: 'string',
  4: 'integer',
  5: 'boolean',
  6: 'user',
  7: 'channel',
  8: 'role',
  9: 'mentionable',
  10: 'number',
  11: 'attachment',
};

/** Human-readable name for an option type, with a stable fallback. */
export function optionTypeName(type: number): string {
  return OPTION_TYPE_NAMES[type] ?? `type${type}`;
}

// ── Structure helpers ────────────────────────────────────────────────────────

export function topLevelOptions(cmd: ManifestCommand): ManifestOption[] {
  return cmd.data.options ?? [];
}

export function isSubcommand(opt: ManifestOption): boolean {
  return opt.type === OPTION_TYPE.SUBCOMMAND;
}

export function isSubcommandGroup(opt: ManifestOption): boolean {
  return opt.type === OPTION_TYPE.SUBCOMMAND_GROUP;
}

/** Leaf options (string/int/etc.) are everything that's not a subcommand(-group). */
export function isLeafOption(opt: ManifestOption): boolean {
  return !isSubcommand(opt) && !isSubcommandGroup(opt);
}

/** All subcommand names across a command (including those nested in groups). */
export function allSubcommands(cmd: ManifestCommand): { name: string; description?: string }[] {
  const out: { name: string; description?: string }[] = [];
  for (const opt of topLevelOptions(cmd)) {
    if (isSubcommand(opt)) {
      out.push({ name: opt.name, description: opt.description });
    } else if (isSubcommandGroup(opt)) {
      for (const sub of opt.options ?? []) {
        if (isSubcommand(sub)) {
          out.push({ name: sub.name, description: sub.description });
        }
      }
    }
  }
  return out;
}

/** All leaf options (with their owning subcommand path) across a command. */
export interface LeafOptionRef {
  command: string;
  path: string; // e.g. "memory edit" or "memory" for top-level
  option: ManifestOption;
}

export function allLeafOptions(cmd: ManifestCommand): LeafOptionRef[] {
  const out: LeafOptionRef[] = [];
  const collect = (opts: ManifestOption[], path: string): void => {
    for (const opt of opts) {
      if (isLeafOption(opt)) {
        out.push({ command: cmd.name, path, option: opt });
      } else if ((isSubcommand(opt) || isSubcommandGroup(opt)) && opt.options) {
        collect(opt.options, `${path} ${opt.name}`.trim());
      }
    }
  };
  collect(topLevelOptions(cmd), cmd.name);
  return out;
}

/** Group commands by their display category (undefined → "Other"), for renderers. */
export function groupByCategory(commands: ManifestCommand[]): [string, ManifestCommand[]][] {
  const byCategory = new Map<string, ManifestCommand[]>();
  for (const cmd of commands) {
    const cat = cmd.category ?? 'Other';
    const list = byCategory.get(cat) ?? [];
    list.push(cmd);
    byCategory.set(cat, list);
  }
  return [...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, cmds]) => [cat, cmds.sort((a, b) => a.name.localeCompare(b.name))]);
}
