/**
 * Context Builder Barrel Export
 *
 * Re-exports all context building utilities for convenient importing.
 * The main MessageContextBuilder class is in the parent directory.
 */

// Extended Context Persona Resolution
export {
  collectDiscordIdsNeedingResolution,
  batchResolvePersonas,
  updateMessagesWithResolvedPersonas,
  remapParticipantGuildInfoKeys,
  resolveExtendedContextPersonaIds,
  type ParticipantGuildInfo,
} from './ExtendedContextPersonaResolver.js';

// Guild Member Resolution
export {
  extractGuildMemberInfo,
  resolveEffectiveMember,
  type MemberResolveOptions,
} from './GuildMemberResolver.js';

// User Context Resolution
export {
  lookupContextEpoch,
  resolveUserContext,
  type UserContextResult,
  type UserInfo,
  type UserContextDeps,
} from './UserContextResolver.js';
