/**
 * Channel Fetcher Barrel Export
 *
 * Re-exports all channel fetching utilities for convenient importing.
 * The main DiscordChannelFetcher class is in the parent directory.
 */

// Types
export type {
  ParticipantGuildInfo,
  ExtendedContextUser,
  FetchResult,
  FetchOptions,
  FetchableChannel,
  SyncResult,
} from './types.js';

// Message type filters
export { isThinkingBlockMessage, isBotTranscriptReply } from './messageTypeFilters.js';

// Participant context collection
export {
  extractGuildInfo,
  limitParticipants,
  collectReactorUsers,
} from './ParticipantContextCollector.js';

// Reaction processing
export { processReactions, extractReactions } from './ReactionProcessor.js';

// History merging
export {
  mergeWithHistory,
  recoverEmptyDbContent,
  enrichDbMessagesWithExtendedMetadata,
} from './HistoryMerger.js';

// Sync validation
export { collateChunksForSync, contentsDiffer, getOldestTimestamp } from './SyncValidator.js';
