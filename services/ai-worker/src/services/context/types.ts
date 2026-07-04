/**
 * ContextDataSource
 *
 * The seam through which ai-worker hydrates the DB-derived parts of a job's
 * message context itself, instead of trusting the bot-client-assembled
 * payload. Exists because bot-client must be Prisma-free: context assembly
 * relocates into ai-worker, which owns the AI/memory domain and therefore
 * owns context hydration.
 *
 * Scope boundary: only DB-DERIVED context comes through this interface
 * (conversation history, cross-channel history, user timezone, context
 * epoch). Discord-derived context (attachments, guild member info,
 * environment, live channel fetches) stays in the job envelope forever —
 * only bot-client can see Discord.
 *
 * All methods are READ-ONLY: this is the read seam for DB-derived context
 * only. Persona resolution and user upserts are deliberately excluded — they
 * run through their own services (UserService, PersonaResolver, wired into
 * ContextAssembler), keeping this interface a pure reader.
 */

import type {
  ConversationMessage,
  CrossChannelHistoryGroup,
} from '@tzurot/common-types/types/conversationMessage';

export interface CrossChannelHistoryParams {
  /** Active persona whose other-channel conversations to fetch */
  personaId: string;
  /** Personality scope for the conversations */
  personalityId: string;
  /** Channel to exclude (the current conversation's channel) */
  excludeChannelId: string;
  /** Per-fetch message budget (mirrors the channel-history dbLimit) */
  limit: number;
  /** Optional staleness cutoff in seconds */
  maxAgeSeconds?: number | null;
  /** Optional context-reset epoch — messages before it are excluded */
  contextEpoch?: Date;
}

export interface ContextDataSource {
  /**
   * Channel conversation history, newest-window semantics identical to the
   * bot-client fetch (limit + epoch + maxAge filters applied DB-side).
   */
  getChannelHistory(
    channelId: string,
    limit: number,
    contextEpoch?: Date,
    maxAgeSeconds?: number | null
  ): Promise<ConversationMessage[]>;

  /** Cross-channel history groups for the active persona+personality. */
  getCrossChannelHistory(params: CrossChannelHistoryParams): Promise<CrossChannelHistoryGroup[]>;

  /**
   * Single history row lookup by Discord message id — the DB tier of voice
   * transcript retrieval (voice messages store their transcript as the row's
   * content). The bot-side path also has a Redis-cache tier; the worker is
   * DB-only, so cache-hit-only transcripts are an expected divergence source
   * during burn-in.
   */
  getMessageByDiscordId(discordMessageId: string): Promise<ConversationMessage | null>;

  /**
   * User row lookup by Discord id — the mention-resolution DB fallback for
   * mention ids absent from the envelope's target list (user not in a
   * shared server at capture time).
   */
  findUserByDiscordId(discordId: string): Promise<{ id: string; username: string } | null>;

  /** IANA timezone for an INTERNAL user id ('UTC' fallback). */
  getUserTimezone(internalUserId: string): Promise<string>;

  /**
   * Context-reset epoch for a user+personality+persona triple, or undefined
   * when the user never reset context for that pairing.
   */
  getContextEpoch(
    internalUserId: string,
    personalityId: string,
    personaId: string
  ): Promise<Date | undefined>;

  /**
   * Unique personality names keyed by id, for the ids present. Used to remap
   * extended-context assistant attribution from the webhook display name (which
   * two personalities can share) to the unique name. Missing/unknown ids are
   * simply absent from the map.
   */
  getPersonalityNamesByIds(ids: string[]): Promise<Map<string, string>>;

  /**
   * Persisted user identities keyed by Discord message id, for relay-echo
   * recovery. A `/character chat` relay-echo (the bot reposting user input as
   * `**Name:** …`) is bot-authored, so the extended-context fetch can't see the
   * human behind it — it arrives role=user with no personaId and the bot's
   * webhook name as discordUsername. But the same message was persisted with the
   * human's persona, so we recover it by discord message id. Only user-role rows
   * carrying a real persona are returned; unknown ids are simply absent.
   */
  getUserIdentitiesByDiscordIds(discordIds: string[]): Promise<Map<string, RelayEchoUserIdentity>>;
}

/** The human identity behind a persisted (relay-echo) user message. */
export interface RelayEchoUserIdentity {
  personaId: string;
  personaName: string;
  discordUsername: string;
}
