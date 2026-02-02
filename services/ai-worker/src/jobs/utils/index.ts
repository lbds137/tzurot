/**
 * Conversation Utilities Barrel Export
 *
 * Re-exports all conversation processing utilities for convenient importing.
 * Each module has a specific responsibility:
 * - conversationUtils: Core orchestration (formatConversationHistoryAsXml, formatSingleHistoryEntryAsXml)
 * - participantUtils: Participant extraction and role matching
 * - langchainConverter: LangChain BaseMessage conversion
 * - xmlMetadataFormatters: XML formatting for message metadata
 * - conversationLengthEstimator: Character/token length estimation
 * - conversationTypes: Shared type definitions
 */

// Main orchestration and backward-compatible re-exports
export {
  // Core formatting functions
  formatSingleHistoryEntryAsXml,
  formatConversationHistoryAsXml,
  // Re-exported from participantUtils
  Participant,
  extractParticipants,
  isRoleMatch,
  // Re-exported from langchainConverter
  convertConversationHistory,
  // Re-exported from xmlMetadataFormatters
  formatQuotedSection,
  formatImageSection,
  formatEmbedsSection,
  formatVoiceSection,
  formatReactionsSection,
  // Re-exported from conversationLengthEstimator
  getFormattedMessageCharLength,
  // Re-exported from conversationTypes
  RawHistoryEntry,
  InlineImageDescription,
  // Options type
  FormatConversationHistoryOptions,
} from './conversationUtils.js';
