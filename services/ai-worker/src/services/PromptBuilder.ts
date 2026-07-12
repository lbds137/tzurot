/**
 * Prompt Builder - Builds system prompts with personality info, memories, and context.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { type MessageContent } from '@tzurot/common-types/types/ai';
import { type LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import { formatFullDateTime } from '@tzurot/common-types/utils/dateFormatting';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { escapeXmlContent } from '@tzurot/common-types/utils/promptSanitizer';
import type {
  MemoryDocument,
  ConversationContext,
  ParticipantInfo,
  FactForPrompt,
} from './ConversationalRAGTypes.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import { formatParticipantsContext } from './prompt/ParticipantFormatter.js';
import { formatMemoriesContext, formatFactsContext } from './prompt/MemoryFormatter.js';
import { formatPersonalityFields } from './prompt/PersonalityFieldsFormatter.js';
import { formatEnvironmentContext } from './prompt/EnvironmentFormatter.js';
import { extractContentDescriptions } from './RAGUtils.js';
import {
  PLATFORM_CONSTRAINTS,
  OUTPUT_CONSTRAINTS,
  buildIdentityConstraints,
} from './prompt/HardcodedConstraints.js';
import {
  buildDisambiguatedDisplayName,
  buildMessageWithAttachments,
  wrapWithSpeakerIdentification,
  formatComplexMessageContent,
} from './prompt/MessageFormatters.js';
import * as tokenCounters from './prompt/TokenCounters.js';
import { buildSearchQuery } from './prompt/SearchQueryBuilder.js';
import { logDetailedPromptAssembly, detectNameCollision } from './prompt/PromptLogger.js';

const logger = createLogger('PromptBuilder');

/** Options for building a full system prompt */
interface BuildFullSystemPromptOptions {
  personality: LoadedPersonality;
  participantPersonas: Map<string, ParticipantInfo>;
  relevantMemories: MemoryDocument[];
  /** Distilled active facts for the `<facts>` block (Phase 2 slice 4a; empty/absent = no block). */
  facts?: FactForPrompt[];
  context: ConversationContext;
  referencedMessagesFormatted?: string;
  serializedHistory?: string;
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into serializedHistory entries for better context colocation
}

/**
 * Build the `<chat_log>` section with its role legend. The legend is stated
 * where the roles are used: sibling personas render as role="character"
 * (never "assistant"), so the model can't mistake another character's lines
 * for its own in multi-persona channels. Empty history → empty string.
 */
function buildChatLogSection(
  serializedHistory: string | undefined,
  personalityName: string
): string {
  if (serializedHistory === undefined || serializedHistory.length === 0) {
    return '';
  }
  return `\n\n<chat_log>
<instruction>The conversation so far. Each message's role says who wrote it: role="assistant" marks your own earlier lines (${escapeXmlContent(personalityName)}); role="user" marks humans (match from_id to <participants>); role="character" marks a different AI character — a conversation peer, never you.</instruction>
${serializedHistory}
</chat_log>`;
}

export class PromptBuilder {
  /**
   * Build search query for memory retrieval
   *
   * Uses actual transcription/description for voice messages and images,
   * includes referenced message content for better memory recall,
   * and optionally includes recent conversation history for context-aware LTM search.
   *
   * The recentHistoryWindow solves the "pronoun problem" where users say things like
   * "what do you think about that?" - without context, LTM search can't find relevant memories.
   */
  buildSearchQuery(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    referencedMessagesText?: string,
    recentHistoryWindow?: string
  ): string {
    return buildSearchQuery(
      userMessage,
      processedAttachments,
      referencedMessagesText,
      recentHistoryWindow
    );
  }

  /**
   * Build human message with attachments and references
   *
   * For both images and voice messages, we use text descriptions instead of
   * raw media data. This matches how we handle conversation history and:
   * - Simplifies the code (no multimodal complexity)
   * - Reduces API costs (vision/audio APIs are expensive)
   * - Provides consistent behavior between current turn and history
   *
   * The message includes speaker identification via a <from> tag to help the LLM
   * know who is speaking. This is critical because while the system prompt has
   * a participants section with active="true", and chat_log has from= attributes,
   * the raw HumanMessage content also needs explicit speaker identification.
   */
  buildHumanMessage(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    options?: {
      activePersonaName?: string;
      referencedMessagesDescriptions?: string;
      activePersonaId?: string;
      /** Discord username for disambiguation when persona name matches personality name */
      discordUsername?: string;
      /** Personality name for collision detection */
      personalityName?: string;
    }
  ): { message: HumanMessage; contentForStorage: string } {
    const {
      activePersonaName,
      referencedMessagesDescriptions,
      activePersonaId,
      discordUsername,
      personalityName,
    } = options ?? {};

    // Build message content with attachments
    let messageContent = userMessage;
    if (processedAttachments.length > 0) {
      const descriptions = extractContentDescriptions(processedAttachments);
      messageContent = buildMessageWithAttachments(userMessage, descriptions);
      logger.info(
        {
          attachmentCount: processedAttachments.length,
          hasUserText: userMessage.trim().length > 0 && userMessage !== 'Hello',
          attachmentTypes: processedAttachments.map(a => a.type),
        },
        'Built message with attachment descriptions'
      );
    }

    // Capture content BEFORE adding referenced messages (for storage)
    const contentForStorage = messageContent;

    // Escape user content BEFORE appending references — references are system-generated
    // XML (<contextual_references>) and must NOT be escaped
    const safeUserContent = escapeXmlContent(messageContent);

    // Append referenced messages (for LLM prompt only, not storage)
    let safeContent: string;
    if (referencedMessagesDescriptions !== undefined && referencedMessagesDescriptions.length > 0) {
      safeContent =
        safeUserContent.length > 0
          ? `${safeUserContent}\n\n${referencedMessagesDescriptions}`
          : referencedMessagesDescriptions;
      logger.info(
        { referencesLength: referencedMessagesDescriptions.length },
        'Appended references'
      );
    } else {
      safeContent = safeUserContent;
    }

    // Add speaker identification
    let finalContent = safeContent;

    if (activePersonaName !== undefined && activePersonaName.length > 0) {
      const displayName = buildDisambiguatedDisplayName(
        activePersonaName,
        personalityName,
        discordUsername
      );
      finalContent = wrapWithSpeakerIdentification(safeContent, displayName, activePersonaId);
    }

    return {
      message: new HumanMessage(finalContent),
      contentForStorage,
    };
  }

  /**
   * Build full system prompt with personas, memories, and date context
   *
   * NEW ARCHITECTURE (2025-12): Full XML structure to prevent identity bleeding
   *
   * Section ordering follows Gemini's "XML Containment & Sandwich Method":
   * 1. <system_identity> - Identity, character, AND constraints (who am I, what I must NOT do)
   * 2. <context> - Date/time and location (when and where)
   * 3. <participants> - Who else is involved (NOT including self)
   * 4. <memory_archive> - Historical memories (middle = less attention = good for archives)
   * 5. <contextual_references> - Referenced messages from replies/links
   * 6. <chat_log> - Serialized conversation history with XML tags per message
   * 7. <protocol> - Behavior rules (END for recency bias)
   */
  buildFullSystemPrompt(options: BuildFullSystemPromptOptions): SystemMessage {
    const {
      personality,
      participantPersonas,
      relevantMemories,
      context,
      referencedMessagesFormatted,
      serializedHistory,
    } = options;

    const { persona, protocol } = formatPersonalityFields(
      personality,
      context.activePersonaName !== undefined && context.activePersonaName.length > 0
        ? context.activePersonaName
        : 'User',
      personality.name,
      context.discordUsername
    );
    logger.debug(
      { personaLength: persona.length, protocolLength: protocol.length },
      'Persona and protocol lengths'
    );

    // Build <system_identity> section. personality.name is user-authored and
    // must be escaped — it was previously interpolated raw into <role>.
    // persona is per-field-escaped assembled XML; the outer escape here is a
    // defense-in-depth no-op on the (unprotected) internal field tags and
    // leaves already-escaped entities alone. The <character>/<system_identity>
    // BOUNDARY protection at the field-value escape is what stops breakout.
    const identitySection = `<system_identity>
<role>You are ${escapeXmlContent(personality.name)}.</role>
<character>
${escapeXmlContent(persona)}
</character>
</system_identity>`;

    // Identity constraints - prevent identity bleeding
    const collisionInfo = detectNameCollision(
      context.activePersonaName,
      context.discordUsername,
      personality.name,
      personality.id
    );
    const identityConstraintsSection = buildIdentityConstraints(personality.name, collisionInfo);

    // Current date/time and environment context wrapped in <context>
    const datetime = formatFullDateTime(new Date(), context.userTimezone);

    const locationXml =
      context.environment !== undefined && context.environment !== null
        ? formatEnvironmentContext(context.environment)
        : '<location type="dm">Direct Message (private one-on-one chat)</location>';

    // Unique request ID to break API-level prompt caching
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const contextSection = `\n\n<context>
<datetime>${datetime}</datetime>
${locationXml}
<request_id>${requestId}</request_id>
</context>`;

    // Conversation participants
    const participantsContext = formatParticipantsContext(
      participantPersonas,
      context.activePersonaName
    );

    // Distilled active facts (Phase 2), rendered ahead of the historical archive.
    // Subject-bound to the triggering message's author — fact retrieval is scoped
    // to that persona, and unbound "the user" statements misattribute in
    // multi-user channels. Both names also resolve {user}/{assistant} statement
    // placeholders (extraction episodes are placeholder-templated).
    const factsContext = formatFactsContext(options.facts ?? [], {
      subjectName: context.activePersonaName,
      personalityName: personality.name,
      discordUsername: context.discordUsername,
    });

    // Relevant memories from past interactions
    const memoryContext = formatMemoriesContext(relevantMemories, context.userTimezone);

    // Referenced messages (from replies and message links)
    const referencesContext =
      referencedMessagesFormatted !== undefined && referencedMessagesFormatted.length > 0
        ? `\n\n${referencedMessagesFormatted}`
        : '';

    if (referencesContext.length > 0) {
      logger.info(
        { referencesContextLength: referencesContext.length },
        'Formatted referencesContext'
      );
    }

    // Conversation history as XML (legend lives in buildChatLogSection)
    const chatLogSection = buildChatLogSection(serializedHistory, personality.name);

    // Protocol (near END of prompt - recency bias for highest impact). Outer
    // escape kept: it also covers the LEGACY raw-systemPrompt path (author XML),
    // and the <protocol> boundary protection stops sub-section values escaping.
    const protocolSection =
      protocol.length > 0 ? `\n\n<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

    // Output constraints at the VERY END (recency bias for format compliance)
    const outputConstraintsSection = `\n\n${OUTPUT_CONSTRAINTS}`;

    // Assemble in correct order using Sandwich Method
    const fullSystemPrompt = `${identitySection}\n\n${identityConstraintsSection}\n\n${PLATFORM_CONSTRAINTS}${contextSection}${participantsContext}${factsContext}${memoryContext}${referencesContext}${chatLogSection}${protocolSection}${outputConstraintsSection}`;

    // Basic prompt composition logging
    const historyLength = serializedHistory?.length ?? 0;
    const promptLengths = {
      identity: identitySection.length,
      identityConstraints: identityConstraintsSection.length,
      platformConstraints: PLATFORM_CONSTRAINTS.length,
      context: contextSection.length,
      participants: participantsContext.length,
      memories: memoryContext.length,
      references: referencesContext.length,
      history: historyLength,
      protocol: protocolSection.length,
      outputConstraints: outputConstraintsSection.length,
      total: fullSystemPrompt.length,
    };
    logger.info(promptLengths, 'Prompt composition');

    // Detailed prompt assembly logging (development only)
    logDetailedPromptAssembly({
      personality,
      persona,
      protocol,
      participantPersonas,
      participantsContext,
      context,
      relevantMemories,
      memoryContext,
      historyLength,
      fullSystemPrompt,
    });

    return new SystemMessage(fullSystemPrompt);
  }

  /**
   * Format user message with context metadata
   */
  formatUserMessage(message: MessageContent, context: ConversationContext): string {
    // Add proxy message prefix if applicable
    const proxyPrefix =
      context.isProxyMessage === true &&
      context.userName !== undefined &&
      context.userName.length > 0
        ? `[Message from ${context.userName}]\n`
        : '';

    // Handle string messages directly
    if (typeof message === 'string') {
      return proxyPrefix + message || 'Hello';
    }

    // Handle complex message objects
    if (typeof message === 'object' && message !== null) {
      const { content, refPrefix, attachmentSuffix } = formatComplexMessageContent(message);
      const result = refPrefix + proxyPrefix + content + attachmentSuffix;
      return result || 'Hello';
    }

    return proxyPrefix || 'Hello';
  }

  /**
   * Count tokens for a text string
   */
  countTokens(text: string): number {
    return tokenCounters.countTokens(text);
  }

  /**
   * Count tokens for memories
   */
  countMemoryTokens(memories: MemoryDocument[]): number {
    return tokenCounters.countMemoryTokens(memories);
  }

  /**
   * Count tokens for processed attachments (from descriptions)
   */
  countAttachmentTokens(processedAttachments: ProcessedAttachment[]): number {
    return tokenCounters.countAttachmentTokens(processedAttachments);
  }
}
