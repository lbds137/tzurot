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
}
