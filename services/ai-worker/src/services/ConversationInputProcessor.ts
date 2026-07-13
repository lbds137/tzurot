/**
 * Conversation Input Processor
 *
 * Normalizes incoming conversation inputs for the RAG pipeline:
 * - Attachment processing (vision, transcription)
 * - Message formatting
 * - Reference message handling
 * - Search query construction
 */

import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { type SttDispatch } from '@tzurot/common-types/types/sttProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  processAttachments,
  deriveApiKeySource,
  type ProcessedAttachment,
} from './MultimodalProcessor.js';
import { extractRecentHistoryWindow } from './RAGUtils.js';
import { shouldFoldSearchQuery } from './prompt/queryFoldGate.js';
import { collectPersonalityNames } from '../jobs/utils/conversationUtils.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import type { ResponsePostProcessor } from './ResponsePostProcessor.js';
import type {
  ConversationContext,
  ProcessedInputs,
  ResolvedVisionAuth,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ConversationInputProcessor');

/**
 * Processes conversation inputs for the RAG pipeline
 */
export class ConversationInputProcessor {
  constructor(
    private promptBuilder: PromptBuilder,
    private referencedMessageFormatter: ReferencedMessageFormatter,
    private responsePostProcessor: ResponsePostProcessor
  ) {}

  /**
   * Resolve user name from context for placeholder replacement.
   * Priority: userName > activePersonaName > 'User'
   */
  resolveUserName(context: ConversationContext): string {
    if (context.userName !== undefined && context.userName.length > 0) {
      return context.userName;
    }
    if (context.activePersonaName !== undefined && context.activePersonaName.length > 0) {
      return context.activePersonaName;
    }
    return 'User';
  }

  /**
   * Process input attachments and format messages for AI consumption.
   *
   * @param personality - Personality configuration
   * @param message - User's message content
   * @param context - Conversation context
   * @param authOptions - Authentication options (guest mode, API keys)
   */
  async processInputs(
    personality: LoadedPersonality,
    message: MessageContent,
    context: ConversationContext,
    authOptions: {
      isGuestMode: boolean;
      userApiKey?: string;
      sttDispatch?: SttDispatch;
      /**
       * Cross-provider vision auth resolved once upstream (ConversationalRAGService).
       * Used for image processing so the inline-fallback + reference paths send the
       * vision-provider key instead of the raw main-model key. Absent in legacy
       * callers/tests → fall back to `userApiKey` (no cross-provider resolution).
       */
      visionAuth?: ResolvedVisionAuth;
    }
  ): Promise<ProcessedInputs> {
    const { isGuestMode, userApiKey, sttDispatch, visionAuth } = authOptions;
    // Vision-provider key/provider/model (resolved upstream); fall back to the
    // main key when no visionAuth was threaded (legacy/test callers).
    const visionApiKey = visionAuth?.userApiKey ?? userApiKey;
    const visionProvider = visionAuth?.visionProvider;
    const visionModel = visionAuth?.model;
    // Use pre-processed attachments from dependency jobs if available
    let processedAttachments: ProcessedAttachment[] = [];
    if (context.preprocessedAttachments && context.preprocessedAttachments.length > 0) {
      processedAttachments = context.preprocessedAttachments;
      logger.info(
        { count: processedAttachments.length },
        'Using pre-processed attachments from dependency jobs'
      );
    } else if (context.attachments && context.attachments.length > 0) {
      // Fallback: process attachments inline (shouldn't happen with job chain, but defensive)
      processedAttachments = await processAttachments(context.attachments, personality, {
        isGuestMode,
        userApiKey: visionApiKey,
        sttDispatch,
        visionProvider,
        model: visionModel,
        loggingContext: {
          userId: context.userId,
          apiKeySource: deriveApiKeySource(isGuestMode, visionApiKey),
        },
      });
      logger.info(
        { count: processedAttachments.length },
        'Processed attachments to text descriptions (inline fallback)'
      );
    }

    // Format the user's message
    const userMessage = this.promptBuilder.formatUserMessage(message, context);

    // Filter out referenced messages that are already in conversation history
    const filteredReferences = this.responsePostProcessor.filterDuplicateReferences(
      context.referencedMessages,
      context.rawConversationHistory
    );

    // Format referenced messages (with vision/transcription)
    const referencedMessagesDescriptions =
      filteredReferences.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            filteredReferences,
            personality,
            isGuestMode,
            context.preprocessedReferenceAttachments,
            {
              userApiKey: visionApiKey,
              sttDispatch,
              visionProvider,
              visionModel,
              // Personalities visible in history — enables the sibling-persona
              // quote demotion (assistant → character) in deriveRefRole.
              allPersonalityNames: collectPersonalityNames(
                context.rawConversationHistory ?? [],
                personality.displayName
              ),
            }
          )
        : undefined;

    // Extract plain text from formatted references for memory search
    const referencedMessagesTextForSearch =
      referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0
        ? this.referencedMessageFormatter.extractTextForSearch(referencedMessagesDescriptions)
        : undefined;

    // Build the search query for memory retrieval. The recent conversation
    // window is folded in ONLY when the unfolded query is content-poor: the
    // fold rescues reactive turns ("poke") that carry nothing to embed, but
    // dilutes content-rich ones — recent-context chatter pushes the on-topic
    // memory out of the top-K (measured on real conversation goldens; the
    // gate rule and its rationale live in prompt/queryFoldGate.ts).
    const unfoldedSearchQuery = this.promptBuilder.buildSearchQuery(
      userMessage,
      processedAttachments,
      referencedMessagesTextForSearch,
      undefined
    );
    const searchQuery = shouldFoldSearchQuery(unfoldedSearchQuery)
      ? this.promptBuilder.buildSearchQuery(
          userMessage,
          processedAttachments,
          referencedMessagesTextForSearch,
          extractRecentHistoryWindow(context.rawConversationHistory)
        )
      : unfoldedSearchQuery;

    return {
      processedAttachments,
      userMessage,
      referencedMessagesDescriptions,
      referencedMessagesTextForSearch,
      searchQuery,
    };
  }
}
