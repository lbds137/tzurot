/* eslint-disable sonarjs/no-duplicate-string -- pre-existing: option type string literals */
/**
 * Type-Safe Command Option Accessors
 *
 * Provides compile-time type safety for Discord slash command options.
 * Prevents runtime errors from typos in option names like getString('profile')
 * when the option was actually named 'persona'.
 *
 * Usage:
 * ```typescript
 * // Define schema once (typically in a generated file)
 * const channelActivateOptions = defineTypedOptions({
 *   personality: { type: 'string', required: true },
 *   silent: { type: 'boolean', required: false },
 * });
 *
 * // Use in handler
 * const options = channelActivateOptions(context.interaction);
 * const personality = options.personality(); // string (required)
 * const silent = options.silent(); // boolean | null (optional)
 * ```
 */

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * Supported Discord.js option types
 */
type OptionType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'user'
  | 'channel'
  | 'role'
  | 'mentionable'
  | 'attachment';

/**
 * Configuration for a single command option
 */
interface OptionConfig {
  type: OptionType;
  required: boolean;
}

/**
 * Schema defining all options for a command
 */
type OptionSchema = Record<string, OptionConfig>;

/**
 * Return type for option accessor based on config
 * - Required options return the base type
 * - Optional options return base type | null
 */
type OptionReturnType<TConfig extends OptionConfig> = TConfig['required'] extends true
  ? OptionValueType<TConfig['type']>
  : OptionValueType<TConfig['type']> | null;

/**
 * Map option type to its JavaScript value type
 */
type OptionValueType<T extends OptionType> = T extends 'string'
  ? string
  : T extends 'integer' | 'number'
    ? number
    : T extends 'boolean'
      ? boolean
      : T extends 'user'
        ? import('discord.js').User
        : T extends 'channel'
          ? import('discord.js').Channel
          : T extends 'role'
            ? import('discord.js').Role
            : T extends 'mentionable'
              ? import('discord.js').User | import('discord.js').Role
              : T extends 'attachment'
                ? import('discord.js').Attachment
                : never;

/**
 * Typed accessor object for command options
 * Each key becomes a function that retrieves the typed value
 */
type TypedOptionsAccessor<TSchema extends OptionSchema> = {
  [K in keyof TSchema]: () => OptionReturnType<TSchema[K]>;
};

/**
 * Create a typed options accessor factory for a command.
 *
 * @param schema - Object mapping option names to their type and required status
 * @returns A factory function that creates typed accessors for an interaction
 *
 * @example
 * ```typescript
 * const presetSetOptions = defineTypedOptions({
 *   personality: { type: 'string', required: true },
 *   preset: { type: 'string', required: true },
 * });
 *
 * async function handleSet(context: SafeCommandContext) {
 *   const options = presetSetOptions(context.interaction);
 *   const personality = options.personality(); // Type: string
 *   const preset = options.preset(); // Type: string
 * }
 * ```
 */
export function defineTypedOptions<TSchema extends OptionSchema>(
  schema: TSchema
): (interaction: ChatInputCommandInteraction) => TypedOptionsAccessor<TSchema> {
  return (interaction: ChatInputCommandInteraction) => {
    const accessors: Record<string, () => unknown> = {};

    for (const [name, config] of Object.entries(schema)) {
      accessors[name] = () => {
        return getOptionValue(interaction, name, config.type, config.required);
      };
    }

    return accessors as TypedOptionsAccessor<TSchema>;
  };
}

/**
 * Get option value from interaction using the appropriate method
 */
function getOptionValue(
  interaction: ChatInputCommandInteraction,
  name: string,
  type: OptionType,
  required: boolean
): unknown {
  switch (type) {
    case 'string':
      return interaction.options.getString(name, required);
    case 'integer':
      return interaction.options.getInteger(name, required);
    case 'number':
      return interaction.options.getNumber(name, required);
    case 'boolean':
      return interaction.options.getBoolean(name, required);
    case 'user':
      return interaction.options.getUser(name, required);
    case 'channel':
      return interaction.options.getChannel(name, required);
    case 'role':
      return interaction.options.getRole(name, required);
    case 'mentionable':
      return interaction.options.getMentionable(name, required);
    case 'attachment':
      return interaction.options.getAttachment(name, required);
    default: {
      // Exhaustive check - this should never happen at runtime
      const _exhaustiveCheck: never = type;
      throw new Error(`Unknown option type: ${String(_exhaustiveCheck)}`);
    }
  }
}

/**
 * Helper to create a typed options schema from an object literal.
 * Useful for defining schemas inline with full type inference.
 *
 * @example
 * ```typescript
 * const schema = createSchema({
 *   personality: { type: 'string', required: true },
 *   limit: { type: 'integer', required: false },
 * } as const);
 * ```
 */
export function createSchema<T extends OptionSchema>(schema: T): T {
  return schema;
}
