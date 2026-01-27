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
 * Extract subcommand group name and its subcommands
 */
function extractSubcommandGroup(
  block: string
): { name: string; subcommands: ExtractedSubcommand[] } | null {
  // Extract group name
  const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(block);
  if (!nameMatch) return null;

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
      const group = extractSubcommandGroup(groupBlock);
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
  if (subcommands.length === 0) {
    const optionBlocks = content.matchAll(
      /\.(addStringOption|addIntegerOption|addNumberOption|addBooleanOption|addUserOption|addChannelOption|addRoleOption|addAttachmentOption|addMentionableOption)\s*\(\s*(?:option\s*=>|function\s*\(option\))\s*([\s\S]*?)\s*\)/g
    );

    for (const optMatch of optionBlocks) {
      const [, method, optionChain] = optMatch;
      const nameMatch = /\.setName\(['"]([^'"]+)['"]\)/.exec(optionChain);
      if (nameMatch) {
        const requiredMatch = /\.setRequired\((true|false)\)/.exec(optionChain);
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
    ` * Generated at: ${new Date().toISOString()}`,
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
