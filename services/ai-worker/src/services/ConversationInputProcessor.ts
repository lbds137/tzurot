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
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
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
import {
  buildHistoryEntryIndex,
  collectPersonalityNames,
} from '../jobs/utils/conversationUtils.js';
import type { StructuredHistoryEntry } from '../jobs/utils/conversationTypes.js';
import { chatLogEnrichmentFor } from '../jobs/utils/xmlMetadataFormatters.js';
import type { PromptBuilder } from './PromptBuilder.js';
import type { ReferencedMessageFormatter } from './ReferencedMessageFormatter.js';
import type {
  ConversationContext,
  ProcessedInputs,
  ResolvedVisionAuth,
} from './ConversationalRAGTypes.js';

const logger = createLogger('ConversationInputProcessor');

/**
 * What `<chat_log>` will already render for each DEDUPED reference, keyed by
 * Discord message id — the subtraction set the stub renderer cannot derive.
 *
 * The live path's ordering problem in one function. A deduped stub asks "does
 * history already carry this quote's image description?", which is a fact about
 * the chat-log renderer's output for that quote's OWN history entry; the replay
 * path answers it from the entry it deduped against, and this is the live
 * equivalent. It is only answerable AFTER history enrichment has run, because
 * enrichment is what populates `imageDescriptions` — hence the step ordering in
 * `ConversationalRAGService.generateResponse`.
 *
 * Keyed the same way the dedup DECISION was made: `referenceEnricher` flags a
 * reference duplicate when its Discord id is in the assembled history's id set,
 * so every exact-id dedup resolves to an entry here. Its time-window fallback
 * flags references with no matching entry at all — those get no map entry and
 * subtract nothing, which is correct: there is no chat-log copy to defer to.
 *
 * `personalityName`/`allPersonalityNames` mirror what the chat-log renderer will
 * be handed (`personality.name`), so this reports what that renderer emits
 * rather than a second opinion about it.
 */
function buildCarriedChatLogEnrichment(
  references: ReferencedMessage[],
  history: StructuredHistoryEntry[],
  personalityName: string
): Map<string, ReadonlySet<string>> {
  const carried = new Map<string, ReadonlySet<string>>();
  const deduped = references.filter(ref => ref.isDeduplicated === true);
  if (deduped.length === 0 || history.length === 0) {
    return carried;
  }

  const historyEntries = buildHistoryEntryIndex(history);
  const allPersonalityNames = collectPersonalityNames(history, personalityName);

  for (const ref of deduped) {
    const entry = historyEntries.get(ref.discordMessageId);
    if (entry !== undefined) {
      carried.set(
        ref.discordMessageId,
        chatLogEnrichmentFor(entry, personalityName, allPersonalityNames)
      );
    }
  }

  return carried;
}

/**
 * Processes conversation inputs for the RAG pipeline
 */
export class ConversationInputProcessor {
  constructor(
    private promptBuilder: PromptBuilder,
    private referencedMessageFormatter: ReferencedMessageFormatter
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
      /**
       * This turn's `realMessagesEnabled` value, captured once upstream
       * (`ContentBudgetManager.isRealMessagesEnabled`) before this method runs.
       * Forwarded into the reference formatter's wording picker so a live flip
       * mid-turn cannot mix modes within one assembled prompt.
       */
      realMessagesEnabled: boolean;
    }
  ): Promise<ProcessedInputs> {
    const { isGuestMode, userApiKey, sttDispatch, visionAuth, realMessagesEnabled } = authOptions;
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

    // References are used as-is. Deduplication already happened in
    // `referenceEnricher`, which FLAGS `isDeduplicated` and deliberately never
    // drops — the stub is a render-time projection, because building it
    // field-by-field is how the quoted role, the attachments and the forwarded
    // flag each went missing in turn.
    //
    // A second filter used to run here and has been removed. It keyed on
    // history `id`, which the enricher's `discordMessageId` key already
    // subsumes: DB-history rows hold a database UUID there (no snowflake can
    // match it), and extended-context rows hold the Discord message id — the
    // same value that row also carries in `discordMessageId`. Both dedups read
    // the same merged history, so every match `id` could find was already
    // FLAGGED by the enricher — and the removed filter exempted anything
    // flagged. The only references it could ever drop were therefore ones the
    // real dedup had decided were NOT duplicates. A dropped reference is also
    // never persisted onto the trigger row, so firing would have deleted a
    // live reference outright rather than shortening it.
    const references = context.referencedMessages ?? [];

    // Format referenced messages (with vision/transcription). The formatter
    // returns the prompt XML alongside a plain-text search rendering built
    // from the raw pieces — never tag-strip the formatted block for search,
    // that leaks instruction boilerplate into the embedding query.
    const formattedReferences =
      references.length > 0
        ? await this.referencedMessageFormatter.formatReferencedMessages(
            references,
            personality,
            isGuestMode,
            context.preprocessedReferenceAttachments,
            {
              userApiKey: visionApiKey,
              sttDispatch,
              visionProvider,
              visionModel,
              // Personalities visible in history — enables the sibling-persona
              // quote demotion (assistant → character) in deriveRefRole. Seeded
              // with the DISPLAY name because role derivation is a match against
              // Discord-vocabulary names (see fromLiveReference), which is also
              // why it is not the set below.
              allPersonalityNames: collectPersonalityNames(
                context.rawConversationHistory ?? [],
                personality.displayName
              ),
              // What <chat_log> already renders for each deduped quote, so the
              // stub subtracts it instead of printing the same paid vision
              // description twice in one prompt. Derived from history AFTER
              // enrichment ran — the ordering is load-bearing (see the helper).
              carriedByChatLog: buildCarriedChatLogEnrichment(
                references,
                context.rawConversationHistory ?? [],
                personality.name
              ),
              // Correlation only: the formatter's enrichment-drop warnings name
              // the request that paid for the lost vision/transcription work.
              requestId: context.requestId,
              realMessagesEnabled,
            }
          )
        : undefined;
    const referencedMessagesDescriptions = formattedReferences?.formatted;

    const referencedMessagesTextForSearch =
      formattedReferences !== undefined && formattedReferences.searchText.length > 0
        ? formattedReferences.searchText
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
      durableReferences: formattedReferences?.durable ?? [],
    };
  }
}
