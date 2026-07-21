/**
 * Command-path utilities for /help.
 *
 * Flattens a command's option tree into the discrete invocation paths users
 * actually see in Discord's slash-command picker (e.g. "admin presence set",
 * "admin presence set"), and resolves a typed/selected help value back to a
 * command overview or a single subcommand.
 *
 * Option types are read via the builder's `toJSON()` output. The live
 * `SlashCommandBuilder` exposes an option's `.name` but NOT a numeric `.type`
 * on its raw `.options` entries — `type` is only populated by `toJSON()`. So
 * reading the raw array would classify every subcommand as "not a subcommand"
 * and the picker would surface nothing. Plain-object test fixtures that already
 * carry `type` are read directly via the fallback.
 */
import type { Command } from '../../types.js';

/** Discord application-command option-type discriminators. */
const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;

/** Normalized option node — the subset of the `toJSON()` shape we consume. */
export interface CommandOptionNode {
  type?: number;
  name?: string;
  description?: string;
  options?: CommandOptionNode[];
}

/** One discrete, invocable command path plus its description. */
export interface CommandLeaf {
  /** Space-joined path, e.g. "memory facts" or "admin presence set". */
  path: string;
  description: string;
}

/**
 * Read a command's option tree, preferring `toJSON()` (which populates option
 * `type`) and falling back to a raw `.options` array for plain-object fixtures.
 */
export function getCommandOptions(command: Command): CommandOptionNode[] {
  const data = command.data as {
    toJSON?: () => { options?: CommandOptionNode[] };
    options?: CommandOptionNode[];
  };
  const source = typeof data.toJSON === 'function' ? data.toJSON() : data;
  return Array.isArray(source.options) ? source.options : [];
}

/**
 * Flatten a command into its leaf invocation paths — one per subcommand,
 * expanding subcommand groups as "group sub". A command with no subcommands
 * yields a single leaf: its own name (e.g. "help", "inspect").
 */
export function flattenCommandLeaves(command: Command): CommandLeaf[] {
  const name = command.data.name;
  const leaves: CommandLeaf[] = [];

  for (const opt of getCommandOptions(command)) {
    if (opt.type === SUBCOMMAND_GROUP && Array.isArray(opt.options)) {
      for (const sub of opt.options) {
        if (sub.type === SUBCOMMAND) {
          leaves.push({
            path: `${name} ${opt.name} ${sub.name}`,
            description: sub.description ?? '',
          });
        }
      }
    } else if (opt.type === SUBCOMMAND) {
      leaves.push({ path: `${name} ${opt.name}`, description: opt.description ?? '' });
    }
  }

  if (leaves.length === 0) {
    leaves.push({ path: name, description: command.data.description });
  }
  return leaves;
}

/** Result of resolving a /help command value. */
export type HelpTarget =
  | { kind: 'unknown' }
  | { kind: 'overview'; command: Command }
  | { kind: 'subcommand'; command: Command; label: string; option: CommandOptionNode };

/**
 * Resolve a /help value ("character", "memory facts", "admin presence set")
 * to a command overview, a single subcommand, or unknown. The value mirrors
 * the leaf `path` emitted by {@link flattenCommandLeaves}, so an autocomplete
 * pick always resolves to a concrete target.
 */
export function resolveHelpTarget(commands: Map<string, Command>, value: string): HelpTarget {
  const parts = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(part => part.length > 0);
  if (parts.length === 0) {
    return { kind: 'unknown' };
  }

  const command = commands.get(parts[0]);
  if (command === undefined) {
    return { kind: 'unknown' };
  }
  if (parts.length === 1) {
    return { kind: 'overview', command };
  }

  const options = getCommandOptions(command);
  if (parts.length === 2) {
    const sub = options.find(opt => opt.type === SUBCOMMAND && opt.name === parts[1]);
    return sub === undefined
      ? { kind: 'unknown' }
      : { kind: 'subcommand', command, label: `${command.data.name} ${sub.name}`, option: sub };
  }

  // parent group sub
  const group = options.find(opt => opt.type === SUBCOMMAND_GROUP && opt.name === parts[1]);
  const sub = group?.options?.find(opt => opt.type === SUBCOMMAND && opt.name === parts[2]);
  return group === undefined || sub === undefined
    ? { kind: 'unknown' }
    : {
        kind: 'subcommand',
        command,
        label: `${command.data.name} ${group.name} ${sub.name}`,
        option: sub,
      };
}
