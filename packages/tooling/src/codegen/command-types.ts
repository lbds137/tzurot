/**
 * Command-option schema codegen.
 *
 * Scans the bot-client command files for SlashCommandBuilder definitions and
 * extracts option names, types, and required status to generate the type-safe
 * schemas in `packages/common-types/src/generated/commandOptions.ts`. Exposed
 * as `pnpm ops codegen:command-types` (with `--check` for CI drift detection).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_REL_PATH = 'packages/common-types/src/generated/commandOptions.ts';
const COMMANDS_REL_DIR = 'services/bot-client/src/commands';

interface ExtractedOption {
  name: string;
  type:
    | 'string'
    | 'integer'
    | 'number'
    | 'boolean'
    | 'user'
    | 'channel'
    | 'role'
    | 'attachment'
    | 'mentionable';
  required: boolean;
}

interface ExtractedSubcommand {
  name: string;
  /** Group name if this is part of a subcommand group */
  group?: string;
  options: ExtractedOption[];
}

interface ExtractedCommand {
  name: string;
  subcommands: ExtractedSubcommand[];
  /** Options at command level (commands without subcommands) */
  options: ExtractedOption[];
}

/**
 * Map Discord.js option method to our type system
 */
const optionMethodToType: Record<string, ExtractedOption['type']> = {
  addStringOption: 'string',
  addIntegerOption: 'integer',
  addNumberOption: 'number',
  addBooleanOption: 'boolean',
  addUserOption: 'user',
  addChannelOption: 'channel',
  addRoleOption: 'role',
  addAttachmentOption: 'attachment',
  addMentionableOption: 'mentionable',
};

/**
 * Find a balanced block starting from a position
 * Returns the content between ( and ) accounting for nesting
 */
function findBalancedBlock(content: string, startIndex: number): string {
  let depth = 0;
  let start = -1;

  for (let i = startIndex; i < content.length; i++) {
    if (content[i] === '(') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (content[i] === ')') {
      depth--;
      if (depth === 0) {
        return content.slice(start, i);
      }
    }
  }

  return '';
}

/**
 * Extract all options from a subcommand block
 */
function extractOptionsFromBlock(block: string): ExtractedOption[] {
  const options: ExtractedOption[] = [];

  // Find each option method call
  const optionMethodRegex =
    /\.(addStringOption|addIntegerOption|addNumberOption|addBooleanOption|addUserOption|addChannelOption|addRoleOption|addAttachmentOption|addMentionableOption)\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = optionMethodRegex.exec(block)) !== null) {
    const method = match[1];
    const optionBlock = findBalancedBlock(block, match.index + match[0].length - 1);

    const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(optionBlock);
    if (nameMatch) {
      const requiredMatch = /\.setRequired\((true|false)\)/.exec(optionBlock);
      options.push({
        name: nameMatch[1],
        type: optionMethodToType[method] ?? 'string',
        required: requiredMatch ? requiredMatch[1] === 'true' : false,
      });
    }
  }

  return options;
}

/**
 * Extract subcommand name and its options from a subcommand chain
 */
function extractSubcommand(chain: string): ExtractedSubcommand | null {
  // Extract subcommand name
  const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(chain);
  if (!nameMatch) return null;

  const options = extractOptionsFromBlock(chain);

  return {
    name: nameMatch[1],
    options,
  };
}

/**
 * Maximum depth for the function-reference resolution chain. Bounds the
 * recursive `extractSubcommandGroup → resolveAndParseBuilderFunction` walk
 * so a future delegation chain (builder A delegating to builder B
 * delegating to builder C, etc.) can't accidentally hang the generator.
 * Five levels is generous — current builders are flat, and any real-world
 * chain that exceeds this is suspect.
 */
const MAX_BUILDER_DEPTH = 5;

/**
 * Extract subcommand group name and its subcommands.
 *
 * Two shapes are supported:
 *   1. Inline arrow:  `addSubcommandGroup(group => group.setName(...).addSubcommand(...))`
 *   2. Function ref:  `addSubcommandGroup(buildTtsSubcommandGroup)` — resolves
 *      the import to find the builder function's source file and parses it.
 *
 * The function-ref path requires `parentFilePath` so we can resolve relative
 * imports. Without it, function refs are silently skipped.
 *
 * `depth` bounds the function-ref resolution chain (see MAX_BUILDER_DEPTH).
 */
function extractSubcommandGroup(
  block: string,
  parentFilePath?: string,
  depth = 0
): { name: string; subcommands: ExtractedSubcommand[] } | null {
  // Inline path: block contains a setName + addSubcommand chain
  const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(block);
  if (nameMatch) {
    const groupName = nameMatch[1];
    const subcommands: ExtractedSubcommand[] = [];

    // Find subcommands within this group
    const subcommandRegex = /\.addSubcommand\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = subcommandRegex.exec(block)) !== null) {
      const subcommandBlock = findBalancedBlock(block, match.index + match[0].length - 1);
      if (subcommandBlock) {
        const subcommand = extractSubcommand(subcommandBlock);
        if (subcommand) {
          subcommand.group = groupName;
          subcommands.push(subcommand);
        }
      }
    }

    return { name: groupName, subcommands };
  }

  // Function-reference path: block is just an identifier like
  // `buildTtsSubcommandGroup`. Resolve via the parent file's imports.
  const funcRefMatch = /^\s*(\w+)\s*$/.exec(block);
  if (funcRefMatch && parentFilePath) {
    if (depth >= MAX_BUILDER_DEPTH) {
      console.warn(
        `[generate-command-types] Builder-resolution depth exceeded ` +
          `(${MAX_BUILDER_DEPTH}) for ${funcRefMatch[1]} in ${parentFilePath} — ` +
          `dropping group. Suspect a delegation chain.`
      );
      return null;
    }
    return resolveAndParseBuilderFunction(funcRefMatch[1], parentFilePath, depth + 1);
  }

  return null;
}

/**
 * Resolve a subcommand-group builder function reference (e.g.
 * `buildTtsSubcommandGroup`) to its source file via the parent file's
 * import statements, then parse the function body for the
 * setName + addSubcommand chain.
 *
 * `depth` is threaded through to the recursive `extractSubcommandGroup`
 * call to bound delegation chains (see MAX_BUILDER_DEPTH).
 */
function resolveAndParseBuilderFunction(
  funcName: string,
  parentFilePath: string,
  depth = 0
): { name: string; subcommands: ExtractedSubcommand[] } | null {
  const parentContent = fs.readFileSync(parentFilePath, 'utf-8');

  // Find the import for funcName. Handles both:
  //   import { funcName } from './foo.js';
  //   import { originalName as funcName } from './foo.js';   ← aliased
  // For aliased imports we need to resolve to the *original* name in the
  // builder file, since `funcDefRegex` below searches for `export ... <name>`.
  const importRegex = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]([^'"]+)['"]`, 'mg');
  let originalName = funcName;
  let importPath: string | null = null;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(parentContent)) !== null) {
    const specs = importMatch[1].split(',').map(s => s.trim());
    for (const spec of specs) {
      // `original as alias` → split on " as ", trim each
      const [orig, alias] = spec.split(' as ').map(s => s.trim());
      const localName = alias ?? orig;
      if (localName === funcName) {
        originalName = orig;
        importPath = importMatch[2];
        break;
      }
    }
    if (importPath !== null) break;
  }
  if (importPath === null) return null;

  // Resolve relative path; strip the .js suffix and read the .ts source.
  const resolvedPath = path.resolve(
    path.dirname(parentFilePath),
    importPath.replace(/\.js$/, '.ts')
  );
  if (!fs.existsSync(resolvedPath)) return null;

  const builderContent = fs.readFileSync(resolvedPath, 'utf-8');

  // Find the function definition. Two shapes:
  //   export function originalName(...) { ... }
  //   export const originalName = (...) => ...
  const funcDefRegex = new RegExp(`export\\s+(?:function\\s+|const\\s+)${originalName}\\b`);
  const funcDefMatch = funcDefRegex.exec(builderContent);
  if (!funcDefMatch) {
    console.warn(
      `[generate-command-types] Resolved import for "${funcName}" → ` +
        `"${originalName}" in ${resolvedPath} but found no matching ` +
        `\`export function ${originalName}\` or \`export const ${originalName}\`. ` +
        `The subcommand group will be silently dropped from generated output.`
    );
    return null;
  }

  // Pass the rest of the file as the "block" — extractSubcommandGroup's
  // setName + addSubcommand regex will find the right matches inside.
  const tail = builderContent.slice(funcDefMatch.index);
  return extractSubcommandGroup(tail, resolvedPath, depth);
}

/**
 * Collect subcommands nested in `addSubcommandGroup(...)` blocks, recording each
 * group's character range in `groupRanges` so standalone-subcommand scanning can
 * skip them.
 */
function collectGroupSubcommands(
  content: string,
  filePath: string,
  groupRanges: { start: number; end: number }[]
): ExtractedSubcommand[] {
  const subcommands: ExtractedSubcommand[] = [];
  const groupRegex = /\.addSubcommandGroup\s*\(/g;
  let groupMatch: RegExpExecArray | null;
  while ((groupMatch = groupRegex.exec(content)) !== null) {
    const groupBlock = findBalancedBlock(content, groupMatch.index + groupMatch[0].length - 1);
    if (groupBlock) {
      groupRanges.push({
        start: groupMatch.index,
        end: groupMatch.index + groupMatch[0].length + groupBlock.length + 1,
      });
      const group = extractSubcommandGroup(groupBlock, filePath);
      if (group) subcommands.push(...group.subcommands);
    }
  }
  return subcommands;
}

/**
 * Collect top-level `addSubcommand(...)` definitions, skipping any that fall
 * within a subcommand group's range (those were already collected).
 */
function collectStandaloneSubcommands(
  content: string,
  groupRanges: { start: number; end: number }[]
): ExtractedSubcommand[] {
  const subcommands: ExtractedSubcommand[] = [];
  const subcommandRegex = /\.addSubcommand\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = subcommandRegex.exec(content)) !== null) {
    const idx = match.index;
    if (groupRanges.some(range => idx > range.start && idx < range.end)) continue;
    const subcommandBlock = findBalancedBlock(content, idx + match[0].length - 1);
    if (subcommandBlock) {
      const subcommand = extractSubcommand(subcommandBlock);
      if (subcommand) subcommands.push(subcommand);
    }
  }
  return subcommands;
}

/**
 * Parse a command file and extract its command structure (name, subcommands,
 * command-level options).
 */
function parseCommandFile(filePath: string): ExtractedCommand | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  const commandNameMatch = /new SlashCommandBuilder\(\)[\s\S]*?\.setName\(['"]([^'"]+)['"]\)/.exec(
    content
  );
  if (!commandNameMatch) return null;

  const groupRanges: { start: number; end: number }[] = [];
  const subcommands = [
    ...collectGroupSubcommands(content, filePath, groupRanges),
    ...collectStandaloneSubcommands(content, groupRanges),
  ];

  // Command-level options apply only when there are no subcommands (same block
  // shape as a subcommand, so reuse extractOptionsFromBlock).
  const options = subcommands.length === 0 ? extractOptionsFromBlock(content) : [];

  return { name: commandNameMatch[1], subcommands, options };
}

/**
 * Convert a string to camelCase, handling hyphens
 */
function toCamelCase(str: string): string {
  return str.replace(/-(\w)/g, (_: string, c: string) => c.toUpperCase());
}

/**
 * Convert command name, optional group, and subcommand to a valid JavaScript identifier
 */
function toIdentifier(command: string, subcommand?: string, group?: string): string {
  const parts = [command];
  if (group) parts.push(group);
  if (subcommand) parts.push(subcommand);

  return (
    parts
      .map((p, i) => {
        const clean = toCamelCase(p);
        return i === 0 ? clean : clean.charAt(0).toUpperCase() + clean.slice(1);
      })
      .join('') + 'Options'
  );
}

/**
 * Convert option name to valid property (quote if contains hyphens)
 */
function formatPropertyName(name: string): string {
  if (name.includes('-')) {
    return `'${name}'`;
  }
  return name;
}

/**
 * Render one `export const <identifier> = defineTypedOptions({...})` schema
 * block. `pathLabel` is the human-readable command path shown in the JSDoc
 * (e.g. `channel activate` or `tts config set`).
 */
function emitSchema(identifier: string, pathLabel: string, options: ExtractedOption[]): string[] {
  const optionNames = options.map(o => o.name).join(', ');
  const out = [
    `/**`,
    ` * /${pathLabel} <${optionNames}>`,
    ` */`,
    `export const ${identifier} = defineTypedOptions({`,
  ];
  for (const option of options) {
    out.push(
      `  ${formatPropertyName(option.name)}: { type: '${option.type}', required: ${option.required} },`
    );
  }
  out.push(`});`, '');
  return out;
}

/**
 * Generate the output TypeScript file
 */
function generateOutput(commands: ExtractedCommand[]): string {
  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY',
    ' *',
    ' * Generated by: pnpm ops codegen:command-types',
    ' *',
    ' * Type-Safe Command Option Schemas',
    ' *',
    ' * Usage:',
    ' * ```typescript',
    " * import { channelActivateOptions } from '@tzurot/common-types';",
    ' *',
    ' * async function handleActivate(context: SafeCommandContext) {',
    ' *   const options = channelActivateOptions(context.interaction);',
    ' *   const personality = options.personality(); // Type-safe: string',
    ' * }',
    ' * ```',
    ' */',
    '',
    "import { defineTypedOptions } from '../utils/typedOptions.js';",
    '',
  ];

  // Sort commands alphabetically
  const sortedCommands = [...commands].sort((a, b) => a.name.localeCompare(b.name));

  for (const command of sortedCommands) {
    lines.push('// =============================================================================');
    lines.push(`// ${command.name.toUpperCase()} COMMAND`);
    lines.push('// =============================================================================');
    lines.push('');

    if (command.subcommands.length > 0) {
      for (const subcommand of command.subcommands) {
        if (subcommand.options.length === 0) continue;
        const pathParts = [command.name];
        if (subcommand.group) pathParts.push(subcommand.group);
        pathParts.push(subcommand.name);
        const identifier = toIdentifier(command.name, subcommand.name, subcommand.group);
        lines.push(...emitSchema(identifier, pathParts.join(' '), subcommand.options));
      }
    } else if (command.options.length > 0) {
      lines.push(...emitSchema(toIdentifier(command.name), command.name, command.options));
    }
  }

  return lines.join('\n');
}

export interface CommandTypesRunOptions {
  /** Workspace root; defaults to the monorepo root derived from this file. */
  rootDir?: string;
  /** If true, fail with a non-zero exit when the generated file would change. */
  check?: boolean;
}

export interface CommandTypesRunResult {
  /** The output file's absolute path mapped to its generated source text. */
  files: Record<string, string>;
  /** In `check` mode, the path if its on-disk content differs from generated. */
  drifted: string[];
  /** True if the file matched on disk (drift-detection passed). */
  upToDate: boolean;
}

/**
 * Parse the bot-client command files under `rootDir` and return the generated
 * commandOptions source text. Pure (reads command files, writes nothing) so
 * tests can assert on the output.
 */
export function generateCommandOptions(rootDir: string): string {
  const commandsDir = path.join(rootDir, COMMANDS_REL_DIR);
  const commandDirs = fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const commands: ExtractedCommand[] = [];
  for (const dir of commandDirs) {
    const indexPath = path.join(commandsDir, dir, 'index.ts');
    if (!fs.existsSync(indexPath)) continue;
    const command = parseCommandFile(indexPath);
    if (command) commands.push(command);
  }

  return generateOutput(commands);
}

/**
 * Run the command-types codegen against the live command files and either
 * write the generated file or, in `check` mode, report whether it drifts from
 * the committed output.
 */
export function runCommandTypesCodegen(
  options: CommandTypesRunOptions = {}
): CommandTypesRunResult {
  const rootDir = options.rootDir ?? defaultRootDir();
  const outputPath = path.join(rootDir, OUTPUT_REL_PATH);
  const output = generateCommandOptions(rootDir);
  const files = { [outputPath]: output };

  if (options.check === true) {
    const actual = readFileSafe(outputPath);
    const drifted = actual === output ? [] : [outputPath];
    return { files, drifted, upToDate: drifted.length === 0 };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, 'utf-8');
  return { files, drifted: [], upToDate: true };
}

function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function defaultRootDir(): string {
  // codegen/ → src/ → tooling/ → packages/ → repo root (mirrors dist/ layout).
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}
