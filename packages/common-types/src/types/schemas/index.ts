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
  type CrossChannelMessage,
  crossChannelMessageSchema,
  type MessageMetadata,
  messageMetadataSchema,
  type MessageReaction,
  messageReactionSchema,
  type ReactionReactor,
  reactionReactorSchema,
  type ReferenceAuthorRole,
  referenceAuthorRoleSchema,
  type ReferencedMessage,
  referencedMessageSchema,
  type ResolvedImageDescription,
  resolvedImageDescriptionSchema,
  type StoredReferencedMessage,
  storedReferencedMessageSchema,
} from './message.js';

export {
  customFieldsSchema,
  isVoiceEnabled,
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
  type RawDiscordUser,
  rawDiscordUserSchema,
  type RawMentionedChannel,
  rawMentionedChannelSchema,
  type RawMentionedRole,
  rawMentionedRoleSchema,
} from './rawEnvelope.js';

export {
  type ApiErrorInfo,
  CONFIG_SOURCE_IDS,
  type ConfigSourceId,
  type GenerateRequest,
  generateRequestSchema,
  type LLMGenerationResult,
  llmGenerationResultSchema,
} from './generation.js';
