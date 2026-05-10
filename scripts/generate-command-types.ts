#!/usr/bin/env tsx
/**
 * Generate Type-Safe Command Option Schemas
 *
 * Scans all command files for SlashCommandBuilder definitions and extracts
 * option names, types, and required status to generate type-safe schemas.
 *
 * Usage:
 *   pnpm generate:command-types
 *
 * Output:
 *   packages/common-types/src/generated/commandOptions.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

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
 * Extract options from an option chain
 * Looks for patterns like:
 *   .setName('personality')
 *   .setRequired(true)
 */
function extractOptionFromChain(chain: string): ExtractedOption | null {
  // Extract option name
  const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(chain);
  if (!nameMatch) return null;

  // Extract required status (defaults to false if not specified)
  const requiredMatch = /\.setRequired\((true|false)\)/.exec(chain);
  const required = requiredMatch ? requiredMatch[1] === 'true' : false;

  // Determine type from the method that starts this chain
  let type: ExtractedOption['type'] = 'string';
  for (const [method, optType] of Object.entries(optionMethodToType)) {
    if (chain.includes(method)) {
      type = optType;
      break;
    }
  }

  return {
    name: nameMatch[1],
    type,
    required,
  };
}

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

  let match;
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
    let match;
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
  let importMatch;
  while ((importMatch = importRegex.exec(parentContent)) !== null) {
    const specs = importMatch[1].split(',').map(s => s.trim());
    for (const spec of specs) {
      // `original as alias` → split on " as ", trim each
      const [orig, alias] = spec.split(/\s+as\s+/).map(s => s.trim());
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
 * Parse a command file and extract command structure
 */
function parseCommandFile(filePath: string): ExtractedCommand | null {
  const content = fs.readFileSync(filePath, 'utf-8');

  // Find command name from SlashCommandBuilder
  const commandNameMatch = /new SlashCommandBuilder\(\)[\s\S]*?\.setName\(['"]([^'"]+)['"]\)/.exec(
    content
  );
  if (!commandNameMatch) return null;

  const commandName = commandNameMatch[1];
  const subcommands: ExtractedSubcommand[] = [];
  const commandOptions: ExtractedOption[] = [];

  // Track positions of subcommand groups to exclude from direct subcommand search
  const groupRanges: Array<{ start: number; end: number }> = [];

  // First, find all subcommand groups
  const groupRegex = /\.addSubcommandGroup\s*\(/g;
  let groupMatch;
  while ((groupMatch = groupRegex.exec(content)) !== null) {
    const groupBlock = findBalancedBlock(content, groupMatch.index + groupMatch[0].length - 1);
    if (groupBlock) {
      groupRanges.push({
        start: groupMatch.index,
        end: groupMatch.index + groupMatch[0].length + groupBlock.length + 1,
      });
      const group = extractSubcommandGroup(groupBlock, filePath);
      if (group) {
        subcommands.push(...group.subcommands);
      }
    }
  }

  // Find all standalone subcommand definitions (not in groups)
  const subcommandRegex = /\.addSubcommand\s*\(/g;
  let match;
  while ((match = subcommandRegex.exec(content)) !== null) {
    // Check if this subcommand is inside a group
    const isInGroup = groupRanges.some(
      range => match.index > range.start && match.index < range.end
    );
    if (isInGroup) continue;

    const subcommandBlock = findBalancedBlock(content, match.index + match[0].length - 1);
    if (subcommandBlock) {
      const subcommand = extractSubcommand(subcommandBlock);
      if (subcommand) {
        subcommands.push(subcommand);
      }
    }
  }

  // If no subcommands, look for options at the command level
  // Use balanced parenthesis matching (like subcommands) to handle nested parens in option chains
  if (subcommands.length === 0) {
    const optionMethodRegex =
      /\.(addStringOption|addIntegerOption|addNumberOption|addBooleanOption|addUserOption|addChannelOption|addRoleOption|addAttachmentOption|addMentionableOption)\s*\(/g;

    let optMatch;
    while ((optMatch = optionMethodRegex.exec(content)) !== null) {
      const method = optMatch[1];
      const optionBlock = findBalancedBlock(content, optMatch.index + optMatch[0].length - 1);

      const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(optionBlock);
      if (nameMatch) {
        const requiredMatch = /\.setRequired\((true|false)\)/.exec(optionBlock);
        commandOptions.push({
          name: nameMatch[1],
          type: optionMethodToType[method] ?? 'string',
          required: requiredMatch ? requiredMatch[1] === 'true' : false,
        });
      }
    }
  }

  return {
    name: commandName,
    subcommands,
    options: commandOptions,
  };
}

/**
 * Convert a string to camelCase, handling hyphens
 */
function toCamelCase(str: string): string {
  return str.replace(/-(\w)/g, (_, c) => c.toUpperCase());
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
 * Generate the output TypeScript file
 */
function generateOutput(commands: ExtractedCommand[]): string {
  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY',
    ' *',
    ' * Generated by: pnpm generate:command-types',
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

        const identifier = toIdentifier(command.name, subcommand.name, subcommand.group);
        const optionNames = subcommand.options.map(o => o.name).join(', ');
        const pathParts = [command.name];
        if (subcommand.group) pathParts.push(subcommand.group);
        pathParts.push(subcommand.name);

        lines.push(`/**`);
        lines.push(` * /${pathParts.join(' ')} <${optionNames}>`);
        lines.push(` */`);
        lines.push(`export const ${identifier} = defineTypedOptions({`);

        for (const option of subcommand.options) {
          const propName = formatPropertyName(option.name);
          lines.push(`  ${propName}: { type: '${option.type}', required: ${option.required} },`);
        }

        lines.push(`});`);
        lines.push('');
      }
    } else if (command.options.length > 0) {
      const identifier = toIdentifier(command.name);
      const optionNames = command.options.map(o => o.name).join(', ');

      lines.push(`/**`);
      lines.push(` * /${command.name} <${optionNames}>`);
      lines.push(` */`);
      lines.push(`export const ${identifier} = defineTypedOptions({`);

      for (const option of command.options) {
        const propName = formatPropertyName(option.name);
        lines.push(`  ${propName}: { type: '${option.type}', required: ${option.required} },`);
      }

      lines.push(`});`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log('Generating type-safe command options...\n');

  const commandsDir = path.join(projectRoot, 'services/bot-client/src/commands');
  const outputPath = path.join(
    projectRoot,
    'packages/common-types/src/generated/commandOptions.ts'
  );

  // Find all command index files
  const commandDirs = fs
    .readdirSync(commandsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const commands: ExtractedCommand[] = [];

  for (const dir of commandDirs) {
    const indexPath = path.join(commandsDir, dir, 'index.ts');
    if (!fs.existsSync(indexPath)) continue;

    console.log(`  Parsing /${dir}...`);
    const command = parseCommandFile(indexPath);
    if (command) {
      const optionCount =
        command.options.length +
        command.subcommands.reduce((sum, sc) => sum + sc.options.length, 0);
      console.log(`    Found ${command.subcommands.length} subcommands, ${optionCount} options`);
      commands.push(command);
    }
  }

  console.log(`\nParsed ${commands.length} commands`);

  // Generate output
  const output = generateOutput(commands);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(outputPath, output, 'utf-8');
  console.log(`\nGenerated: ${path.relative(projectRoot, outputPath)}`);

  // Count generated schemas
  const schemaCount = (output.match(/export const \w+Options/g) ?? []).length;
  console.log(`Total schemas: ${schemaCount}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
