/**
 * ConversationalRAG Types
 *
 * Internal types used by ConversationalRAGService helper methods.
 * Extracted to reduce file size and improve maintainability.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type {
  LoadedPersonality,
  AttachmentMetadata,
  ReferencedMessage,
} from '@tzurot/common-types';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

/**
 * Memory document structure from vector search
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
    score?: number;
  };
}

export interface ParticipantPersona {
  personaId: string;
  personaName: string;
  isActive: boolean;
}

export interface DiscordEnvironment {
  type: 'dm' | 'guild';
  guild?: { id: string; name: string };
  category?: { id: string; name: string };
  channel: { id: string; name: string; type: string };
  thread?: {
    id: string;
    name: string;
    parentChannel: { id: string; name: string; type: string };
  };
}

export interface ConversationContext {
  userId: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  userName?: string;
  userTimezone?: string;
  isProxyMessage?: boolean;
  activePersonaId?: string;
  activePersonaName?: string;
  discordUsername?: string;
  /** Guild-specific info about the active speaker (roles, color, join date) */
  activePersonaGuildInfo?: {
    roles: string[];
    displayColor?: string;
    joinedAt?: string;
  };
  /** Guild info for other participants (from extended context, keyed by personaId) */
  participantGuildInfo?: Record<
    string,
    {
      roles: string[];
      displayColor?: string;
      joinedAt?: string;
    }
  >;
  conversationHistory?: BaseMessage[];
  rawConversationHistory?: {
    /** Message ID - for extended context messages this IS the Discord message ID */
    id?: string;
    role: string;
    content: string;
    tokenCount?: number;
    /** Structured metadata (referenced messages, image descriptions) */
    messageMetadata?: {
      referencedMessages?: {
        discordMessageId: string;
        authorUsername: string;
        authorDisplayName: string;
        content: string;
        embeds?: string;
        timestamp: string;
        locationContext: string;
        attachments?: { url: string; contentType: string; name?: string }[];
        isForwarded?: boolean;
      }[];
      imageDescriptions?: { filename: string; description: string }[];
    };
  }[];
  oldestHistoryTimestamp?: number;
  participants?: ParticipantPersona[];
  /** Attachments from triggering message */
  attachments?: AttachmentMetadata[];
  /** Pre-processed attachments (vision descriptions) from triggering message */
  preprocessedAttachments?: ProcessedAttachment[];
  /** Pre-processed attachments from referenced messages */
  preprocessedReferenceAttachments?: Record<number, ProcessedAttachment[]>;
  /** Image attachments from extended context (limited by maxImages setting) */
  extendedContextAttachments?: AttachmentMetadata[];
  /** Pre-processed extended context attachments (vision descriptions) */
  preprocessedExtendedContextAttachments?: ProcessedAttachment[];
  environment?: DiscordEnvironment;
  referencedMessages?: ReferencedMessage[];
  referencedChannels?: { channelId: string; channelName: string }[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  tokensIn?: number;
  tokensOut?: number;
  attachmentDescriptions?: string;
  referencedMessagesDescriptions?: string;
  modelUsed?: string;
  userMessageContent?: string;
  /** Whether focus mode was active (LTM retrieval was skipped) */
  focusModeEnabled?: boolean;
  /** Whether incognito mode was active (LTM storage was skipped) */
  incognitoModeActive?: boolean;
  /**
   * Data needed for deferred memory storage (when skipMemoryStorage was true).
   * Caller should pass this to storeMemory() after validating the response.
   */
  deferredMemoryData?: DeferredMemoryData;
}

/**
 * Data needed for deferred memory storage.
 * Used when skipMemoryStorage is true to allow the caller to store memory
 * after validating the response (e.g., after duplicate detection passes).
 */
export interface DeferredMemoryData {
  /** Content to store as user message (may include reference text) */
  contentForEmbedding: string;
  /** AI response content */
  responseContent: string;
  /** User's persona ID */
  personaId: string;
}

/** Result of processing input attachments and messages */
export interface ProcessedInputs {
  processedAttachments: ProcessedAttachment[];
  userMessage: string;
  referencedMessagesDescriptions: string | undefined;
  referencedMessagesTextForSearch: string | undefined;
  searchQuery: string;
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into conversation history entries for better context colocation
}

/**
 * Participant info for prompt formatting
 * Keyed by personaName for display, includes personaId for ID binding
 */
export interface ParticipantInfo {
  content: string;
  isActive: boolean;
  /** Persona ID for linking to chat_log messages via from_id attribute */
  personaId: string;
  /** Guild-specific info (roles, display color, join date) */
  guildInfo?: {
    roles: string[];
    displayColor?: string;
    joinedAt?: string;
  };
}

/** Result of loading personas and resolving user references */
export interface PersonaLoadResult {
  participantPersonas: Map<string, ParticipantInfo>;
  processedPersonality: LoadedPersonality;
}

/** Result of token budget calculation and content selection */
export interface BudgetAllocationResult {
  relevantMemories: MemoryDocument[];
  serializedHistory: string;
  systemPrompt: BaseMessage;
  memoryTokensUsed: number;
  historyTokensUsed: number;
  memoriesDroppedCount: number;
  messagesDropped: number;
  contentForStorage: string;
}

/** Result of model invocation */
export interface ModelInvocationResult {
  cleanedContent: string;
  modelName: string;
  tokensIn?: number;
  tokensOut?: number;
}

/** Options for budget allocation */
export interface BudgetAllocationOptions {
  personality: LoadedPersonality;
  processedPersonality: LoadedPersonality;
  participantPersonas: Map<string, ParticipantInfo>;
  retrievedMemories: MemoryDocument[];
  context: ConversationContext;
  userMessage: string;
  processedAttachments: ProcessedAttachment[];
  referencedMessagesDescriptions: string | undefined;
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into conversation history entries for better context colocation
  /**
   * Optional percentage (0-1) to reduce history budget by.
   * Used during duplicate detection retries (attempt 3) to break API-level caching
   * by changing the context window.
   */
  historyReductionPercent?: number;
}

/** Options for model invocation */
export interface ModelInvocationOptions {
  personality: LoadedPersonality;
  systemPrompt: BaseMessage;
  userMessage: string;
  processedAttachments: ProcessedAttachment[];
  context: ConversationContext;
  participantPersonas: Map<string, ParticipantInfo>;
  referencedMessagesDescriptions: string | undefined;
  userApiKey?: string;
  /** Retry configuration for escalating duplicate detection retries */
  retryConfig?: DuplicateRetryConfig;
}

/**
 * Configuration for escalating retry strategy when duplicate responses are detected.
 *
 * The "Ladder of Desperation" progressively increases randomness and changes
 * context to break API-level caching on free models:
 * - Attempt 1: Normal generation
 * - Attempt 2: Increase temperature and frequency_penalty
 * - Attempt 3: Reduce context by removing oldest messages
 */
export interface DuplicateRetryConfig {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Temperature override for this attempt */
  temperatureOverride?: number;
  /** Frequency penalty override for this attempt */
  frequencyPenaltyOverride?: number;
  /** Percent of oldest history to remove (0-1) */
  historyReductionPercent?: number;
}

/**
 * Options for generateResponse method
 *
 * Consolidated options object to reduce parameter count and improve
 * maintainability. All optional fields have sensible defaults.
 */
export interface GenerateResponseOptions {
  /** User's BYOK API key (for BYOK users) */
  userApiKey?: string;
  /** Whether user is in guest mode (uses free models). Default: false */
  isGuestMode?: boolean;
  /** Retry configuration for duplicate detection retries */
  retryConfig?: DuplicateRetryConfig;
  /**
   * Skip memory storage during response generation. Default: false.
   *
   * When true, memory is NOT stored automatically. Instead, the response
   * includes `deferredMemoryData` which the caller can use to store memory
   * after validating the response (e.g., after duplicate detection passes).
   *
   * This prevents storing multiple memories when retry logic is used.
   */
  skipMemoryStorage?: boolean;
}
