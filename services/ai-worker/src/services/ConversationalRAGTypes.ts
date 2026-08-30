/**
 * ConversationalRAG Types
 *
 * Internal types used by ConversationalRAGService helper methods.
 * Extracted to reduce file size and improve maintainability.
 */

import type { BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { AIProvider } from '@tzurot/common-types/constants/ai';
import type { ResolvedConfigOverrides } from '@tzurot/common-types/schemas/api/configOverrides';
import type { AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import type {
  CrossChannelHistoryGroupEntry,
  ReferencedMessage,
  StoredReferencedMessage,
} from '@tzurot/common-types/types/schemas/message';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';
import type { SttDispatch } from '@tzurot/common-types/types/sttProvider';
import type { SummonAnonymity } from '@tzurot/common-types/types/summon-anonymity';
import type { StructuredHistoryEntry } from '../jobs/utils/conversationTypes.js';
import type { HeaderIdTagMap } from '../jobs/utils/participantUtils.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';
import type { SectionDescription } from './prompt/sections.js';

/**
 * Cross-provider vision auth, resolved ONCE per request and threaded to every
 * vision call site in the RAG path (history enrichment, current-message inline
 * fallback, referenced-message attachments). Replaces forwarding the raw
 * main-model key, which 401s when the vision model lives on a different provider
 * than the main model. `userApiKey` is the key for the VISION provider (the
 * system key on a free-tier downgrade); `visionProvider`/`model` come from
 * `resolveVisionConfig`. All three sites share one personality + user per
 * request, so a single resolution is correct for all of them.
 */
export interface ResolvedVisionAuth {
  userApiKey?: string;
  visionProvider?: AIProvider;
  model?: string;
}

/**
 * Memory document structure from vector search
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
    score?: number;
    /** Discord snowflakes of the memory's source messages (Phase 0 R8
     * linkage) — the STM/LTM selection filter's ID-dedup key. */
    messageIds?: string[] | null;
    /** Channel the memory was formed in — scopes the dedup rescue. */
    channelId?: string | null;
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
  channel: { id: string; name: string; type: string; topic?: string };
  thread?: {
    id: string;
    name: string;
    parentChannel: { id: string; name: string; type: string };
  };
}

export interface ConversationContext {
  userId: string;
  /**
   * Correlation id of the job that produced this turn, threaded from the job
   * payload so renderer-level warnings (dropped paid enrichment, unkeyable
   * enrichment) name the producing request instead of forcing timestamp
   * archaeology across the pipeline's logs. Also the idempotency anchor for
   * z.ai free-tier admission (vision auth consults `admit(userId, requestId)`,
   * which is retry-idempotent per this pair) — so its presence can decide
   * which vision tier serves a guest, but it must not otherwise influence
   * generated content: never hashed into sampling, prompts, or model
   * parameters. Optional so tests and non-job callers need not supply one;
   * absent means the warn carries no correlation id and the guest piggyback
   * vision tier is skipped.
   */
  requestId?: string;
  channelId?: string;
  serverId?: string;
  sessionId?: string;
  userName?: string;
  userTimezone?: string;
  isProxyMessage?: boolean;
  /** Discord id of the triggering user message — links captured memories to
   * their source turn (deletion propagation; response ids aren't known at
   * capture time since bot-client sends after generation). */
  triggerMessageId?: string;
  /** Weigh-in mode: read-the-room framing (controls framing, not anonymity). */
  isWeighIn?: boolean;
  /**
   * Personal-vs-incognito union, resolved once in `buildConversationContext`
   * from the wire flags (always populated on the production path). Memory
   * consumers switch on `summonAnonymity?.kind` rather than re-deriving
   * `incognito ?? isWeighIn`, which is what let the anonymity decision drift
   * across sites. Optional so unrelated tests need not declare it —
   * absent reads as a personal summon (the safe default: memory works). Distinct
   * from the Redis `/memory incognito` session checked separately at write time.
   */
  summonAnonymity?: SummonAnonymity;
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
  /**
   * Generated third-person blurbs for the sibling AI characters in the roster,
   * keyed by personality id. Populated by `ContextStep` — never fetched at
   * render time, because the roster is rendered twice per turn (the budget
   * pre-pass and the shipped prompt) and the budget identity holds only while
   * both see identical inputs.
   *
   * An id absent from this record renders name-only. Absence deliberately
   * collapses three upstream states that are indistinguishable to a reader —
   * never generated (`rosterBlurb` null), generated with nothing to say
   * (`rosterBlurb` `''`), and the feature switched off — so no consumer has to
   * remember that `'' != null` is true in JS.
   */
  characterBlurbs?: Record<string, string>;
  conversationHistory?: BaseMessage[];
  rawConversationHistory?: StructuredHistoryEntry[];
  oldestHistoryTimestamp?: number;
  /** Oldest timestamp over refs + cross-channel only (see PreparedContext). */
  nonHistoryOldestTimestamp?: number;
  /**
   * Set by the RAG orchestrator AFTER the history pre-pass, BEFORE retrieval.
   * Presence of the object means the pre-pass ran (exact-dedup mode);
   * oldestSelectedTs is the min createdAt of SHIPPED current-channel history
   * (undefined = nothing shipped → no time exclusion needed: LTM covers all).
   */
  stmLtmCutoffInputs?: { oldestSelectedTs?: number };
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
  /** Cross-channel conversation history groups (from other channels with same personality) */
  crossChannelHistory?: CrossChannelHistoryGroupEntry[];
}

export interface RAGResponse {
  content: string;
  retrievedMemories?: number;
  tokensIn?: number;
  tokensOut?: number;
  attachmentDescriptions?: string;
  referencedMessagesDescriptions?: string;
  modelUsed?: string;
  /**
   * The model id the provider reported serving. Populated on essentially
   * every response, not only routed ones — it differs from `modelUsed` both
   * when a router alias genuinely resolved and when the provider echoes a
   * cosmetically different spelling of the same directly-requested model,
   * so mere inequality is not evidence of routing. Absent only when the
   * response carried no reported model id at all.
   */
  routedModel?: string;
  userMessageContent?: string;
  /** Whether fresh mode was active (LTM retrieval was skipped) */
  freshModeEnabled?: boolean;
  /** Whether incognito mode was active (LTM storage was skipped) */
  incognitoModeActive?: boolean;
  /**
   * Data needed for deferred memory storage (when skipMemoryStorage was true).
   * Caller should pass this to storeMemory() after validating the response.
   */
  deferredMemoryData?: DeferredMemoryData;
  /**
   * Extracted thinking/reasoning content from <think> tags.
   * Only present if the model included thinking blocks in its response.
   */
  thinkingContent?: string;
  /** Model produced only analytical/reasoning content without roleplay — caller should retry */
  onlyThinkingProduced?: boolean;
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
  /**
   * The turn's references in durable form, for the trigger history row. Empty
   * when the message quoted nothing. Carried out of input processing rather
   * than written there because the write is the RAG service's Prisma to own.
   */
  durableReferences: StoredReferencedMessage[];
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into conversation history entries for better context colocation
}

/**
 * Participant info for prompt formatting
 *
 * Note: preferredName, pronouns, and content are structured fields from the persona.
 * The ParticipantFormatter renders these as separate XML elements for clear LLM parsing.
 */
export interface ParticipantInfo {
  /** The participant's display name (persona name or Discord display name). */
  personaName: string;
  /** User's preferred display name (from persona) */
  preferredName?: string;
  /** User's pronouns (from persona) */
  pronouns?: string;
  /** User's persona content/about text */
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

/**
 * Result of loading personas and resolving user references.
 *
 * `participantPersonas` is keyed by resolvedPersonaId (a UUID), not by
 * display name — two different users can share a persona name, and a
 * name-keyed map would collide them into one entry. See the key-choice
 * comment on `MemoryRetriever.getAllParticipantPersonas`, which builds this
 * map, for the full rationale.
 */
export interface PersonaLoadResult {
  participantPersonas: Map<string, ParticipantInfo>;
  processedPersonality: LoadedPersonality;
}

/**
 * A distilled fact for prompt rendering — just the atomic statement. Minimal
 * by design (decoupled from the retrieval-layer `SimilarFact`) so the formatter
 * and budget manager only depend on what they render. Phase 2 slice 4a.
 */
export interface FactForPrompt {
  statement: string;
}

/**
 * The history pre-pass result (STM/LTM dedup-hole fix). History is selected
 * BEFORE memory retrieval — it needs nothing from memories once the memory
 * budget is a reserve — so the EXACT shipped-history boundary is known when
 * the LTM query runs, instead of assuming all fetched history ships and
 * losing the truncated range to neither path.
 */
export interface PreselectedHistory {
  currentMessage: HumanMessage;
  contentForStorage: string;
  systemPromptBaseTokens: number;
  currentMessageTokens: number;
  /** Memory budget (same formula as always) — reserved up front so the
   * history budget is computable pre-retrieval. */
  memoryReserve: number;
  historyBudget: number;
  serializedHistory: string;
  historyTokensUsed: number;
  messagesDropped: number;
  crossChannelMessagesIncluded: number;
  /** min createdAt over SELECTED current-channel entries; undefined when
   * nothing shipped. The exact time baseline for STM/LTM dedup. */
  oldestSelectedTs?: number;
  /** Discord snowflakes of every shipped current-channel entry (incl. chunk
   * ids) — the authoritative ID-dedup set. */
  shippedMessageIds: Set<string>;
  /** The current-channel entries that actually shipped, chronological order
   * (PR 2.3). Populated FLAG-NEUTRALLY — `RealMessagesBuilder` consumes this
   * only when `realMessagesEnabled` is on; flag-off, it is computed and
   * unused, same as `serializedHistory` is computed and unused in reverse. */
  selectedEntries: StructuredHistoryEntry[];
  /** The `<prior_conversations>` XML `ContextWindowManager` produced (empty
   * when cross-channel is disabled or nothing fit). Also flag-neutral —
   * consumed only when `realMessagesEnabled` is on, as its own leading
   * `HumanMessage` (§9c). */
  crossChannelXml: string;
  /** The `realMessagesEnabled` value THIS pre-pass measured under. `allocate`
   * consumes this rather than re-reading the live setting: the base-token
   * measurement and the shipped system message must see the SAME flag value
   * or the budget identity breaks, and a live flip between the two calls
   * would otherwise skew it silently. */
  realMessagesEnabled: boolean;
  /** This turn's `headerSpoofNeutralizeEnabled` capture. `allocate` must
   *  render under the SAME value this pre-pass measured under — the same
   *  reason `realMessagesEnabled` above is captured once and threaded rather
   *  than re-read. */
  headerSpoofNeutralizeEnabled: boolean;
  /**
   * This turn's collision-conditional header id-tag map, computed ONCE
   * (`computeHeaderIdTags`) right after `realMessagesEnabled` and the
   * responder identity are established — for exactly the reason
   * `realMessagesEnabled` itself is captured once per turn rather than read
   * twice: the pre-measure (`preselectHistory`'s `countHistoryTokens` /
   * `selectAndSerializeHistory` calls) and the shipped render
   * (`allocate` → `buildShippedHistoryMessages`) must see the SAME map or the
   * budget identity breaks.
   */
  headerIdTags: HeaderIdTagMap;
}

/** Result of token budget calculation and content selection */
export interface BudgetAllocationResult {
  relevantMemories: MemoryDocument[];
  /** Facts selected within the reserved fact sub-budget (Phase 2 slice 4a). */
  selectedFacts: FactForPrompt[];
  serializedHistory: string;
  systemPrompt: BaseMessage;
  /** Per-section tier/size/offset map of the FINAL system prompt — stored in
   *  the diagnostic payload so the prefix-diff tool can name the section a
   *  cache-miss divergence landed in. */
  systemPromptSections: SectionDescription[];
  /** The FINAL human message: V-tier prefix (context/participants/facts/
   *  memories/references) + the `<from>`-wrapped user turn. Built here, after
   *  memory selection — the invoker must ship THIS message; rebuilding one
   *  elsewhere would drop the selected memory blocks. */
  currentMessage: BaseMessage;
  memoryTokensUsed: number;
  /** Tokens consumed by the `<facts>` block (wrapper + statements). */
  factTokensUsed: number;
  historyTokensUsed: number;
  memoriesDroppedCount: number;
  messagesDropped: number;
  contentForStorage: string;
  /** How many cross-channel messages survived the token-budget trim and made
   *  it into `serializedHistory`. Surfaced into diagnostics so users can see
   *  whether their crossChannel + maxAge configuration produced any context.
   *  Undefined when cross-channel was disabled for this turn. */
  crossChannelMessagesIncluded?: number;
  /**
   * Real-message form of the shipped current-channel history (PR 2.3 of the
   * prompt-assembly epic, behind `realMessagesEnabled`). Present ONLY when
   * the flag is on (possibly `[]` if nothing survived selection) — absent
   * flag-off, so a flag-off caller sees byte-identical shape to before this
   * field existed. In chronological order, ready to splice into the provider
   * message array between the cross-channel message (if any) and the current
   * turn.
   */
  historyMessages?: BaseMessage[];
  /**
   * The `<prior_conversations>` XML as its own leading `HumanMessage` (§9c),
   * present only when the flag is on AND cross-channel produced non-empty
   * XML. Absent otherwise (flag-off, or cross-channel disabled/empty).
   */
  crossChannelMessage?: BaseMessage;
}

/** Result of model invocation */
export interface ModelInvocationResult {
  cleanedContent: string;
  modelName: string;
  /**
   * The model id the provider reported serving. Populated on essentially
   * every response, not only routed ones — it differs from `modelName` both
   * when a router alias genuinely resolved and when the provider echoes a
   * cosmetically different spelling of the same directly-requested model,
   * so mere inequality is not evidence of routing. Absent only when the
   * response carried no reported model id at all.
   */
  routedModel?: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Extracted thinking/reasoning content from <think> tags, if present */
  thinkingContent?: string;
  /** Model produced only analytical/reasoning content without roleplay — caller should retry */
  onlyThinkingProduced?: boolean;
}

/** Options for budget allocation */
export interface BudgetAllocationOptions {
  personality: LoadedPersonality;
  processedPersonality: LoadedPersonality;
  participantPersonas: Map<string, ParticipantInfo>;
  retrievedMemories: MemoryDocument[];
  /** Retrieved active facts (Phase 2 slice 4a); the reserved fact sub-budget trims them. */
  facts?: FactForPrompt[];
  context: ConversationContext;
  userMessage: string;
  processedAttachments: ProcessedAttachment[];
  referencedMessagesDescriptions: string | undefined;
  // Note: extendedContextDescriptions removed - image descriptions are now
  // injected inline into conversation history entries for better context colocation
  /**
   * The input-token budget for this generation: the configured
   * contextWindowTokens clamped to the model's real limit when known
   * (see contextWindowResolver.ts).
   * Required so the budget can never silently fall back to a window
   * larger than the model supports.
   */
  effectiveContextWindowTokens: number;
  /**
   * This turn's `realMessagesEnabled` value, captured once upstream
   * (`ContentBudgetManager.isRealMessagesEnabled`) before the reference-formatting
   * chain runs. Optional so a direct/test caller with no captured value still
   * works — `preselectHistory` falls back to reading the flag itself when this
   * is absent (see that method's doc-comment).
   */
  realMessagesEnabled?: boolean;
  /**
   * This turn's `headerSpoofNeutralizeEnabled` value, captured once upstream
   * on the same read as `realMessagesEnabled`. Optional for the same reason
   * its sibling above is — direct/test callers fall back to
   * `ContentBudgetManager`'s own read.
   */
  headerSpoofNeutralizeEnabled?: boolean;
}

/**
 * Opaque diagnostic collector interface.
 * Avoids circular dependency with DiagnosticCollector module.
 * Consumers pass the concrete DiagnosticCollector class which satisfies this.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Opaque marker interface to break circular dep
export interface DiagnosticCollectorRef {}

/** Options for model invocation */
export interface ModelInvocationOptions {
  personality: LoadedPersonality;
  systemPrompt: BaseMessage;
  /** Section map of systemPrompt, recorded into the diagnostic payload. */
  systemPromptSections?: SectionDescription[];
  /**
   * The serialized chat log embedded in `systemPrompt` — threaded only so the
   * prefix-cache observability hashes can isolate the history tail from the
   * stable core. Never re-rendered from it.
   */
  serializedHistory?: string;
  /** The final human message from the budget allocation (see
   *  BudgetAllocationResult.currentMessage). */
  currentMessage: BaseMessage;
  /** Real-message history, spliced between the cross-channel message (if
   *  any) and `currentMessage` (see BudgetAllocationResult.historyMessages).
   *  Absent/empty is byte-identical to today's `[systemPrompt, currentMessage]`. */
  historyMessages?: BaseMessage[];
  /** The `<prior_conversations>` leading message, when present (see
   *  BudgetAllocationResult.crossChannelMessage). */
  crossChannelMessage?: BaseMessage;
  /** The user's raw text — post-processing reads it (echo-stripping). */
  userMessage: string;
  /**
   * This turn's captured `realMessagesEnabled` value, threaded so the
   * response post-processor can gate its output-side real-message echo
   * strips on it — never re-read, which would break the once-per-turn
   * capture invariant.
   */
  realMessagesEnabled: boolean;
  context: ConversationContext;
  userApiKey?: string;
  /** True when this route bills the SYSTEM key (guests + quota retargets) —
   * drives cache-identity provenance so a retarget never scopes as the user. */
  isGuestMode?: boolean;
  /** Retry configuration for escalating duplicate detection retries */
  retryConfig?: DuplicateRetryConfig;
  /** Diagnostic collector for the "flight recorder" system */
  diagnosticCollector?: DiagnosticCollectorRef;
  /**
   * Override for the LLM transient-retry attempt count (default
   * `RETRY_CONFIG.MAX_ATTEMPTS`). The auto-promotion fallback sets this to 1 for
   * the primary (z.ai) attempt so a transient failure (e.g. a 429 overload)
   * falls through to the OpenRouter fallback immediately instead of burning the
   * full ~3×retry budget. The fallback attempt keeps the default.
   */
  maxLlmAttempts?: number;
}

/**
 * Configuration for escalating retry strategy when duplicate responses are detected.
 *
 * Escalation is sampling-only (the prompt bytes stay stable across attempts):
 * - Attempt 1: Normal generation
 * - Attempt 2+: Increase temperature (jittered) and frequency_penalty
 */
export interface DuplicateRetryConfig {
  /** Current attempt number (1-based) */
  attempt: number;
  /** Temperature override for this attempt */
  temperatureOverride?: number;
  /** Frequency penalty override for this attempt */
  frequencyPenaltyOverride?: number;
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
  /** Resolved STT dispatch (provider + matching BYOK key when applicable). */
  sttDispatch?: SttDispatch;
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
  /**
   * Diagnostic collector for the "flight recorder" system.
   * If provided, pipeline stages will record their data for debugging.
   */
  diagnosticCollector?: DiagnosticCollectorRef;
  /**
   * Resolved config cascade overrides (from ConfigStep).
   * When provided, memory retrieval uses these values instead of personality defaults.
   */
  configOverrides?: ResolvedConfigOverrides;
  /**
   * The provider the request will actually hit after ProviderRouter
   * (`auth.provider`). Drives the context-window clamp's source-of-truth: a
   * z.ai-direct request is capped from z.ai's documented limit, an OpenRouter
   * request from the OpenRouter cache. Omitted → OpenRouter path with the
   * catalog safety-net (see `resolveEffectiveContextWindow`).
   */
  effectiveProvider?: AIProvider;
  /**
   * Override for the LLM transient-retry attempt count (default
   * `RETRY_CONFIG.MAX_ATTEMPTS`). Forwarded to `invokeWithRetry`. Set to 1 by the
   * auto-promotion fallback for the primary (z.ai) attempt so a transient
   * failure falls through to the OpenRouter fallback fast.
   */
  maxLlmAttempts?: number;
}
