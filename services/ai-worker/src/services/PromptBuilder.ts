/**
 * Prompt Builder - Builds the cacheable system message (constraints, personality
 * identity, protocol, location, participants, chat log) and the human message,
 * whose volatile prefix carries the per-request content (datetime, facts,
 * memories, referenced messages).
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
import { extractCharacterParticipants } from '../jobs/utils/participantUtils.js';
import { formatMemoriesContext, formatFactsContext } from './prompt/MemoryFormatter.js';
import { layoutSections, type PromptSection, type SectionDescription } from './prompt/sections.js';
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
import { logDetailedPromptAssembly } from './prompt/PromptLogger.js';

const logger = createLogger('PromptBuilder');

/**
 * Options for building the system message — the CACHEABLE container.
 * Carries only stable-tier inputs plus history; everything per-request
 * volatile renders via {@link PromptBuilder.buildVolatilePrefix} instead.
 */
interface BuildSystemMessageOptions {
  personality: LoadedPersonality;
  /** Needed for persona-name resolution on the legacy protocol path. */
  context: ConversationContext;
  /**
   * Keyed by resolvedPersonaId (a UUID) — see `ParticipantInfo`/`PersonaLoadResult`
   * in ConversationalRAGTypes.ts. Renders the roster ahead of `chat_log`, where
   * the from_id bindings the log uses are resolvable in the same container.
   */
  participantPersonas: Map<string, ParticipantInfo>;
  serializedHistory?: string;
}

/** Options for building the V-tier prefix of the current user message. */
interface BuildVolatilePrefixOptions {
  personality: LoadedPersonality;
  context: ConversationContext;
  referencedMessagesFormatted?: string;
  /** Distilled active facts for the `<facts>` block (empty/absent = no block). */
  facts?: FactForPrompt[];
  relevantMemories?: MemoryDocument[];
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
  return `<chat_log>
<instruction>The conversation so far. Each message's role says who wrote it: role="assistant" marks your own earlier lines (${escapeXmlContent(personalityName)}); role="user" marks humans (match from_id to the <participants> roster above); role="character" marks a different AI character — a conversation peer, never you (its from_id matches the roster too).</instruction>
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
   * know who is speaking. The system message's roster is deliberately
   * speaker-independent so it stays in the provider's cache prefix, so it names
   * the participants but never which of them is talking now; chat_log entries
   * do name their own speaker (`from=` alongside `from_id=`, disambiguated per
   * line by `resolveSpeakerInfo`), but the live turn has no chat_log entry yet.
   * This tag is what identifies the speaker for that turn, carrying their id
   * and pronouns so it is self-describing without a lookup back into the roster.
   */
  buildHumanMessage(
    userMessage: string,
    processedAttachments: ProcessedAttachment[],
    options?: {
      activePersonaName?: string;
      /**
       * The V-tier block set from {@link buildVolatilePrefix}, prepended
       * BEFORE the `<from>`-wrapped user turn. Never escaped (system-generated
       * XML whose user-derived leaf values were escaped by each formatter) and
       * never stored — `contentForStorage` is captured before it attaches.
       */
      volatilePrefix?: string;
      activePersonaId?: string;
      /**
       * The speaker's pronouns, rendered as a `<from>` attribute. Absent when
       * the persona declares none — the roster's own `<pronouns>` element is
       * governed by the same rule.
       */
      activePersonaPronouns?: string;
      /** Discord username for disambiguation when persona name matches personality name */
      discordUsername?: string;
      /** Personality name for collision detection */
      personalityName?: string;
    }
  ): { message: HumanMessage; contentForStorage: string } {
    const {
      activePersonaName,
      volatilePrefix,
      activePersonaId,
      activePersonaPronouns,
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

    // Capture content BEFORE escaping and BEFORE the volatile prefix — this is
    // what persists to history/LTM, and V-tier content must never reach storage.
    const contentForStorage = messageContent;

    // Escape the user's content; the volatile prefix is system-generated XML
    // and is prepended AFTER the wrap, un-escaped.
    const safeUserContent = escapeXmlContent(messageContent);

    // Add speaker identification around the user's turn only
    let turnContent = safeUserContent;
    if (activePersonaName !== undefined && activePersonaName.length > 0) {
      const displayName = buildDisambiguatedDisplayName(
        activePersonaName,
        personalityName,
        discordUsername
      );
      turnContent = wrapWithSpeakerIdentification(
        safeUserContent,
        displayName,
        activePersonaId,
        activePersonaPronouns
      );
    }

    // V prefix leads; the <from>-wrapped turn closes the message so the user's
    // actual words sit nearest the generation point.
    const finalContent =
      volatilePrefix !== undefined && volatilePrefix.length > 0
        ? turnContent.length > 0
          ? `${volatilePrefix}\n\n${turnContent}`
          : volatilePrefix
        : turnContent;

    return {
      message: new HumanMessage(finalContent),
      contentForStorage,
    };
  }

  /**
   * Build the system message — the CACHEABLE container (S0 → S1 → H).
   *
   * Order is placement-by-tier per the accepted architecture (§2.1): the
   * cross-persona-static S0 block leads so automatic-prefix providers share
   * those bytes across every persona; the per-persona S1 block follows;
   * `chat_log` (H) is last — it grows per turn, so everything before it stays
   * a stable prefix between turns. `location` and `participants` sit at the end
   * of the S1 run, ahead of `chat_log`, so the roster the log's from_id
   * attributes bind to is resolvable in the same container. The whole
   * `participants` block is byte-stable turn to turn — ordering, elements, and
   * notes are all roster-derived, with nothing tracking the current speaker
   * (see `formatParticipantsContext`). Per-request volatile
   * content (datetime, retrieval output, references) lives in
   * {@link buildVolatilePrefix}. The recency-tail
   * placement protocol/output_constraints held before this restructure was
   * deliberately traded for cacheability (the voice-consistency gate guards
   * the quality side; see the epic roadmap).
   *
   * The returned descriptions map each rendered section's tier and offset —
   * the diagnostic payload stores them so the prefix-diff tool can annotate a
   * cache-miss divergence with the section it landed in.
   */
  buildSystemMessage(options: BuildSystemMessageOptions): {
    message: SystemMessage;
    sections: SectionDescription[];
  } {
    const { personality, context, participantPersonas, serializedHistory } = options;

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

    // Identity constraints — static per persona. The name-collision note rides
    // inside the participants block below, which is where the roster it
    // disambiguates lives.
    const identityConstraintsSection = buildIdentityConstraints(personality.name);

    // Where the conversation is happening. Rendered here rather than in the
    // volatile prefix: the location is stable for the whole channel, so it
    // belongs in the cacheable prefix beside the roster it contextualizes.
    const locationSection =
      context.environment !== undefined && context.environment !== null
        ? formatEnvironmentContext(context.environment)
        : '<location type="dm">Direct Message (private one-on-one chat)</location>';

    // Conversation participants, carrying a name-collision note when any
    // roster member renders under the character's own name. Rendered ahead of
    // chat_log so the from_id bindings resolve within one container. Both the
    // roster and its notes are derived from the roster alone — never from the
    // current speaker — so this block is byte-stable across speaker changes;
    // the concrete "Name (@username)" disambiguation rides the volatile-tier
    // <from> tag instead (buildDisambiguatedDisplayName, above).
    // Sibling characters come from the FETCHED history, not the selected
    // subset, and both callers therefore see the same list — which is what the
    // budget identity in ContentBudgetManager.buildBaseComponents requires,
    // since the base measurement runs before history selection exists. Same
    // over-measure direction as `collectPersonalityNames`: a character present
    // only in a dropped entry keeps its roster line, which costs a few tokens
    // and keeps the block stable as the window slides.
    //
    // Current-channel history only, and cross-channel needs no equivalent: the
    // `<prior_conversations>` rows render through this same formatter, but
    // `getCrossChannelHistory` filters on a single `personalityId` — the
    // RESPONDER's, passed at ContextAssembler.ts's `personalityId:
    // personality.id` — so every one of those rows resolves to role="assistant"
    // and can never reach the character branch. Stated with its cite because a
    // reviewer raised it twice: the schema does carry `personalityId`, which
    // makes the gap look reachable until you read the query.
    const characters = extractCharacterParticipants(
      context.rawConversationHistory,
      personality.name,
      personality.id
    );
    const participantsSection = formatParticipantsContext(
      participantPersonas,
      personality.name,
      characters,
      context.characterBlurbs
    );

    // Conversation history as XML (legend lives in buildChatLogSection)
    const chatLogSection = buildChatLogSection(serializedHistory, personality.name);

    // Protocol. Outer escape kept: it also covers the LEGACY raw-systemPrompt
    // path (author XML), and the <protocol> boundary protection stops
    // sub-section values escaping.
    const protocolSection =
      protocol.length > 0 ? `<protocol>\n${escapeXmlContent(protocol)}\n</protocol>` : '';

    const sections: PromptSection[] = [
      { id: 'platform_constraints', tier: 'S0', render: () => PLATFORM_CONSTRAINTS },
      { id: 'output_constraints', tier: 'S0', render: () => OUTPUT_CONSTRAINTS },
      { id: 'system_identity', tier: 'S1', render: () => identitySection },
      { id: 'identity_constraints', tier: 'S1', render: () => identityConstraintsSection },
      { id: 'protocol', tier: 'S1', render: () => protocolSection },
      { id: 'location', tier: 'S1', render: () => locationSection },
      { id: 'participants', tier: 'S1', render: () => participantsSection },
      { id: 'chat_log', tier: 'H', render: () => chatLogSection },
    ];

    const { text: fullSystemPrompt, descriptions: sectionDescriptions } = layoutSections(sections);

    logger.info(
      { sections: sectionDescriptions, total: fullSystemPrompt.length },
      'System prompt composition'
    );

    // Detailed prompt assembly logging (development only)
    logDetailedPromptAssembly({
      personality,
      persona,
      protocol,
      context,
      historyLength: serializedHistory?.length ?? 0,
      fullSystemPrompt,
    });

    return { message: new SystemMessage(fullSystemPrompt), sections: sectionDescriptions };
  }

  /**
   * Build the V-tier volatile prefix of the current user message: the datetime,
   * retrieved facts and memories, and the contextual references. The location
   * and the participant roster render in the system message instead — both are
   * stable for the channel, so re-rendering them per turn bought nothing.
   * Everything left here changes per request — placing it in the user
   * message keeps the system message byte-stable so the provider's prefix
   * cache actually hits (§2.2 of the accepted architecture; this placement is
   * also what ended the references double-render across both containers).
   *
   * Always non-empty: the `<context>` block renders unconditionally.
   */
  buildVolatilePrefix(options: BuildVolatilePrefixOptions): string {
    const { personality, context } = options;

    // Current date/time wrapped in <context>. The location moved to the system
    // message — it is stable for the channel, so keeping it here re-rendered a
    // constant into the volatile container every turn.
    const datetime = formatFullDateTime(new Date(), context.userTimezone);

    const contextSection = `<context>
<datetime>${datetime}</datetime>
</context>`;

    // Distilled active facts, rendered ahead of the historical archive.
    // Subject-bound to the triggering message's author — fact retrieval is
    // scoped to that persona, and unbound "the user" statements misattribute
    // in multi-user channels. Both names also resolve {user}/{assistant}
    // statement placeholders (extraction episodes are placeholder-templated).
    const factsContext = formatFactsContext(options.facts ?? [], {
      subjectName: context.activePersonaName,
      personalityName: personality.name,
      discordUsername: context.discordUsername,
    });

    // Relevant memories from past interactions
    const memoryContext = formatMemoriesContext(
      options.relevantMemories ?? [],
      context.userTimezone
    );

    // Referenced messages (from replies and message links) — rendered ONLY
    // here; the system message never carries them.
    const referencesContext = options.referencedMessagesFormatted ?? '';

    const sections: PromptSection[] = [
      { id: 'context', tier: 'V', render: () => contextSection },
      { id: 'facts', tier: 'V', render: () => factsContext },
      { id: 'memory_archive', tier: 'V', render: () => memoryContext },
      { id: 'contextual_references', tier: 'V', render: () => referencesContext },
    ];

    const { text, descriptions } = layoutSections(sections);
    logger.info({ sections: descriptions, total: text.length }, 'Volatile prefix composition');
    return text;
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
