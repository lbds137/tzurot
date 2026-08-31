/**
 * Conversation Types
 *
 * Shared type definitions for conversation processing utilities.
 * Extracted from conversationUtils.ts for better modularity and sharing.
 */

import type { MessageRole } from '@tzurot/common-types/constants/message';
import type {
  StoredReferencedMessage,
  MessageReaction,
  ForwardedOrigin,
} from '@tzurot/common-types/types/schemas/message';
import type { ImageSource } from '../../services/prompt/QuoteFormatter.js';

/**
 * Image description for inline display in chat_log
 */
export interface InlineImageDescription {
  filename: string;
  description: string;
  /**
   * Provenance carried from the source attachment's producer flags, so a
   * history-replayed image keeps the same `source` attribute the reference
   * paths emit. Absent means an ordinary upload.
   */
  source?: ImageSource;
}

/**
 * The responding personality's identity, as the history layer needs it.
 *
 * Name and id travel together from here down, so they are one parameter rather
 * than two: `name` is the chat-log `from=` fallback and the legacy self-match,
 * `id` is what actually decides self-vs-sibling for any row carrying one. The
 * id is optional because not every caller has a personality in hand (token
 * pre-measures, the eval harness), and those correctly fall back to the name.
 *
 * Bundled rather than appended because `selectAndSerializeHistory` was already
 * at the five-parameter ceiling; a sixth would have needed a suppression whose
 * only justification was "we added a parameter".
 */
export interface ResponderIdentity {
  /** The personality's `name` (not display name; more distinguishing, though not unique). */
  name: string;
  /** The personality UUID. Stable across renames, unlike the name. */
  id?: string;
}

/**
 * The prompt-side conversation history IR: one normalized history row as every
 * prompt-assembly consumer reads it (chat-log serialization, participant
 * extraction, token measurement, reference dedup).
 *
 * Boundary: this is the POST-normalization, prompt-side shape.
 * `ConversationMessage` (`@tzurot/common-types/types/conversationMessage`,
 * produced by `mapToConversationMessage` in
 * `packages/conversation-history/src/ConversationMessageMapper.ts`) is the
 * PRODUCER-side shape upstream of it — Date-typed where this is
 * ISO-string-typed, and with several fields required that are optional here.
 * The two stay separate types on purpose; this one is what the prompt path
 * reads through.
 */
export interface StructuredHistoryEntry {
  /**
   * Message ID. Its meaning depends on the row's source: a database UUID on
   * DB-sourced rows (`mapToConversationMessage` assigns `record.id`), and the
   * Discord message ID itself on extended-context rows. Anything that needs a
   * Discord snowflake must read `discordMessageId`, never this field.
   */
  id?: string;
  /**
   * Discord message IDs (snowflakes) for this message.
   * Array because long messages may be split into multiple Discord messages (chunks).
   * Used for quote deduplication: if a referenced message's Discord ID is in history,
   * we don't need to repeat it in quoted_messages.
   *
   * The reference paths key on THIS field, never on `id`: the enricher's dedup
   * decision and the deduped stub's subtraction index both ask "which history
   * entry is this quote?" by Discord id.
   */
  discordMessageId?: string[];
  role: MessageRole | string;
  content: string;
  /**
   * ISO timestamp of the message, supplied by the pipeline producer
   * (`ContextStep` → `PreparedContext.rawConversationHistory`, typed there as
   * `ConversationHistoryEntry.createdAt`). Optional because legacy/DB-sourced
   * rows can lack one — the budget pre-pass already filters unparseable
   * stamps out for the same reason.
   */
  createdAt?: string;
  /** User's persona ID */
  personaId?: string;
  /** User's persona display name */
  personaName?: string;
  /** Discord username for disambiguation when persona name matches personality name */
  discordUsername?: string;
  tokenCount?: number;
  /** Whether this message was forwarded from another channel */
  isForwarded?: boolean;
  /** Structured metadata (referenced messages, attachments) - formatted at prompt time */
  messageMetadata?: {
    // The schema type, not a hand-written copy of it: a re-declaration here
    // makes any new stored-reference field invisible to this path until
    // someone remembers to update it in three places.
    referencedMessages?: StoredReferencedMessage[];
    /** Image descriptions from extended context preprocessing */
    imageDescriptions?: InlineImageDescription[];
    /** Embed XML strings for extended context messages (already formatted by EmbedParser) */
    embedsXml?: string[];
    /** Voice transcripts for extended context messages */
    voiceTranscripts?: string[];
    /** Forwarded image attachment descriptors (fallback when vision isn't available) */
    forwardedAttachmentLines?: string[];
    /** Reactions on this message (emoji + who reacted) */
    reactions?: MessageReaction[];
    /**
     * Original author and post time of a FORWARDED message's quoted content,
     * recovered by bot-client at persist time. Absent on rows written before
     * this existed and on forwards whose original could not be re-fetched.
     */
    forwardedFrom?: ForwardedOrigin;
  };
  // AI personality info (for multi-AI channel attribution)
  /**
   * The AI personality ID this message belongs to. `mapToConversationMessage`
   * writes it on every DB-sourced row (`personalityId: record.personalityId`);
   * the extended-context fetch's registry-miss fallback supplies a display name
   * with no id, which is why it is optional and consumers skip rows lacking it.
   *
   * Anything deciding identity keys on this, not on `personalityName` — the
   * name carries no unique constraint (only `slug` does).
   */
  personalityId?: string;
  /**
   * The AI personality's `name` (for assistant message attribution), written by
   * `mapToConversationMessage` as `record.personality.name` on every DB-sourced
   * row. `name` rather than display name because two personalities can share a
   * display name (e.g. "Fallen Emily" / "Emily" both displaying "Emily"), which
   * would collapse their chat-log attribution into an indistinguishable
   * `from="Emily"`. It is the MORE distinguishing of the two, but it is not
   * itself unique — see `personalityId` above.
   */
  personalityName?: string;
}
