/**
 * Validation Schemas - Barrel Export
 *
 * Re-exports all schema modules for backward compatibility.
 * Import from a deep subpath (e.g. '@tzurot/common-types/schemas/discord') or './schemas.js'.
 */

export {
  type AttachmentMetadata,
  attachmentMetadataSchema,
  type DiscordEnvironment,
  discordEnvironmentSchema,
  type GuildMemberInfo,
  guildMemberInfoSchema,
} from './discord.js';

export {
  apiConversationMessageSchema,
  type CrossChannelHistoryGroupEntry,
  crossChannelHistoryGroupSchema,
  type MessageMetadata,
  type ReferencedMessage,
  referencedMessageSchema,
} from './message.js';

export {
  type LoadedPersonality,
  loadedPersonalitySchema,
  type MentionedPersona,
  mentionedPersonaSchema,
  type ReferencedChannel,
  referencedChannelSchema,
  type RequestContext,
  requestContextSchema,
} from './personality.js';

export {
  type RawAssemblyInputs,
  rawAssemblyInputsSchema,
  rawDiscordUserSchema,
  rawMentionedChannelSchema,
  rawMentionedRoleSchema,
} from './rawEnvelope.js';

export {
  CONFIG_SOURCE_IDS,
  type ConfigSourceId,
  type GenerateRequest,
  generateRequestSchema,
  type LLMGenerationResult,
} from './generation.js';
