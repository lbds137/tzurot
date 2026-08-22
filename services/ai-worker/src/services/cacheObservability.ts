/**
 * Prefix-cache observability fields for the 'Generated response' log line.
 *
 * A provider-reported `cachedPromptTokens: 0` has several very different
 * causes — the provider's cache TTL expired between turns, the prompt prefix
 * changed byte-for-byte, or the provider simply omitted the usage field. None
 * of them are distinguishable from the token counts alone, so this module
 * derives the variables that separate them: how long since the channel's last
 * generation, and three hashes locating WHERE a prefix change landed.
 *
 * Everything here is derived from values already in hand at invocation time —
 * no new state, no queries. The fields carry no prompt text, no channel names,
 * and no user content: only hex digests, a duration, and a ratio.
 */

import { createHash } from 'node:crypto';
import type { BaseMessage } from '@langchain/core/messages';
import type { Logger } from 'pino';
import { contentToText } from '../utils/baseMessageContent.js';
import { HISTORY_ENTRY_OPEN } from '../jobs/utils/conversationUtils.js';
import { SECTION_SEPARATOR, type SectionDescription } from './prompt/sections.js';

/** Hex chars kept from each digest — enough to distinguish prefixes in logs. */
const HASH_PREFIX_CHARS = 12;

/** The section id `PromptBuilder` gives the serialized chat log. */
const CHAT_LOG_SECTION_ID = 'chat_log';

/**
 * SHA-256 over the RAW bytes, first {@link HASH_PREFIX_CHARS} hex chars.
 *
 * Deliberately not `utils/duplicateDetection.ts`'s `contentHash`: that one
 * lowercases and trims before hashing, because it answers a semantic
 * question ("is this the same response again?"). This one answers a
 * byte-identity question — a normalization step would hide exactly the byte
 * instability these hashes exist to hunt.
 */
export function promptHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, HASH_PREFIX_CHARS);
}

/**
 * The system prompt with its `chat_log` section (and the separator preceding
 * it) removed — the stable core: platform constraints, identity, protocol,
 * location, participants.
 *
 * Uses the section map's own offset/length rather than searching for the tag,
 * so the cut matches exactly what `layoutSections` assembled. Returns the text
 * unchanged when no `chat_log` section was rendered (empty history omits the
 * section entirely). Covered by `cacheObservability.test.ts`.
 */
export function systemPromptCore(
  systemPromptText: string,
  sections?: readonly SectionDescription[]
): string {
  const chatLog = sections?.find(section => section.id === CHAT_LOG_SECTION_ID);
  if (chatLog === undefined) {
    return systemPromptText;
  }
  const separatorStart =
    chatLog.offset > 0 ? Math.max(0, chatLog.offset - SECTION_SEPARATOR.length) : 0;
  return (
    systemPromptText.slice(0, separatorStart) +
    systemPromptText.slice(chatLog.offset + chatLog.chars)
  );
}

/**
 * The serialized chat log with its newest entry removed — everything before
 * the last `<message from="`. A change in this hash between consecutive turns
 * in one channel names instability INSIDE the already-frozen history, as
 * opposed to the expected growth at its tail.
 *
 * Returns the input unchanged when it carries no entry marker (e.g. an
 * envelope-only log). Covered by `cacheObservability.test.ts`.
 */
export function historyStablePrefix(serializedHistory: string): string {
  const newestEntryStart = serializedHistory.lastIndexOf(HISTORY_ENTRY_OPEN);
  return newestEntryStart === -1 ? serializedHistory : serializedHistory.slice(0, newestEntryStart);
}

/**
 * Provider-reported prefix-cache hit fraction, rounded to 2 decimals.
 * Undefined unless both counts are present and the input count is positive —
 * absent then reads as "not reported", never as "zero hit".
 */
export function cacheHitRatio(cacheReadTokens?: number, inputTokens?: number): number | undefined {
  if (cacheReadTokens === undefined || inputTokens === undefined || inputTokens <= 0) {
    return undefined;
  }
  return Math.round((cacheReadTokens / inputTokens) * 100) / 100;
}

/**
 * Newest parseable `createdAt` in the loaded history, in epoch ms — EXCLUDING
 * the current turn's own trigger message.
 *
 * A defensive backstop, not the production common case: `ContextAssembler`
 * already filters the trigger row out of the history it assembles, so on the
 * pipeline path this exclusion should be a no-op. It exists because the
 * trigger IS persisted before job submission — any history source that skips
 * that upstream filter would otherwise make this field read as the turn's own
 * queue latency instead of the channel gap the provider's cache TTL races
 * against. When no trigger id is supplied, the raw newest is used (documented
 * on the field). Pinned by `cacheObservability.test.ts`.
 */
function newestHistoryTimestampMs(
  history: readonly { createdAt?: string; discordMessageId?: readonly string[] }[] | undefined,
  excludeMessageId?: string
): number | undefined {
  if (history === undefined || history.length === 0) {
    return undefined;
  }
  const timestamps = history
    .filter(
      entry =>
        excludeMessageId === undefined ||
        entry.discordMessageId?.includes(excludeMessageId) !== true
    )
    .map(entry => (entry.createdAt !== undefined ? new Date(entry.createdAt).getTime() : NaN))
    .filter(ts => Number.isFinite(ts));
  return timestamps.length > 0
    ? timestamps.reduce((max, ts) => Math.max(max, ts), -Infinity)
    : undefined;
}

/** Inputs for {@link buildCacheObservability}, all already in hand at invocation. */
export interface CacheObservabilityInputs {
  /** Text of the assembled system message. */
  systemPromptText: string;
  /** Section map of that same system message (from `layoutSections`). */
  systemPromptSections?: readonly SectionDescription[];
  /** The serialized chat log embedded in the system message. */
  serializedHistory?: string;
  /** Text of the final human message (V-tier prefix + the user's turn). */
  currentMessageText: string;
  /**
   * Text of every message BETWEEN the system prompt and the current human
   * message, in ship order — the cross-channel message and the real-message
   * history when `realMessagesEnabled` is on. Absent flag-off (the array is
   * exactly [system, current]), which keeps `promptHashFull`'s input string
   * byte-identical to its pre-flag formula.
   */
  interveningMessagesText?: string[];
  /** The loaded conversation history; only `createdAt` and the message ids
   *  (for the current-turn exclusion) are read. */
  history?: readonly { createdAt?: string; discordMessageId?: readonly string[] }[];
  /**
   * Discord id of the current turn's triggering message, excluded from the
   * gap computation as a defensive backstop — the assembler filters it from
   * history upstream, but the row is persisted before job submission, so a
   * source that skipped that filter would collapse the "gap" to this turn's
   * own queue latency.
   */
  triggerMessageId?: string;
  /** Provider-reported `cache_read` input tokens, when present. */
  cacheReadTokens?: number;
  /** Provider-reported total input tokens, when present. */
  inputTokens?: number;
  /** Injectable clock for tests; defaults to `Date.now()`. */
  now?: number;
}

/** The fields merged into the 'Generated response' log object. */
export interface CacheObservabilityFields {
  /**
   * Seconds between now and the newest history timestamp EXCLUDING the
   * current turn's own trigger row — the age of the channel's last turn,
   * which is what a provider cache TTL races against. When no trigger id is
   * supplied the raw newest entry is used, which then measures this turn's
   * own persist-to-generation latency instead. Undefined when nothing
   * remains with a parseable timestamp. Not clamped: a negative value would
   * itself be signal (clock skew).
   */
  secondsSinceLastChannelGeneration?: number;
  /** Hash of the system prompt minus the chat log (the stable core). */
  promptHashSystemCore: string;
  /** Hash of the chat log minus its newest entry. */
  promptHashHistoryStable?: string;
  /** Hash of the whole assembled prompt — the cache key's upper bound. */
  promptHashFull: string;
  /** `cache_read / input_tokens`, 2 decimals. */
  cacheHitRatio?: number;
}

/**
 * Derive every cache-observability field for one generation.
 *
 * `promptHashFull` covers EVERY container shipped to the model, in ship
 * order, joined by newlines — flag-off that is the system message and the
 * current human message; under `realMessagesEnabled` the caller passes the
 * intervening cross-channel/history messages too, so the hash still bounds
 * the whole prompt. TEXT parts only: `contentToText` drops non-text content
 * blocks, so two turns differing only in attached image bytes hash
 * identically. Fine for a text-prefix-cache diagnostic; not a byte-exact
 * wire-payload hash.
 */
export function buildCacheObservability(
  inputs: CacheObservabilityInputs
): CacheObservabilityFields {
  const {
    systemPromptText,
    systemPromptSections,
    serializedHistory,
    currentMessageText,
    interveningMessagesText,
    history,
    triggerMessageId,
    cacheReadTokens,
    inputTokens,
    now = Date.now(),
  } = inputs;

  const newestMs = newestHistoryTimestampMs(history, triggerMessageId);
  const ratio = cacheHitRatio(cacheReadTokens, inputTokens);

  return {
    ...(newestMs !== undefined
      ? { secondsSinceLastChannelGeneration: Math.round((now - newestMs) / 1000) }
      : {}),
    promptHashSystemCore: promptHash(systemPromptCore(systemPromptText, systemPromptSections)),
    ...(serializedHistory !== undefined && serializedHistory.length > 0
      ? { promptHashHistoryStable: promptHash(historyStablePrefix(serializedHistory)) }
      : {}),
    promptHashFull: promptHash(
      [systemPromptText, ...(interveningMessagesText ?? []), currentMessageText].join('\n')
    ),
    ...(ratio !== undefined ? { cacheHitRatio: ratio } : {}),
  };
}

/**
 * The `interveningMessagesText` input, derived from the ACTUAL shipped
 * provider array: everything between messages[0] (the system prompt) and the
 * final human message. Returns an empty object flag-off (the array is exactly
 * [system, current]), so `promptHashFull`'s input string stays byte-identical
 * to its pre-flag formula there.
 */
export function interveningShippedText(messages: BaseMessage[]): {
  interveningMessagesText?: string[];
} {
  if (messages.length <= 2) {
    return {};
  }
  return { interveningMessagesText: messages.slice(1, -1).map(m => contentToText(m.content)) };
}

/** The per-generation identity fields the log line carries alongside the hashes. */
export interface GeneratedResponseLogInputs extends CacheObservabilityInputs {
  charCount: number;
  personalityName: string;
  modelName: string;
}

/**
 * Emit the 'Generated response' info line through the CALLER's logger, so the
 * line keeps its `ConversationalRAGService` name in production log queries.
 *
 * `promptTokens` and `cachedPromptTokens` keep their exact historical names:
 * the prod cache-hit-rate measurement greps that pair.
 */
export function logGeneratedResponse(logger: Logger, inputs: GeneratedResponseLogInputs): void {
  const { charCount, personalityName, modelName, ...observability } = inputs;
  logger.info(
    {
      charCount,
      personalityName,
      modelName,
      promptTokens: observability.inputTokens,
      cachedPromptTokens: observability.cacheReadTokens,
      ...buildCacheObservability(observability),
    },
    'Generated response'
  );
}
