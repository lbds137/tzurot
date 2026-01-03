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
  conversationHistory?: BaseMessage[];
  rawConversationHistory?: { role: string; content: string; tokenCount?: number }[];
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
  /** Formatted descriptions of images from extended context messages */
  extendedContextDescriptions: string | undefined;
}

/** Result of loading personas and resolving user references */
export interface PersonaLoadResult {
  participantPersonas: Map<string, { content: string; isActive: boolean }>;
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
  participantPersonas: Map<string, { content: string; isActive: boolean }>;
  retrievedMemories: MemoryDocument[];
  context: ConversationContext;
  userMessage: string;
  processedAttachments: ProcessedAttachment[];
  referencedMessagesDescriptions: string | undefined;
  /** Formatted descriptions of images from extended context */
  extendedContextDescriptions: string | undefined;
}

/** Options for model invocation */
export interface ModelInvocationOptions {
  personality: LoadedPersonality;
  systemPrompt: BaseMessage;
  userMessage: string;
  processedAttachments: ProcessedAttachment[];
  context: ConversationContext;
  participantPersonas: Map<string, { content: string; isActive: boolean }>;
  referencedMessagesDescriptions: string | undefined;
  userApiKey?: string;
}
